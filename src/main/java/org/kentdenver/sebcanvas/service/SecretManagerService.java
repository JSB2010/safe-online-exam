package org.kentdenver.sebcanvas.service;

import com.google.api.gax.core.CredentialsProvider;
import com.google.api.gax.rpc.ApiException;
import com.google.api.gax.rpc.NotFoundException;
import com.google.cloud.secretmanager.v1.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;

/**
 * Service for interacting with Google Cloud Secret Manager.
 * Provides methods to retrieve and update secrets with fallback to environment variables.
 */
@Service
@Slf4j
public class SecretManagerService {

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    // For environments where we don't have a CredentialsProvider bean
    // we'll handle the null case gracefully
    private final CredentialsProvider credentialsProvider;

    /**
     * Constructor for SecretManagerService.
     *
     * @param credentialsProvider Provider for Google Cloud authentication credentials
     *                           (can be null in environments without GCP integration)
     */
    @Autowired(required = false)
    public SecretManagerService(CredentialsProvider credentialsProvider) {
        this.credentialsProvider = credentialsProvider;
        log.info("SecretManagerService initialized with credentialsProvider: {}", (credentialsProvider != null ? "provided" : "null"));
    }

    /**
     * Retrieves a secret value from Google Cloud Secret Manager.
     * If the secret doesn't exist or if Secret Manager is not accessible,
     * falls back to checking environment variables.
     *
     * @param secretId The secret ID
     * @param version The version of the secret, usually "latest"
     * @return The secret value as a string, or null if not found
     * @throws IOException If an error occurs accessing the secret
     */
    public String getSecret(String secretId, String version) throws IOException {
        if (projectId == null || projectId.isEmpty()) {
            log.warn("Project ID not configured, cannot access Secret Manager. secretId={}", secretId);
            String envValue = getEnvironmentVariable(secretId);
            log.info("Using environment variable fallback for secret: {}, found: {}",
                    secretId, (envValue != null ? "yes" : "no"));
            return envValue;
        }

        // Create the client
        try (SecretManagerServiceClient client = createClient()) {
            if (client == null) {
                log.warn("Failed to create Secret Manager client, using environment fallback for: {}", secretId);
                return getEnvironmentVariable(secretId);
            }

            SecretVersionName secretVersionName = SecretVersionName.of(projectId, secretId, version);
            try {
                // Access the secret version
                log.debug("Attempting to access secret: {}, version: {}, in project: {}",
                        secretId, version, projectId);
                AccessSecretVersionResponse response = client.accessSecretVersion(secretVersionName);
                log.info("Successfully retrieved secret: {}", secretId);
                return response.getPayload().getData().toStringUtf8();
            } catch (NotFoundException e) {
                log.warn("Secret not found: {}:{} in project {}", secretId, version, projectId);
                return getEnvironmentVariable(secretId);
            } catch (ApiException e) {
                log.error("Error accessing secret {}:{} in project {}: {}",
                        secretId, version, projectId, e.getMessage());
                return getEnvironmentVariable(secretId);
            }
        } catch (Exception e) {
            log.error("Failed to create Secret Manager client: {}", e.getMessage());
            return getEnvironmentVariable(secretId);
        }
    }

    /**
     * Updates an existing secret in Google Cloud Secret Manager.
     * This adds a new version with the updated value.
     * If the secret doesn't exist, it will be created.
     *
     * @param secretId The secret ID
     * @param secretValue The new secret value
     * @return True if the update was successful
     * @throws IOException If an error occurs updating the secret
     */
    public boolean updateSecret(String secretId, String secretValue) throws IOException {
        if (projectId == null || projectId.isEmpty()) {
            log.warn("Project ID not configured, cannot update Secret Manager. secretId={}", secretId);
            return false;
        }

        try (SecretManagerServiceClient client = createClient()) {
            if (client == null) {
                log.warn("Failed to create Secret Manager client, cannot update secret: {}", secretId);
                return false;
            }

            SecretName secretName = SecretName.of(projectId, secretId);

            // Check if the secret exists
            try {
                client.getSecret(secretName);
                log.debug("Secret {} exists in project {}", secretId, projectId);
            } catch (NotFoundException e) {
                // Secret doesn't exist, create it
                log.info("Secret {} does not exist in project {}, creating it", secretId, projectId);
                createSecret(client, secretId);
            }

            // Create the secret payload
            SecretPayload payload = SecretPayload.newBuilder()
                    .setData(com.google.protobuf.ByteString.copyFromUtf8(secretValue))
                    .build();

            // Add a new version to the secret
            AddSecretVersionRequest request = AddSecretVersionRequest.newBuilder()
                    .setParent(secretName.toString())
                    .setPayload(payload)
                    .build();

            try {
                SecretVersion secretVersion = client.addSecretVersion(request);
                log.info("Updated secret {} with new version: {}", secretId, secretVersion.getName());
                return true;
            } catch (ApiException e) {
                log.error("Failed to add version to secret {}: {}", secretId, e.getMessage());
                return false;
            }
        } catch (Exception e) {
            log.error("Failed to update secret {}: {}", secretId, e.getMessage());
            return false;
        }
    }

    /**
     * Creates a new secret in Google Cloud Secret Manager.
     *
     * @param client The Secret Manager client
     * @param secretId The secret ID
     * @throws IOException If an error occurs creating the secret
     */
    private void createSecret(SecretManagerServiceClient client, String secretId) throws IOException {
        try {
            ProjectName projectName = ProjectName.of(projectId);

            // Create the secret with automatic replication
            Secret secret = Secret.newBuilder()
                    .setReplication(Replication.newBuilder()
                            .setAutomatic(Replication.Automatic.newBuilder().build())
                            .build())
                    .build();

            CreateSecretRequest request = CreateSecretRequest.newBuilder()
                    .setParent(projectName.toString())
                    .setSecretId(secretId)
                    .setSecret(secret)
                    .build();

            client.createSecret(request);
            log.info("Created new secret: {}", secretId);
        } catch (Exception e) {
            throw new IOException("Failed to create secret: " + secretId, e);
        }
    }

    /**
     * Creates a Secret Manager client with the proper credentials.
     * Handles cases where credentials might not be available.
     *
     * @return A configured SecretManagerServiceClient
     * @throws IOException If there's an error creating the client
     */
    private SecretManagerServiceClient createClient() throws IOException {
        try {
            // If we have a credentials provider, use it
            if (credentialsProvider != null) {
                log.info("Creating Secret Manager client with explicit credentials provider");
                return SecretManagerServiceClient.create(
                        SecretManagerServiceSettings.newBuilder()
                                .setCredentialsProvider(credentialsProvider)
                                .build());
            } else {
                // Otherwise use default credentials
                log.info("No credentials provider available, using application default credentials");
                log.info("Current environment: K_SERVICE={}, GOOGLE_APPLICATION_CREDENTIALS={}",
                        System.getenv("K_SERVICE"), System.getenv("GOOGLE_APPLICATION_CREDENTIALS"));
                return SecretManagerServiceClient.create();
            }
        } catch (IOException e) {
            log.error("Failed to create Secret Manager client: {}", e.getMessage(), e);
            // Log additional details that might help troubleshoot
            if (projectId == null || projectId.isEmpty()) {
                log.error("Project ID is null or empty, which may cause Secret Manager issues");
            }
            log.error("Running with profile: {}", activeProfile);
            log.error("Credentials provider null? {}", (credentialsProvider == null));

            // Log relevant environment variables for troubleshooting
            String k8sService = System.getenv("K_SERVICE");
            String credentialsPath = System.getenv("GOOGLE_APPLICATION_CREDENTIALS");
            String gcpProjectId = System.getenv("GCP_PROJECT_ID");

            log.error("Environment information: K_SERVICE={}, GCP_PROJECT_ID={}, GOOGLE_APPLICATION_CREDENTIALS={}",
                    k8sService, gcpProjectId, credentialsPath);

            throw e;
        }
    }

    /**
     * Fallback method to get values from environment variables
     * if Secret Manager fails or is not configured.
     *
     * @param secretId The secret ID to look for as environment variable
     * @return The environment variable value or null
     */
    private String getEnvironmentVariable(String secretId) {
        // First try direct match
        String value = System.getenv(secretId);
        if (value != null && !value.isEmpty()) {
            log.info("Retrieved value for {} directly from environment", secretId);
            return value;
        }

        // Then try uppercase with underscores
        String envVarFormat = secretId.toUpperCase().replace('-', '_');
        value = System.getenv(envVarFormat);

        if (value != null && !value.isEmpty()) {
            log.info("Retrieved value for {} from environment variable {}", secretId, envVarFormat);
            return value;
        }

        // Try additional formats that might be used in Cloud Run
        if (secretId.contains("_")) {
            // Try different case variations
            String[] formats = {
                    secretId,
                    secretId.toUpperCase(),
                    secretId.toLowerCase()
            };

            for (String format : formats) {
                value = System.getenv(format);
                if (value != null && !value.isEmpty()) {
                    log.info("Retrieved value for {} from environment variable {}", secretId, format);
                    return value;
                }
            }
        }

        log.warn("Value for {} not found in environment variables", secretId);
        return null;
    }
}