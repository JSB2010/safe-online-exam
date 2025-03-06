package org.kentdenver.sebcanvas.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;
import java.io.IOException;

/**
 * Configuration class for Google Cloud Firestore.
 * This class provides the Firestore instance that will be injected into repositories.
 * In development mode, it can connect to a local Firestore emulator if the
 * FIRESTORE_EMULATOR_HOST environment variable is set.
 * In production, it uses Application Default Credentials (ADC) for authentication.
 */
@Configuration
public class FirestoreConfig {

    @Value("${spring.cloud.gcp.project-id:canvas-seb-integration}")
    private String projectId;

    /**
     * Creates and configures a Firestore instance.
     *
     * Authentication is handled in different ways depending on the environment:
     * - Local development: Uses credentials from GOOGLE_APPLICATION_CREDENTIALS
     *   environment variable or gcloud CLI auth
     * - GCP Cloud Run: Uses the service account attached to the Cloud Run service
     *
     * @return A configured Firestore instance
     * @throws IOException If there's an error loading credentials
     */
    @Bean
    public Firestore firestore() throws IOException {
        // Build Firestore options
        FirestoreOptions firestoreOptions = FirestoreOptions.getDefaultInstance().toBuilder()
                .setProjectId(projectId)
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .build();

        return firestoreOptions.getService();
    }

    /**
     * For local development, provides an emulator-compatible Firestore if requested.
     * This method will only be active when the "dev" profile is active and the
     * FIRESTORE_EMULATOR_HOST environment variable is set.
     *
     * @return A Firestore instance configured to connect to the local emulator
     */
    @Bean
    @Profile("dev")
    public Firestore firestoreEmulator() {
        String emulatorHost = System.getenv("FIRESTORE_EMULATOR_HOST");
        if (emulatorHost != null && !emulatorHost.isEmpty()) {
            FirestoreOptions firestoreOptions = FirestoreOptions.getDefaultInstance().toBuilder()
                    .setProjectId("demo-project")
                    .setHost(emulatorHost)
                    .setCredentials(null) // No credentials for emulator
                    .build();
            return firestoreOptions.getService();
        } else {
            try {
                return firestore(); // Fall back to regular authentication
            } catch (IOException e) {
                throw new RuntimeException("Failed to create Firestore instance", e);
            }
        }
    }
}