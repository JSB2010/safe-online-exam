package org.kentdenver.sebcanvas.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;

import java.io.IOException;

/**
 * Configuration class for Google Cloud Firestore.
 * Provides specific database connections for development and production environments.
 *
 * This configuration ensures the application uses Firestore Native mode databases
 * instead of the default Datastore mode in the project.
 */
@Configuration
@Slf4j
public class FirestoreConfig {

    @Value("${spring.cloud.gcp.project-id:securityapis}")
    private String projectId;

    /**
     * Creates and configures a Firestore instance for production use.
     * Uses Application Default Credentials (ADC) for authentication.
     * Explicitly connects to the seb-canvaslti-prod database.
     *
     * @return A configured Firestore instance
     */
    @Bean
    @Primary
    @Profile("prod")
    public Firestore firestoreProd() {
        try {
            log.info("Initializing Firestore for PRODUCTION with project ID: {}", projectId);

            // Build Firestore options with production database
            FirestoreOptions firestoreOptions = FirestoreOptions.getDefaultInstance().toBuilder()
                    .setProjectId(projectId)
                    .setDatabaseId("seb-canvaslti-prod") // Explicitly set the production database
                    .build();

            log.info("Successfully created Firestore configuration for production database");
            return firestoreOptions.getService();
        } catch (Throwable e) {
            log.error("Failed to initialize Firestore for production: {}", e.getMessage(), e);
            log.error("This application requires Firestore Native mode database 'seb-canvaslti-prod'");

            // Re-throw to prevent application from starting with broken database connection
            throw new RuntimeException("Failed to initialize Firestore. See logs for details.", e);
        }
    }

    /**
     * Creates and configures a Firestore instance for development use.
     * Uses Application Default Credentials (ADC) for authentication.
     * Explicitly connects to the seb-canvaslti-dev database.
     *
     * @return A configured Firestore instance
     */
    @Bean
    @Primary
    @Profile("dev")
    public Firestore firestoreDev() {
        try {
            log.info("Initializing Firestore for DEVELOPMENT with project ID: {}", projectId);

            // Build Firestore options with development database
            FirestoreOptions firestoreOptions = FirestoreOptions.getDefaultInstance().toBuilder()
                    .setProjectId(projectId)
                    .setDatabaseId("seb-canvaslti-dev") // Explicitly set the development database
                    .build();

            log.info("Successfully created Firestore configuration for development database");
            return firestoreOptions.getService();
        } catch (Throwable e) {
            log.error("Failed to initialize Firestore for development: {}", e.getMessage(), e);
            log.error("This application requires Firestore Native mode database 'seb-canvaslti-dev'");

            // Re-throw to prevent application from starting with broken database connection
            throw new RuntimeException("Failed to initialize Firestore. See logs for details.", e);
        }
    }

    /**
     * Creates a Firestore instance configured for the emulator in development environments.
     * Only active when the "test" profile is active and FIRESTORE_EMULATOR_HOST is set.
     *
     * @return A Firestore instance for the emulator
     */
    @Bean
    @Profile("test")
    public Firestore firestoreEmulator() {
        String emulatorHost = System.getenv("FIRESTORE_EMULATOR_HOST");

        if (emulatorHost != null && !emulatorHost.isEmpty()) {
            try {
                log.info("Initializing Firestore emulator connection to: {}", emulatorHost);

                FirestoreOptions firestoreOptions = FirestoreOptions.getDefaultInstance().toBuilder()
                        .setProjectId("demo-project")
                        .setHost(emulatorHost)
                        .setCredentials(null) // No credentials for emulator
                        .build();

                log.info("Successfully connected to Firestore emulator");
                return firestoreOptions.getService();
            } catch (Exception e) {
                log.warn("Failed to connect to Firestore emulator: {}", e.getMessage(), e);
            }
        }

        log.error("No Firestore emulator configured and test profile is active");
        throw new RuntimeException("Test profile requires Firestore emulator");
    }

    /**
     * Fallback Firestore instance for when no specific profile is active.
     * This is a safety measure and will throw an error in production.
     *
     * @return A Firestore instance
     */
    @Bean
    @Profile("default")
    public Firestore firestoreDefault() {
        log.warn("No specific profile active (dev/prod/test), using development database");
        return firestoreDev(); // Default to development database
    }
}