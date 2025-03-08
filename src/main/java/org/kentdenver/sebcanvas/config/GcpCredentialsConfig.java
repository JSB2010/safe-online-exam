package org.kentdenver.sebcanvas.config;

import com.google.api.gax.core.CredentialsProvider;
import com.google.api.gax.core.FixedCredentialsProvider;
import com.google.api.gax.core.NoCredentialsProvider;
import com.google.auth.oauth2.GoogleCredentials;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;

import java.io.FileInputStream;
import java.io.IOException;

/**
 * Enhanced configuration for Google Cloud Platform credentials.
 * This class provides the credentials needed for accessing Google Cloud services
 * with improved error handling and fallback mechanisms.
 */
@Configuration
@Slf4j
public class GcpCredentialsConfig {

    @Value("${spring.cloud.gcp.credentials.location:}")
    private String credentialsLocation;

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    /**
     * Creates a CredentialsProvider for Google Cloud authentication with enhanced error handling.
     * In case of failures, it will log detailed error messages and provide a NoCredentialsProvider
     * which allows the application to start but will fail when actual Google Cloud services are accessed.
     *
     * @return CredentialsProvider to be used in GCP clients
     */
    @Bean
    @Profile({"dev", "prod"})  // Only create this bean in dev and prod profiles
    public CredentialsProvider googleCredentialsProvider() {
        GoogleCredentials credentials;

        try {
            log.info("Attempting to initialize Google Cloud credentials");

            // Check if we're running in Cloud Run (metadata server should be available)
            boolean isCloudRun = System.getenv("K_SERVICE") != null;

            if (isCloudRun) {
                log.info("Detected Cloud Run environment, using Application Default Credentials");

                try {
                    credentials = GoogleCredentials.getApplicationDefault();
                    log.info("Successfully loaded Application Default Credentials in Cloud Run");
                } catch (IOException e) {
                    log.error("Failed to load Application Default Credentials in Cloud Run: {}", e.getMessage());
                    log.error("This is unusual in Cloud Run and suggests a configuration issue");
                    log.error("Providing NoCredentialsProvider as fallback - GCP services will not work!");
                    return NoCredentialsProvider.create();
                }
            }
            // Check if specific credentials file is configured
            else if (credentialsLocation != null && !credentialsLocation.isEmpty()) {
                log.info("Loading GCP credentials from file: {}", credentialsLocation);
                try (FileInputStream serviceAccountStream = new FileInputStream(credentialsLocation)) {
                    credentials = GoogleCredentials.fromStream(serviceAccountStream);
                    log.info("Successfully loaded credentials from file");
                } catch (IOException e) {
                    log.error("Failed to load credentials from file: {}", e.getMessage());
                    log.error("Falling back to Application Default Credentials");
                    credentials = tryLoadApplicationDefaultCredentials();
                }
            } else {
                // Use Application Default Credentials
                log.info("No credentials file specified, using Application Default Credentials");
                credentials = tryLoadApplicationDefaultCredentials();
            }

            if (credentials == null) {
                log.warn("Failed to initialize any Google credentials, falling back to no credentials");
                log.warn("GCP services will not be available!");
                return NoCredentialsProvider.create();
            }

            // Make sure we have the right scopes for services we need
            credentials = credentials.createScoped(
                    "https://www.googleapis.com/auth/cloud-platform",
                    "https://www.googleapis.com/auth/datastore"
            );

            log.info("Successfully configured GCP credentials with appropriate scopes");
            return FixedCredentialsProvider.create(credentials);
        } catch (Exception e) {
            log.error("Unexpected error initializing Google credentials: {}", e.getMessage(), e);
            log.warn("Using NoCredentialsProvider as fallback - GCP services will not work!");
            return NoCredentialsProvider.create();
        }
    }

    /**
     * Helper method to try loading Application Default Credentials with proper error handling.
     *
     * @return GoogleCredentials if successful, null otherwise
     */
    private GoogleCredentials tryLoadApplicationDefaultCredentials() {
        try {
            GoogleCredentials credentials = GoogleCredentials.getApplicationDefault();
            log.info("Successfully loaded Application Default Credentials");
            return credentials;
        } catch (IOException e) {
            log.warn("Failed to load Google Application Default Credentials: {}", e.getMessage());
            log.warn("If running locally, have you run 'gcloud auth application-default login'?");
            log.warn("If running in GCP, ensure the service account has appropriate permissions.");
            return null;
        }
    }

    /**
     * Provides a mock credentials provider for testing.
     * This prevents tests from trying to access real GCP services.
     *
     * @return No credentials provider (for testing only)
     */
    @Bean
    @Profile("test")
    public CredentialsProvider testCredentialsProvider() {
        log.info("Using mock GCP credentials for testing environment");
        return NoCredentialsProvider.create();
    }
}