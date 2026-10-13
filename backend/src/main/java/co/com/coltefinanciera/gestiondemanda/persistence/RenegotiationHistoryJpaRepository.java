package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface RenegotiationHistoryJpaRepository
        extends JpaRepository<RenegotiationHistoryEntity, Long> {

    /**
     * Todo lo que le ha pasado al acuerdo de un elemento de trabajo, en orden de escritura.
     *
     * <p>El orden es el de la clave y no el de {@code changed_at}: dos cambios del mismo instante
     * —que los hay, si alguien reenvia dos veces en el mismo milisegundo— tienen que salir siempre en
     * el mismo orden, y el sello no los distingue.
     */
    List<RenegotiationHistoryEntity> findByWorkItemIdOrderByIdAsc(String workItemId);
}
