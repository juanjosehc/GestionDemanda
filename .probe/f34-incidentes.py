"""Sonda de solo lectura contra GLPI: replica el criterio del puerto y no escribe nada.

Responde a una sola pregunta, con la instancia real delante: cuantos tickets activos tiene hoy el
equipo operativo, de quien son y de que tipo. Es la cifra contra la que se contrasta la pantalla de
Incidentes, medida en GLPI y no en la pantalla.

No imprime ni el token ni la URL: solo cifras.
"""

import collections
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKET_STATUS = {1: 'Nuevo', 2: 'Asignado', 3: 'Planificado', 4: 'Pendiente'}
TICKET_TYPE = {1: 'INCIDENTE', 2: 'REQUERIMIENTO'}


def env():
    values = {}
    with open(os.path.join(ROOT, '.env'), encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def operational_logins():
    """Los logins de team.operational en application.properties, que es quien decide la vista."""
    path = os.path.join(ROOT, 'backend', 'src', 'main', 'resources', 'application.properties')
    logins = []
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if line.startswith('team.operational['):
                logins.append(line[len('team.operational['):line.index(']')])
    return logins


def call(base, headers, path, params=None):
    url = base + path
    if params:
        url = url + '?' + urllib.parse.urlencode(params, doseq=True)
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read().decode('utf-8')
    return json.loads(body) if body.strip() else {}


def main():
    config = env()
    base = config['GLPI_URL'].rstrip('/')
    headers = {
        'App-Token': config['GLPI_APP_TOKEN'],
        'Authorization': 'user_token ' + config['GLPI_USER_TOKEN'],
        'Content-Type': 'application/json',
    }

    session = call(base, headers, '/initSession')['session_token']
    headers['Session-Token'] = session

    try:
        # Los miembros del grupo, para traducir login a identificador. La sonda no inventa el grupo ni
        # el operador: pide el mismo que el backend pide —pertenencia «bajo» el grupo, no «igual a»
        # el, porque quien esta en un subgrupo de Desarrollo N2 esta en Desarrollo N2—.
        params = {
            'criteria[0][field]': '13',
            'criteria[0][searchtype]': 'under',
            'criteria[0][value]': '1',
            'forcedisplay[0]': '2',
            'forcedisplay[1]': '1',
            'range': '0-2000',
        }
        members = call(base, headers, '/search/User', params).get('data', [])
        by_login = {row.get('1'): int(row['2']) for row in members if row.get('1') and row.get('2')}

        logins = operational_logins()

        # Quien esta declarado en el equipo operativo pero no pertenece al grupo —una excepcion— no sale
        # de la lectura anterior y **si** lo pregunta la pantalla, porque el padron lo publica. Se
        # resuelve login a login como lo hace el backend: `contains` sobre la opcion 1 y la igualdad
        # comprobada aqui, porque con `equals` la instancia contesta que no hay nadie.
        for login in logins:
            if login in by_login:
                continue
            found = call(base, headers, '/search/User', {
                'criteria[0][field]': '1',
                'criteria[0][searchtype]': 'contains',
                'criteria[0][value]': login,
                'forcedisplay[0]': '2',
                'forcedisplay[1]': '1',
                'range': '0-1000',
            }).get('data', [])
            for row in found:
                if (row.get('1') or '').lower() == login.lower() and row.get('2'):
                    by_login[login] = int(row['2'])

        missing = [login for login in logins if login not in by_login]
        ids = {login: by_login[login] for login in logins if login in by_login}

        print('grupo: %d personas en GLPI, %d logins operativos, %d sin encontrar'
              % (len(members), len(logins), len(missing)))
        if missing:
            print('  sin encontrar:', ', '.join(missing))

        # Una sola busqueda: los tecnicos en OR anidado y el grupo de estados activos, que es
        # exactamente el criterio de `activeTicketsOf` (estados 1, 2, 3 y 4 de GLPI).
        params = {'criteria[0][link]': 'AND'}
        for index, identifier in enumerate(ids.values()):
            params['criteria[0][criteria][%d][field]' % index] = '5'
            params['criteria[0][criteria][%d][searchtype]' % index] = 'equals'
            params['criteria[0][criteria][%d][value]' % index] = str(identifier)
            params['criteria[0][criteria][%d][link]' % index] = 'OR'

        params['criteria[1][link]'] = 'AND'
        for index, status in enumerate(TICKET_STATUS):
            params['criteria[1][criteria][%d][field]' % index] = '12'
            params['criteria[1][criteria][%d][searchtype]' % index] = 'equals'
            params['criteria[1][criteria][%d][value]' % index] = str(status)
            params['criteria[1][criteria][%d][link]' % index] = 'OR'

        for index, field in enumerate(['2', '1', '12', '14', '3', '15', '5']):
            params['forcedisplay[%d]' % index] = field
        params['range'] = '0-2000'

        answer = call(base, headers, '/search/Ticket', params)
        rows = answer.get('data', [])

        print('totalcount que declara GLPI: %s | filas recibidas: %d'
              % (answer.get('totalcount'), len(rows)))

        per_person = collections.Counter()
        by_type = collections.Counter()
        by_status = collections.Counter()
        ids_to_logins = {value: key for key, value in ids.items()}
        shared = 0

        for row in rows:
            technicians = row.get('5')
            owners = [technicians] if isinstance(technicians, str) else (technicians or [])
            owners = [owner for owner in owners if owner]
            if len(owners) > 1:
                shared += 1
            for owner in owners:
                per_person[ids_to_logins.get(int(owner), 'ajeno:' + str(owner))] += 1
            by_type[TICKET_TYPE.get(int(row.get('14') or 0), 'NO_TRADUCIBLE')] += 1
            by_status[TICKET_STATUS.get(int(row.get('12') or 0), '?')] += 1

        print('tickets activos: %d en %d personas (una de ellas compartida por dos: %d)'
              % (len(rows), sum(1 for count in per_person.values() if count), shared))
        print('  por tipo:', dict(by_type))
        print('  por estado:', dict(by_status))
        print('  por persona:')
        for login, count in sorted(per_person.items(), key=lambda pair: (-pair[1], pair[0])):
            print('    %-10s %d' % (login, count))
        print('sin tickets:', ', '.join(sorted(login for login in logins if login not in per_person)))
    finally:
        try:
            call(base, headers, '/killSession')
        except Exception:  # noqa: BLE001 - cerrar la sesion no es parte del resultado
            pass


if __name__ == '__main__':
    sys.exit(main())
