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
 *
 * The @Slf4j annotation adds a 'log' field to the class for logging.
 * This addresses the compilation error related to missing 'log' variables.
 */
@Service
@Slf4j
public class SecretManagerService {

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

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
            log.warn("Project ID not configured, cannot access Secret Manager");
            return getEnvironmentVariable(secretId);
        }

        // Create the client
        try (SecretManagerServiceClient client = createClient()) {
            SecretVersionName secretVersionName = SecretVersionName.of(projectId, secretId, version);
            try {
                // Access the secret version
                AccessSecretVersionResponse response = client.accessSecretVersion(secretVersionName);
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
            log.warn("Project ID not configured, cannot update Secret Manager");
            return false;
        }

        try (SecretManagerServiceClient client = createClient()) {
            SecretName secretName = SecretName.of(projectId, secretId);

            // Check if the secret exists
            try {
                client.getSecret(secretName);
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
                return SecretManagerServiceClient.create(
                        SecretManagerServiceSettings.newBuilder()
                                .setCredentialsProvider(credentialsProvider)
                                .build());
            } else {
                // Otherwise use default credentials
                log.info("No credentials provider available, using application default credentials");
                return SecretManagerServiceClient.create();
            }
        } catch (IOException e) {
            log.error("Failed to create Secret Manager client", e);
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

        log.warn("Value for {} not found in environment variables", secretId);
        return null;
    }
}