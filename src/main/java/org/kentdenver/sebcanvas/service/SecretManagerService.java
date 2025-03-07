package org.kentdenver.sebcanvas.service;

import com.google.api.gax.rpc.NotFoundException;
import com.google.cloud.secretmanager.v1.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;

/**
 * Service for interacting with Google Cloud Secret Manager.
 * Provides methods to retrieve and update secrets.
 */
@Service
@Slf4j
public class SecretManagerService {

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    /**
     * Retrieves a secret value from Google Cloud Secret Manager.
     * If the secret doesn't exist, returns null.
     *
     * @param secretId The secret ID
     * @param version The version of the secret, usually "latest"
     * @return The secret value as a string, or null if the secret doesn't exist
     * @throws IOException If an error occurs accessing the secret
     */
    public String getSecret(String secretId, String version) throws IOException {
        if (projectId == null || projectId.isEmpty()) {
            log.warn("Project ID not configured, cannot access Secret Manager");
            return null;
        }

        try (SecretManagerServiceClient client = SecretManagerServiceClient.create()) {
            SecretVersionName secretVersionName = SecretVersionName.of(projectId, secretId, version);
            try {
                AccessSecretVersionResponse response = client.accessSecretVersion(secretVersionName);
                return response.getPayload().getData().toStringUtf8();
            } catch (NotFoundException e) {
                log.warn("Secret not found: {}:{}", secretId, version);
                return null;
            }
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

        try (SecretManagerServiceClient client = SecretManagerServiceClient.create()) {
            SecretName secretName = SecretName.of(projectId, secretId);

            // Check if the secret exists
            try {
                client.getSecret(secretName);
            } catch (NotFoundException e) {
                // Secret doesn't exist, create it
                log.info("Secret {} does not exist, creating it", secretId);
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

            SecretVersion secretVersion = client.addSecretVersion(request);
            log.info("Updated secret {} with new version: {}", secretId, secretVersion.getName());
            return true;
        } catch (Exception e) {
            log.error("Failed to update secret: {}", secretId, e);
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
}
