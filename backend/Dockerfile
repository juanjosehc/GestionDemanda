# Etapa 1: compilacion
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Se copia primero el pom para aprovechar la cache de capas de Docker:
# las dependencias solo se vuelven a descargar si cambia el pom.
COPY pom.xml .
RUN mvn -B -ntp dependency:go-offline

COPY src ./src
RUN mvn -B -ntp clean package -DskipTests

# Etapa 2: ejecucion
FROM eclipse-temurin:21-jre
WORKDIR /app

# Usuario sin privilegios: la imagen base arranca como root por defecto.
RUN useradd --system --create-home --shell /usr/sbin/nologin spring
USER spring

COPY --from=build /build/target/*.jar app.jar

EXPOSE 8080

# maxRAMPercentage en lugar de -Xmx fijo: la JVM se adapta al limite de memoria
# del contenedor sin tener que reconstruir la imagen.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
