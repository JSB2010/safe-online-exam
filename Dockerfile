# Use Java 21 instead of 23
FROM eclipse-temurin:21-jre-jammy

# Set working directory
WORKDIR /app

# Add the application JAR
ADD target/sebcanvas-0.0.1-SNAPSHOT.jar app.jar

# Set environment variables
ENV SPRING_PROFILES_ACTIVE=prod
ENV JAVA_OPTS="-Xmx512m"

# Expose the port
EXPOSE 8080

# Run the application
ENTRYPOINT ["java", "-jar", "app.jar"]
