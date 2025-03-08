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
 * This class provides the Firestore instance that will be injected into repositories.
 * It includes fallback mechanisms for development environments and graceful error handling.
 */
@Configuration
@Slf4j
public class FirestoreConfig {

    @Value("${spring.cloud.gcp.project-id:canvas-seb-integration}")
    private String projectId;

    /**
     * Creates and configures a Firestore instance for production use.
     * Uses Application Default Credentials (ADC) for authentication.
     *
     * @return A configured Firestore instance or null if initialization fails
     */
    @Bean
    @Primary
    public Firestore firestore() {
        try {
            log.info("Initializing Firestore with project ID: {}", projectId);

            // Build Firestore options with minimal configuration
            FirestoreOptions firestoreOptions = FirestoreOptions.getDefaultInstance().toBuilder()
                    .setProjectId(projectId)
                    .build();

            log.info("Successfully created Firestore configuration");
            return firestoreOptions.getService();
        } catch (Throwable e) {
            // Log the error but allow application to start without Firestore
            log.error("Failed to initialize Firestore: {}", e.getMessage());
            log.error("Application will start but Firestore-dependent features will not work");

            if (e instanceof NoClassDefFoundError) {
                log.error("Class not found error suggests a dependency conflict. Check Google Cloud library versions.");
            }

            // Return null to allow application to start
            // Note: Will cause NullPointerExceptions if Firestore is used, but better than preventing startup
            return null;
        }
    }

    /**
     * Creates a Firestore instance configured for the emulator in development environments.
     * Only active when the "dev" profile is active and FIRESTORE_EMULATOR_HOST is set.
     *
     * @return A Firestore instance for the emulator or a production instance as fallback
     */
    @Bean(name = "firestoreEmulator")
    @Profile("dev")
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
                log.warn("Failed to connect to Firestore emulator: {}", e.getMessage());
                log.warn("Falling back to regular Firestore authentication");
            }
        }

        // If emulator connection fails or isn't configured, try regular authentication
        log.info("No Firestore emulator configured, using regular authentication");
        try {
            return firestore(); // Reuse the regular method as fallback
        } catch (Exception e) {
            log.error("Failed to initialize any Firestore instance: {}", e.getMessage());
            return null;
        }
    }
}