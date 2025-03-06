# Use the official OpenJDK 23 image
FROM openjdk:23-slim

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