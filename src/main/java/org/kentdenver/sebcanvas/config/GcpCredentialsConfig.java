package org.kentdenver.sebcanvas.config;

import com.google.api.gax.core.CredentialsProvider;
import com.google.api.gax.core.FixedCredentialsProvider;
import com.google.auth.oauth2.GoogleCredentials;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;

import java.io.FileInputStream;
import java.io.IOException;

/**
 * Configuration for Google Cloud Platform credentials.
 * This class provides the credentials needed for accessing Google Cloud services
 * like Secret Manager, Firestore, etc.
 *
 * The configuration is conditionally loaded based on active profiles, with
 * special handling for development, test, and production environments.
 */
@Configuration
@Slf4j
public class GcpCredentialsConfig {

    @Value("${spring.cloud.gcp.credentials.location:}")
    private String credentialsLocation;

    /**
     * Creates a CredentialsProvider for Google Cloud authentication.
     *
     * In Cloud Run or other GCP environments, this will use Application Default Credentials.
     * In local development, it will try to use credentials from the specified location
     * or fall back to Application Default Credentials from local environment.
     *
     * @return CredentialsProvider to be used in GCP clients
     * @throws IOException if there's an error loading credentials
     */
    @Bean
    @Profile({"dev", "prod"})  // Only create this bean in dev and prod profiles
    public CredentialsProvider googleCredentialsProvider() throws IOException {
        GoogleCredentials credentials;

        // Check if specific credentials file is configured
        if (credentialsLocation != null && !credentialsLocation.isEmpty()) {
            log.info("Loading GCP credentials from file: {}", credentialsLocation);
            try (FileInputStream serviceAccountStream = new FileInputStream(credentialsLocation)) {
                credentials = GoogleCredentials.fromStream(serviceAccountStream);
            }
        } else {
            // Use Application Default Credentials
            // This will work in GCP environments automatically and locally if properly configured
            log.info("Using Application Default Credentials");
            try {
                credentials = GoogleCredentials.getApplicationDefault();
            } catch (IOException e) {
                log.warn("Failed to load Google Application Default Credentials: {}", e.getMessage());
                log.warn("GCP services will not be available");
                return null;  // Return null to allow application to start without credentials
            }
        }

        // Make sure we have the right scopes for Secret Manager and other services
        credentials = credentials.createScoped(
                "https://www.googleapis.com/auth/cloud-platform"
        );

        log.info("Successfully loaded GCP credentials");
        return FixedCredentialsProvider.create(credentials);
    }

    /**
     * Provides a mock credentials provider for testing.
     * This prevents tests from trying to access real GCP services.
     *
     * @return CredentialsProvider that returns null credentials (for testing only)
     */
    @Bean
    @Profile("test")
    public CredentialsProvider testCredentialsProvider() {
        log.info("Using mock GCP credentials for testing environment");
        return () -> null;
    }
}