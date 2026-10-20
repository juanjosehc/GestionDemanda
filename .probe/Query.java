import java.sql.*;

/** Consulta de solo lectura sobre la base de gestión de demanda. */
public class Query {
    public static void main(String[] args) throws Exception {
        String sql = args[0];
        String url = System.getenv().getOrDefault("Q_URL", "jdbc:postgresql://localhost:5432/gestiondemanda");
        String user = System.getenv().getOrDefault("Q_USER", "gestiondemanda");
        String pass = System.getenv().getOrDefault("Q_PASS", "gestiondemanda");
        try (Connection c = DriverManager.getConnection(url, user, pass);
             Statement s = c.createStatement();
             ResultSet r = s.executeQuery(sql)) {

            ResultSetMetaData m = r.getMetaData();
            StringBuilder header = new StringBuilder();
            for (int i = 1; i <= m.getColumnCount(); i++) {
                header.append(i > 1 ? " | " : "").append(m.getColumnLabel(i));
            }
            System.out.println(header);

            while (r.next()) {
                StringBuilder row = new StringBuilder();
                for (int i = 1; i <= m.getColumnCount(); i++) {
                    row.append(i > 1 ? " | " : "").append(r.getString(i));
                }
                System.out.println(row);
            }
        }
    }
}
