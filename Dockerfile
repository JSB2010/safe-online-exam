# Use Java 21 as specified in pom.xml
FROM eclipse-temurin:21-jre-jammy

# Set working directory
WORKDIR /app

# Add a timestamp argument to break cache when needed
ARG BUILD_DATE=unknown
RUN echo "Build timestamp: $BUILD_DATE" > build_timestamp.txt

# Add the application JAR
ADD target/sebcanvas-0.0.1-SNAPSHOT.jar app.jar

# Set environment variables
ENV SPRING_PROFILES_ACTIVE=dev
ENV JAVA_OPTS="-Xmx512m -Xms256m"

# Set GCP debugging options to help troubleshoot classpath issues
ENV JAVA_TOOL_OPTIONS="-Dspring.profiles.active=dev"

# Make the port more explicit - should match the port in the application
EXPOSE 8080

# Health check to verify the app is running (adjust timeout as needed)
HEALTHCHECK --interval=30s --timeout=30s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Run the application with more detailed debugging if needed
ENTRYPOINT ["java", "-jar", "app.jar"]