package org.kentdenver.sebcanvas.service;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.text.ParseException;
import java.util.Date;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Service for JSON Web Key (JWK) operations.
 * Handles key retrieval from Secret Manager and JWT signing for Canvas API authentication.
 * This implementation ensures proper initialization timing with respect to configuration loading.
 */
@Service
@Slf4j
public class JwkService {

    private final SecretManagerService secretManagerService;
    private final LtiConfig ltiConfig;
    private RSAKey rsaKey;
    private JWSSigner signer;
    private String keyId;
    private volatile boolean initialized = false;
    private final ReentrantLock initLock = new ReentrantLock();
    private int secretManagerRetries = 3;

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    /**
     * Constructor that takes the secret manager service and LTI configuration.
     *
     * @param secretManagerService Service to retrieve secrets
     * @param ltiConfig LTI configuration containing tool URL and other settings
     */
    @Autowired
    public JwkService(SecretManagerService secretManagerService, LtiConfig ltiConfig) {
        this.secretManagerService = secretManagerService;
        this.ltiConfig = ltiConfig;
        log.info("JwkService created - will initialize lazily when needed");
    }

    /**
     * Initializes the RSA key for JWT signing.
     * This method loads the private key from Secret Manager or environment variable in JWK format.
     * It waits for the LtiConfig to be fully initialized to ensure proper URLs are used.
     */
    public void initialize() {
        // Use a lock to prevent concurrent initialization attempts
        if (initialized) {
            log.debug("JWK Service already initialized");
            return;
        }

        initLock.lock();
        try {
            // Double-check after acquiring lock
            if (initialized) {
                log.debug("JWK Service already initialized by another thread");
                return;
            }

            log.info("Initializing JWK Service to retrieve key from Secret Manager or environment variables");

            // Ensure LtiConfig is properly initialized with the right tool URL
            validateLtiConfig();

            // Track retry attempts
            final AtomicInteger retryCount = new AtomicInteger(0);
            boolean keyLoaded = false;

            // First check if we have the key directly in environment variables
            // This is set by Cloud Run's --set-secrets
            String jwkJson = System.getenv("LTI_PRIVATE_KEY");

            if (jwkJson != null && !jwkJson.isEmpty()) {
                try {
                    log.info("Found JWK in environment variable LTI_PRIVATE_KEY");
                    parseAndSetKey(jwkJson);
                    keyLoaded = true;
                } catch (Exception e) {
                    log.error("Failed to parse JWK from environment variable: {}", e.getMessage());
                    // Continue to Secret Manager as fallback
                }
            }

            // Implement retries with increasing delay
            while (retryCount.get() < secretManagerRetries && !keyLoaded) {
                try {
                    // Implement progressive backoff
                    if (retryCount.get() > 0) {
                        long sleepTime = Math.min(1000L * retryCount.get(), 5000L);
                        log.info("Retry #{} - waiting {}ms before attempting to load JWK",
                                retryCount.get(), sleepTime);
                        Thread.sleep(sleepTime);
                    }

                    // Try to load private key from Secret Manager
                    String secretName = ltiConfig.getActiveProfile().equals("prod") ?
                            "prod_lti_private_key" : "dev_lti_private_key";
                    jwkJson = secretManagerService.getSecret(secretName, "latest");

                    if (jwkJson != null && !jwkJson.isEmpty()) {
                        log.debug("Loaded private key JWK from Secret Manager, length: {} chars", jwkJson.length());

                        try {
                            parseAndSetKey(jwkJson);
                            keyLoaded = true;
                        } catch (Exception e) {
                            log.error("Failed to parse JWK from Secret Manager: {}", e.getMessage(), e);
                            retryCount.incrementAndGet();
                        }
                    } else {
                        log.error("CONFIGURATION ERROR: Private key not found in Secret Manager or is empty");
                        log.error("Please ensure the secret '{}' exists in project '{}'",
                                secretName, projectId);
                        log.error("Secret should contain a valid RSA private key in JWK format");

                        // No point retrying if the secret is missing or empty
                        break;
                    }
                } catch (Exception e) {
                    log.error("Error accessing Secret Manager (attempt {}/{}): {}",
                            retryCount.incrementAndGet(), secretManagerRetries, e.getMessage());
                }
            }

            // If we couldn't load a key after all retries, provide clear error
            if (!keyLoaded) {
                if (retryCount.get() >= secretManagerRetries) {
                    log.error("CRITICAL ERROR: Failed to load JWK after {} attempts", secretManagerRetries);
                }

                log.error("CANVAS INTEGRATION WILL NOT WORK WITHOUT A VALID KEY");
                log.error("Please verify the following:");
                log.error("1. The appropriate secret exists in Secret Manager in project '{}'", projectId);
                log.error("2. The service account has Secret Manager access");
                log.error("3. Network connectivity to Secret Manager is working");
                log.error("4. The key is provided via LTI_PRIVATE_KEY environment variable in Cloud Run");

                // Don't throw exception to allow app to start, but set not initialized state
                initialized = false;
            } else {
                // Verify we can create a JWT with the current configuration
                validateJwtCreation();
            }
        } finally {
            initLock.unlock();
        }
    }

    /**
     * Validates that the LtiConfig is properly initialized with a valid tool URL.
     * If not, waits or uses fallback strategies to ensure proper initialization.
     */
    private void validateLtiConfig() {
        // Check if the LtiConfig has a valid tool URL
        String toolUrl = ltiConfig.getSanitizedToolUrl();

        if (toolUrl == null || toolUrl.isEmpty() || toolUrl.contains("localhost")) {
            log.warn("LtiConfig doesn't have a valid tool URL yet: {}", toolUrl);

            // Wait for LtiConfig to be properly initialized
            int maxRetries = 3;
            for (int i = 0; i < maxRetries; i++) {
                try {
                    log.info("Waiting for LtiConfig to complete initialization (attempt {}/{})", i+1, maxRetries);
                    Thread.sleep(1000); // Wait 1 second before checking again

                    // Trigger LtiConfig initialization if it hasn't happened yet
                    ltiConfig.init();

                    // Check if we have a valid URL now
                    toolUrl = ltiConfig.getSanitizedToolUrl();
                    if (toolUrl != null && !toolUrl.isEmpty() && !toolUrl.contains("localhost")) {
                        log.info("LtiConfig now has a valid tool URL: {}", toolUrl);
                        return;
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    log.warn("Interrupted while waiting for LtiConfig to initialize", e);
                    break;
                }
            }

            log.warn("Could not wait for LtiConfig to properly initialize. JWK initialization may use placeholder URLs.");
        } else {
            log.info("LtiConfig is properly initialized with tool URL: {}", toolUrl);
        }
    }

    /**
     * Get the RSA key.
     * Initializes the service if not already done.
     */
    public RSAKey getRsaKey() {
        ensureInitialized();
        return rsaKey;
    }

    /**
     * Get the key ID.
     * Initializes the service if not already done.
     */
    public String getKeyId() {
        ensureInitialized();
        return keyId;
    }

    /**
     * Get the JWS signer.
     * Initializes the service if not already done.
     */
    public JWSSigner getSigner() {
        ensureInitialized();
        return signer;
    }

    /**
     * Ensure the service is initialized before use.
     * Throws exception if initialization fails to prevent silent failures.
     */
    private void ensureInitialized() {
        if (!initialized) {
            log.debug("Lazy initialization of JWK Service");
            initialize();

            if (!initialized) {
                throw new IllegalStateException(
                        "JWK Service could not be initialized - Canvas integration will not work. " +
                                "Check logs for details on how to fix this issue.");
            }
        }
    }

    /**
     * Creates a signed JWT for client credentials authentication with Canvas API.
     * Enhanced to ensure proper formatting of claims and guarantee HTTPS for production URLs.
     * Uses the current tool URL from LtiConfig as the issuer if not overridden.
     *
     * @param clientId The client ID (from LTI configuration)
     * @param issuer The issuer (typically the tool URL, if null uses LtiConfig's toolUrl)
     * @param audience The audience (typically the Canvas token URL)
     * @return A signed JWT string
     * @throws JOSEException If signing fails
     */
    public String createSignedJwt(String clientId, String issuer, String audience) throws JOSEException {
        ensureInitialized();

        // Current time
        Date now = new Date();

        // If issuer is null or empty, use the tool URL from LtiConfig
        if (issuer == null || issuer.isEmpty()) {
            issuer = ltiConfig.getSanitizedToolUrl();
            log.info("Using tool URL from LtiConfig as issuer: {}", issuer);
        }

        // Clean up issuer and audience URLs to ensure proper format
        // Remove trailing slashes which can cause validation issues
        if (issuer != null && issuer.endsWith("/")) {
            issuer = issuer.substring(0, issuer.length() - 1);
            log.debug("Removed trailing slash from issuer URL: {}", issuer);
        }

        if (audience != null && audience.endsWith("/")) {
            audience = audience.substring(0, audience.length() - 1);
            log.debug("Removed trailing slash from audience URL: {}", audience);
        }

        // Ensure URLs use https for non-localhost environments
        if (issuer != null && issuer.startsWith("http://") && !issuer.contains("localhost")) {
            String oldIssuer = issuer;
            issuer = "https://" + issuer.substring(7);
            log.warn("Changed issuer from http to https: {} -> {}", oldIssuer, issuer);
        }

        // Log detailed information about the JWT we're creating
        log.info("Creating signed JWT with the following parameters:");
        log.info(" - Issuer: {}", issuer);
        log.info(" - Subject (Client ID): {}", clientId);
        log.info(" - Audience: {}", audience);
        log.info(" - Key ID: {}", keyId);

        // Build JWT claims
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .subject(clientId)
                .audience(audience)
                .issueTime(now)
                .expirationTime(new Date(now.getTime() + 5 * 60 * 1000)) // 5 minutes expiry
                .jwtID(UUID.randomUUID().toString())
                .build();

        // Create header with algorithm and key ID
        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(keyId)
                .type(JOSEObjectType.JWT)
                .build();

        // Create and sign the JWT
        SignedJWT signedJWT = new SignedJWT(header, claims);
        signedJWT.sign(signer);

        // Log JWT details for debugging
        String serialized = signedJWT.serialize();
        log.debug("JWT created and signed successfully, length: {} characters", serialized.length());

        return serialized;
    }

    /**
     * Validates that we can create a JWT with the current configuration.
     * This helps catch issues early in the initialization process.
     */
    private void validateJwtCreation() {
        try {
            // Use the tool URL from LtiConfig as the issuer
            String toolUrl = ltiConfig.getSanitizedToolUrl();
            String audience = ltiConfig.getTokenUrl();

            // Create a test JWT
            String jwt = createSignedJwt("test-client-id", toolUrl, audience);
            log.info("Successfully validated JWT creation with current configuration. JWT length: {} chars", jwt.length());
            initialized = true;
        } catch (Exception e) {
            log.warn("JWT validation during initialization failed. This may indicate configuration issues:", e);
            initialized = false;
        }
    }

    /**
     * Parse and set the RSA key from JWK JSON.
     * Centralized method to avoid code duplication.
     */
    private void parseAndSetKey(String jwkJson) throws ParseException, JOSEException {
        JWK jwk = JWK.parse(jwkJson);

        if (!(jwk instanceof RSAKey)) {
            throw new IllegalArgumentException("JWK is not an RSA key");
        }

        this.rsaKey = (RSAKey) jwk;
        if (!this.rsaKey.isPrivate()) {
            throw new IllegalArgumentException("RSA key does not contain private key information");
        }

        this.keyId = this.rsaKey.getKeyID();
        if (this.keyId == null || this.keyId.isEmpty()) {
            this.keyId = "canvas-seb-integration-key";
            this.rsaKey = new RSAKey.Builder(this.rsaKey)
                    .keyID(this.keyId)
                    .build();
        }

        this.signer = new RSASSASigner(this.rsaKey);

        // Log the public key for registration
        JWK publicJwk = new RSAKey.Builder(this.rsaKey.toRSAPublicKey())
                .keyID(this.keyId)
                .build();
        log.info("Public key for Canvas registration: {}", publicJwk.toJSONString());

        initialized = true;
        log.info("JWK Service successfully initialized with key ID: {}", keyId);
    }

    /**
     * Check if the JWK service is properly initialized.
     * This method helps diagnose JWT issues.
     *
     * @return true if the service is initialized, false otherwise
     */
    public boolean isInitialized() {
        return initialized;
    }

    /**
     * Reinitialize the JWK service with a specific tool URL.
     * This is useful for fixing JWT issuer URL issues.
     *
     * @param toolUrl The correct tool URL to use as the JWT issuer
     */
    public void reinitializeWithToolUrl(String toolUrl) {
        if (toolUrl == null || toolUrl.isEmpty()) {
            throw new IllegalArgumentException("Tool URL cannot be null or empty");
        }

        log.info("Reinitializing JWK service with tool URL: {}", toolUrl);

        // Ensure we have a key
        if (!initialized) {
            initialize();
        }

        if (!initialized) {
            throw new IllegalStateException("JWK Service could not be initialized");
        }

        // Test creating a JWT with the new tool URL
        try {
            String jwt = createSignedJwt("test", toolUrl, "https://test.com");
            log.info("Successfully created test JWT with new tool URL, length: {}", jwt.length());
        } catch (Exception e) {
            log.error("Failed to create test JWT with new tool URL", e);
            throw new RuntimeException("Failed to verify new tool URL", e);
        }

        log.info("JWK service reinitialized successfully with tool URL: {}", toolUrl);
    }

    /**
     * Signs a Deep Linking JWT using the configured private key.
     * This creates a signed JWT containing the deep linking response data.
     *
     * @param claims The JWT claims to include (Deep Linking response)
     * @return A signed JWT string
     * @throws JOSEException If signing fails
     */
    public String signDeepLinkingJwt(Map<String, Object> claims) throws JOSEException {
        try {
            // Convert claims map to JWTClaimsSet
            JWTClaimsSet.Builder claimsBuilder = new JWTClaimsSet.Builder();

            for (Map.Entry<String, Object> entry : claims.entrySet()) {
                claimsBuilder.claim(entry.getKey(), entry.getValue());
            }

            JWTClaimsSet claimsSet = claimsBuilder.build();

            // Create JWS header with key ID
            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                    .keyID(getKeyId())
                    .type(new JOSEObjectType("JWT"))
                    .build();

            // Create and sign the JWT
            SignedJWT signedJWT = new SignedJWT(header, claimsSet);
            signedJWT.sign(getSigner());

            // Return the serialized JWT
            return signedJWT.serialize();

        } catch (Exception e) {
            log.error("Failed to sign Deep Linking JWT", e);
            throw e;
        }
    }

    /**
     * Forces initialization with the current tool URL from the LtiConfig.
     * Call this method in the application startup to ensure proper JWT issuer URL.
     */
    public void forceInitializeWithCorrectToolUrl() {
        // Check if we're already initialized
        if (initialized) {
            // Get the current tool URL
            String currentToolUrl = ltiConfig.getSanitizedToolUrl();

            // If the tool URL is localhost or not properly configured, wait a bit
            if (currentToolUrl.contains("localhost") || currentToolUrl.equals("http://localhost:8080")) {
                log.warn("Tool URL still shows as localhost - waiting for proper initialization");
                try {
                    // Wait up to 3 seconds for proper configuration
                    for (int i = 0; i < 3; i++) {
                        Thread.sleep(1000);
                        currentToolUrl = ltiConfig.getSanitizedToolUrl();
                        if (!currentToolUrl.contains("localhost") && !currentToolUrl.equals("http://localhost:8080")) {
                            log.info("Tool URL properly initialized to: {}", currentToolUrl);
                            break;
                        }
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    log.warn("Interrupted while waiting for tool URL initialization");
                }
            }

            // Re-initialize with the correct URL
            log.info("Re-initializing JWK service with current tool URL: {}", currentToolUrl);
            try {
                reinitializeWithToolUrl(currentToolUrl);
            } catch (Exception e) {
                log.error("Failed to re-initialize JWK service with correct tool URL", e);
            }
        } else {
            // Not initialized yet, so do a full initialization
            log.info("JWK service not initialized yet - performing full initialization");
            initialize();
        }
    }
}