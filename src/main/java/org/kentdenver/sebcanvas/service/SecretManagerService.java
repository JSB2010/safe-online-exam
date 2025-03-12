package org.kentdenver.sebcanvas.service;

import com.google.api.gax.core.CredentialsProvider;
import com.google.api.gax.core.FixedCredentialsProvider;
import com.google.api.gax.grpc.GrpcStatusCode;
import com.google.api.gax.grpc.InstantiatingGrpcChannelProvider;
import com.google.api.gax.rpc.ApiException;
import com.google.api.gax.rpc.ClientSettings;
import com.google.api.gax.rpc.DeadlineExceededException;
import com.google.api.gax.rpc.NotFoundException;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.secretmanager.v1.*;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryConfig;
import io.github.resilience4j.retry.RetryRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.threeten.bp.Duration;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.*;
import java.util.function.Supplier;

/**
 * Enhanced service for interacting with Google Cloud Secret Manager.
 * Provides methods to retrieve and update secrets with better reliability,
 * faster timeouts, intelligent retries, and improved fallback to environment variables.
 *
 * This implementation includes:
 * - Fast timeouts (configurable, default 5s)
 * - Intelligent retry with backoff
 * - In-memory caching to reduce API calls
 * - Comprehensive environment variable fallbacks
 * - Background pre-fetching of common secrets
 */
@Service
@Slf4j
public class SecretManagerService {

    private static final int DEFAULT_TIMEOUT_SECONDS = 5;
    private static final int MAX_RETRIES = 3;
    private static final int INITIAL_RETRY_DELAY_MS = 200;
    private static final String RETRY_INSTANCE = "secretManagerRetry";

    // Cache to avoid repeated round trips for the same secret
    private final ConcurrentHashMap<String, CachedSecret> secretCache = new ConcurrentHashMap<>();

    // Executor for timeouts
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @Value("${secret-manager.client.timeout-seconds:" + DEFAULT_TIMEOUT_SECONDS + "}")
    private int timeoutSeconds;

    @Value("${secret-manager.cache.ttl-seconds:300}") // 5 minutes default
    private int cacheTtlSeconds;

    @Value("${secret-manager.prefetch.enabled:true}")
    private boolean prefetchEnabled;

    // For environments where we don't have a CredentialsProvider bean
    // we'll handle the null case gracefully
    private final CredentialsProvider credentialsProvider;

    // Register retry with resilience4j
    private final RetryRegistry retryRegistry;

    /**
     * Inner class to store cached secrets with expiration
     */
    private static class CachedSecret {
        private final String value;
        private final long expiresAt;

        public CachedSecret(String value, long ttlSeconds) {
            this.value = value;
            this.expiresAt = System.currentTimeMillis() + (ttlSeconds * 1000);
        }

        public boolean isExpired() {
            return System.currentTimeMillis() > expiresAt;
        }

        public String getValue() {
            return value;
        }
    }

    /**
     * Constructor for SecretManagerService with retry configuration.
     *
     * @param credentialsProvider Provider for Google Cloud authentication credentials
     *                           (can be null in environments without GCP integration)
     */
    @Autowired(required = false)
    public SecretManagerService(CredentialsProvider credentialsProvider) {
        this.credentialsProvider = credentialsProvider;

        // Configure retry behavior
        RetryConfig retryConfig = RetryConfig.custom()
                .maxAttempts(MAX_RETRIES)
                .waitDuration(java.time.Duration.ofMillis(INITIAL_RETRY_DELAY_MS))
                .retryOnResult(result -> result == null)
                .retryExceptions(
                        ApiException.class,
                        DeadlineExceededException.class,
                        IOException.class,
                        TimeoutException.class
                )
                .ignoreExceptions(NotFoundException.class) // Don't retry if secret doesn't exist
                .build();

        Map<String, RetryConfig> configs = new HashMap<>();
        configs.put(RETRY_INSTANCE, retryConfig);
        this.retryRegistry = RetryRegistry.of(configs);

        log.info("SecretManagerService initialized with timeout: {}s, max retries: {}, caching: {}s",
                timeoutSeconds, MAX_RETRIES, cacheTtlSeconds);
    }

    /**
     * Initialize service by pre-fetching common secrets
     */
    @PostConstruct
    public void init() {
        if (prefetchEnabled) {
            log.info("Pre-fetching common secrets for faster startup");
            CompletableFuture.runAsync(() -> {
                try {
                    // Pre-fetch common secrets used in the application
                    String[] commonSecrets = {
                            "dev_lti_client_id",
                            "dev_lti_private_key",
                            "dev_tool_url",
                            "dev_admin_password"
                    };

                    for (String secretId : commonSecrets) {
                        try {
                            getSecret(secretId, "latest");
                            log.debug("Pre-fetched secret: {}", secretId);
                        } catch (Exception e) {
                            log.warn("Failed to pre-fetch secret: {}, will fetch on demand", secretId);
                        }
                    }
                } catch (Exception e) {
                    log.warn("Error during secret pre-fetching", e);
                }
            });
        }
    }

    /**
     * Retrieves a secret value from Google Cloud Secret Manager with improved reliability.
     * Uses short timeouts, retries with backoff, caching, and fallback to environment variables.
     *
     * @param secretId The secret ID
     * @param version The version of the secret, usually "latest"
     * @return The secret value as a string, or null if not found
     * @throws IOException If an error occurs accessing the secret after all retries
     */
    public String getSecret(String secretId, String version) throws IOException {
        // Check cache first to avoid repeated calls
        CachedSecret cachedSecret = secretCache.get(getCacheKey(secretId, version));
        if (cachedSecret != null && !cachedSecret.isExpired()) {
            log.debug("Using cached value for secret: {}", secretId);
            return cachedSecret.getValue();
        }

        // If no project ID is configured, go straight to environment variables
        if (projectId == null || projectId.isEmpty()) {
            log.warn("Project ID not configured, cannot access Secret Manager. secretId={}", secretId);
            String envValue = getEnvironmentVariable(secretId);
            cacheSecretIfPresent(secretId, version, envValue);
            return envValue;
        }

        // Configure retry mechanism
        Retry retry = retryRegistry.retry(RETRY_INSTANCE);

        try {
            // Wrap the secret retrieval in retry logic
            Supplier<String> secretRetriever = Retry.decorateSupplier(retry,
                    () -> retrieveSecretWithTimeout(secretId, version));

            // Execute with retry
            String secretValue = secretRetriever.get();

            // If secret is null, try environment variables as fallback
            if (secretValue == null) {
                log.warn("Secret not found in Secret Manager, trying environment variables: {}", secretId);
                secretValue = getEnvironmentVariable(secretId);
            }

            // Cache the result if we found something
            cacheSecretIfPresent(secretId, version, secretValue);

            return secretValue;
        } catch (Exception e) {
            log.error("Failed to retrieve secret {} after {} retries: {}",
                    secretId, MAX_RETRIES, e.getMessage());

            // Final fallback to environment variables
            String envValue = getEnvironmentVariable(secretId);
            cacheSecretIfPresent(secretId, version, envValue);

            if (envValue != null) {
                return envValue;
            }

            // If we reach here, all retrieval methods failed
            if (e instanceof IOException) {
                throw (IOException) e;
            } else {
                throw new IOException("Failed to retrieve secret: " + secretId, e);
            }
        }
    }

    /**
     * Retrieves a secret with a strict timeout to avoid hanging operations
     */
    private String retrieveSecretWithTimeout(String secretId, String version) {
        Future<String> future = executor.submit(() -> {
            try (SecretManagerServiceClient client = createClient()) {
                if (client == null) {
                    log.warn("Failed to create Secret Manager client");
                    return null;
                }

                SecretVersionName secretVersionName = SecretVersionName.of(projectId, secretId, version);

                // Access the secret version
                log.debug("Attempting to access secret: {}, version: {}, in project: {}",
                        secretId, version, projectId);

                AccessSecretVersionResponse response = client.accessSecretVersion(secretVersionName);
                log.info("Successfully retrieved secret: {}", secretId);

                return response.getPayload().getData().toStringUtf8();
            } catch (NotFoundException e) {
                log.warn("Secret not found: {}:{} in project {}", secretId, version, projectId);
                return null;
            } catch (Exception e) {
                log.error("Error accessing secret {}:{} in project {}: {}",
                        secretId, version, projectId, e.getMessage());
                throw new RuntimeException(e);
            }
        });

        try {
            // Wait with timeout for the result
            return future.get(timeoutSeconds, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            log.error("Timeout accessing secret {}:{} after {} seconds",
                    secretId, version, timeoutSeconds);
            future.cancel(true);
            throw new DeadlineExceededException(
                    "Secret Manager operation timed out after " + timeoutSeconds + " seconds",
                    null, GrpcStatusCode.of(io.grpc.Status.Code.DEADLINE_EXCEEDED), false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            future.cancel(true);
            throw new RuntimeException("Secret retrieval interrupted", e);
        } catch (ExecutionException e) {
            future.cancel(true);
            if (e.getCause() instanceof RuntimeException) {
                throw (RuntimeException) e.getCause();
            }
            throw new RuntimeException("Error retrieving secret", e.getCause());
        }
    }

    /**
     * Caches a secret value if it's not null
     */
    private void cacheSecretIfPresent(String secretId, String version, String value) {
        if (value != null && cacheTtlSeconds > 0) {
            secretCache.put(getCacheKey(secretId, version), new CachedSecret(value, cacheTtlSeconds));
        }
    }

    /**
     * Creates a cache key for a secret
     */
    private String getCacheKey(String secretId, String version) {
        return secretId + ":" + version;
    }

    /**
     * Updates an existing secret in Google Cloud Secret Manager with enhanced reliability.
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

        // Configure retry for update operation
        Retry retry = retryRegistry.retry(RETRY_INSTANCE);

        try {
            // Wrap the update operation in retry logic
            Supplier<Boolean> updateOperation = Retry.decorateSupplier(retry, () -> {
                return updateSecretWithTimeout(secretId, secretValue);
            });

            // Execute with retry
            boolean result = updateOperation.get();

            // Update cache if successful
            if (result) {
                cacheSecretIfPresent(secretId, "latest", secretValue);
            }

            return result;
        } catch (Exception e) {
            log.error("Failed to update secret {} after {} retries: {}",
                    secretId, MAX_RETRIES, e.getMessage());

            if (e instanceof IOException) {
                throw (IOException) e;
            } else {
                throw new IOException("Failed to update secret: " + secretId, e);
            }
        }
    }

    /**
     * Updates a secret with a strict timeout
     */
    private Boolean updateSecretWithTimeout(String secretId, String secretValue) {
        Future<Boolean> future = executor.submit(() -> {
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

                SecretVersion secretVersion = client.addSecretVersion(request);
                log.info("Updated secret {} with new version: {}", secretId, secretVersion.getName());
                return true;
            } catch (Exception e) {
                log.error("Failed to update secret {}: {}", secretId, e.getMessage());
                throw new RuntimeException(e);
            }
        });

        try {
            // Wait with timeout for the result
            return future.get(timeoutSeconds, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            log.error("Timeout updating secret {} after {} seconds", secretId, timeoutSeconds);
            future.cancel(true);
            throw new DeadlineExceededException(
                    "Secret Manager operation timed out after " + timeoutSeconds + " seconds",
                    null, GrpcStatusCode.of(io.grpc.Status.Code.DEADLINE_EXCEEDED), false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            future.cancel(true);
            throw new RuntimeException("Secret update interrupted", e);
        } catch (ExecutionException e) {
            future.cancel(true);
            if (e.getCause() instanceof RuntimeException) {
                throw (RuntimeException) e.getCause();
            }
            throw new RuntimeException("Error updating secret", e.getCause());
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
     * Creates a Secret Manager client with the proper credentials and timeout settings.
     * Handles cases where credentials might not be available.
     *
     * @return A configured SecretManagerServiceClient
     * @throws IOException If there's an error creating the client
     */
    private SecretManagerServiceClient createClient() throws IOException {
        try {
            // Configure the channel provider with proper keepalive settings
            InstantiatingGrpcChannelProvider channelProvider = InstantiatingGrpcChannelProvider.newBuilder()
                    .setKeepAliveTime(Duration.ofSeconds(30))
                    .setKeepAliveTimeout(Duration.ofSeconds(5))
                    .setKeepAliveWithoutCalls(true)
                    .build();

            // Configure client settings
            SecretManagerServiceSettings.Builder settingsBuilder = SecretManagerServiceSettings.newBuilder()
                    .setTransportChannelProvider(channelProvider);

            // Use the threeten.bp.Duration for all timeouts in the client
            Duration timeoutDuration = Duration.ofSeconds(timeoutSeconds);

            // Apply timeout to all unary methods
            settingsBuilder.accessSecretVersionSettings()
                    .setRetrySettings(
                            settingsBuilder.accessSecretVersionSettings().getRetrySettings().toBuilder()
                                    .setInitialRetryDelay(Duration.ofMillis(INITIAL_RETRY_DELAY_MS))
                                    .setInitialRpcTimeout(timeoutDuration)
                                    .setMaxRpcTimeout(timeoutDuration)
                                    .setTotalTimeout(Duration.ofSeconds(timeoutSeconds * 2))
                                    .build());

            settingsBuilder.getSecretSettings()
                    .setRetrySettings(
                            settingsBuilder.getSecretSettings().getRetrySettings().toBuilder()
                                    .setInitialRpcTimeout(timeoutDuration)
                                    .setMaxRpcTimeout(timeoutDuration)
                                    .setTotalTimeout(Duration.ofSeconds(timeoutSeconds * 2))
                                    .build());

            settingsBuilder.addSecretVersionSettings()
                    .setRetrySettings(
                            settingsBuilder.addSecretVersionSettings().getRetrySettings().toBuilder()
                                    .setInitialRpcTimeout(timeoutDuration)
                                    .setMaxRpcTimeout(timeoutDuration)
                                    .setTotalTimeout(Duration.ofSeconds(timeoutSeconds * 2))
                                    .build());

            // If we have a credentials provider, use it
            if (credentialsProvider != null) {
                log.info("Creating Secret Manager client with explicit credentials provider");
                settingsBuilder.setCredentialsProvider(credentialsProvider);
            } else {
                // Try to get default credentials
                log.debug("No credentials provider available, using application default credentials");

                // Try to get credentials from environment
                try {
                    GoogleCredentials credentials = GoogleCredentials.getApplicationDefault();
                    settingsBuilder.setCredentialsProvider(FixedCredentialsProvider.create(credentials));
                    log.debug("Successfully loaded application default credentials");
                } catch (IOException e) {
                    log.warn("Failed to load application default credentials: {}", e.getMessage());
                    // Continue without explicit credentials, the client will try other methods
                }
            }

            return SecretManagerServiceClient.create(settingsBuilder.build());
        } catch (IOException e) {
            log.error("Failed to create Secret Manager client: {}", e.getMessage(), e);

            // Log additional details that might help troubleshoot
            if (projectId == null || projectId.isEmpty()) {
                log.error("Project ID is null or empty, which may cause Secret Manager issues");
            }

            // Log relevant environment variables for troubleshooting
            Map<String, String> envInfo = new HashMap<>();
            envInfo.put("PROFILE", activeProfile);
            envInfo.put("K_SERVICE", Optional.ofNullable(System.getenv("K_SERVICE")).orElse(""));
            envInfo.put("GCP_PROJECT_ID", Optional.ofNullable(System.getenv("GCP_PROJECT_ID")).orElse(""));
            envInfo.put("GOOGLE_APPLICATION_CREDENTIALS",
                    Optional.ofNullable(System.getenv("GOOGLE_APPLICATION_CREDENTIALS")).orElse(""));

            log.error("Environment information: {}", envInfo);
            throw e;
        }
    }

    /**
     * Fallback method to get values from environment variables
     * if Secret Manager fails or is not configured.
     * Checks multiple variations of the variable name for better compatibility.
     *
     * @param secretId The secret ID to look for as environment variable
     * @return The environment variable value or null
     */
    private String getEnvironmentVariable(String secretId) {
        // Generate all possible environment variable names
        String[] possibleEnvVars = {
                // Original name
                secretId,

                // Uppercase with underscores (common for env vars)
                secretId.toUpperCase().replace('-', '_'),

                // Lowercase with underscores
                secretId.toLowerCase().replace('-', '_'),

                // Direct uppercase
                secretId.toUpperCase(),

                // Direct lowercase
                secretId.toLowerCase(),

                // With profile prefix (e.g. DEV_SECRET_NAME)
                (activeProfile + "_" + secretId).toUpperCase().replace('-', '_')
        };

        // Try all possible names
        for (String envVar : possibleEnvVars) {
            String value = System.getenv(envVar);
            if (value != null && !value.isEmpty()) {
                log.info("Retrieved value for {} from environment variable {}", secretId, envVar);
                return value;
            }
        }

        // Special case: Check if secret was added with --set-secrets in Cloud Run
        // These are typically available as direct environment variables
        if (secretId.startsWith("dev_")) {
            // Remove the prefix and check capitalized version
            String cloudRunVar = secretId.substring(4).toUpperCase();
            String value = System.getenv(cloudRunVar);
            if (value != null && !value.isEmpty()) {
                log.info("Retrieved value for {} from Cloud Run environment variable {}", secretId, cloudRunVar);
                return value;
            }
        }

        log.warn("Value for {} not found in environment variables", secretId);
        return null;
    }

    /**
     * Clears the secret cache. Useful for testing or when secrets have been rotated.
     */
    public void clearCache() {
        secretCache.clear();
        log.info("Secret cache cleared");
    }

    /**
     * Manually set a timeout for Secret Manager operations.
     * This is primarily used for testing or when dynamic reconfiguration is needed.
     *
     * @param seconds The timeout in seconds
     */
    public void setTimeoutSeconds(int seconds) {
        if (seconds >= 1 && seconds <= 60) {
            this.timeoutSeconds = seconds;
            log.info("Secret Manager timeout updated to {} seconds", seconds);
        } else {
            log.warn("Invalid timeout value {}. Must be between 1 and 60 seconds", seconds);
        }
    }
}