package org.kentdenver.sebcanvas.service;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.text.ParseException;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Service for JSON Web Key (JWK) operations.
 * Handles key retrieval from Secret Manager and JWT signing for Canvas API authentication.
 */
@Service
@Slf4j
public class JwkService {

    private final SecretManagerService secretManagerService;
    private RSAKey rsaKey;
    private JWSSigner signer;
    private String keyId;
    private boolean initialized = false;
    private int secretManagerRetries = 3;

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    /**
     * Constructor that takes the secret manager service.
     *
     * @param secretManagerService Service to retrieve secrets
     */
    @Autowired
    public JwkService(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
    }

    /**
     * Initializes the RSA key for JWT signing.
     * This method loads the private key from Secret Manager in JWK format.
     * If the key cannot be retrieved, it logs clear errors instead of creating a new key.
     */
    public void initialize() {
        if (initialized) {
            log.debug("JWK Service already initialized");
            return;
        }

        log.info("Initializing JWK Service to retrieve key from Secret Manager");

        // Track retry attempts
        final AtomicInteger retryCount = new AtomicInteger(0);
        boolean keyLoaded = false;

        log.info("Initializing JWK Service...");

        // First check if we have the key directly in environment variables
        // This is set by Cloud Run's --set-secrets
        String jwkJson = System.getenv("LTI_PRIVATE_KEY");

        if (jwkJson != null && !jwkJson.isEmpty()) {
            try {
                log.info("Found JWK in environment variable LTI_PRIVATE_KEY");
                parseAndSetKey(jwkJson);
                keyLoaded = true;
                return;
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
                jwkJson = secretManagerService.getSecret("dev_lti_private_key", "latest");

                if (jwkJson != null && !jwkJson.isEmpty()) {
                    log.debug("Loaded private key JWK from Secret Manager, length: {} chars", jwkJson.length());

                    try {
                        // Parse the JWK JSON
                        JWK jwk = JWK.parse(jwkJson);
                        log.debug("Successfully parsed JWK from Secret Manager");

                        if (!(jwk instanceof RSAKey)) {
                            log.error("CONFIGURATION ERROR: Loaded JWK is not an RSA key, type: {}",
                                    jwk.getClass().getName());
                            break;
                        }

                        // Cast to RSAKey and ensure it has a private key component
                        this.rsaKey = (RSAKey) jwk;
                        if (!this.rsaKey.isPrivate()) {
                            log.error("CONFIGURATION ERROR: Loaded RSA key does not contain private key information");
                            break;
                        }

                        // Extract the key ID from the JWK
                        this.keyId = this.rsaKey.getKeyID();
                        log.debug("Extracted key ID from JWK: {}", this.keyId);

                        if (this.keyId == null || this.keyId.isEmpty()) {
                            // If no key ID is in the JWK, use a default one
                            this.keyId = "canvas-seb-integration-key";
                            log.info("No key ID found in JWK, using default: {}", this.keyId);

                            // Create a new key with our key ID
                            this.rsaKey = new RSAKey.Builder((RSAKey)jwk)
                                    .keyID(this.keyId)
                                    .build();
                        }

                        // Create signer with the RSA key
                        this.signer = new RSASSASigner(this.rsaKey);

                        // Also create and log the public JWK
                        JWK publicJwk = new RSAKey.Builder(this.rsaKey.toRSAPublicKey())
                                .keyID(this.keyId)
                                .build();

                        log.info("Public key for Canvas registration: {}", publicJwk.toJSONString());

                        keyLoaded = true;
                        initialized = true;
                        log.info("JWK Service successfully initialized with key ID: {}", keyId);

                    } catch (Exception e) {
                        log.error("Failed to parse JWK from Secret Manager: {}", e.getMessage(), e);
                        retryCount.incrementAndGet();
                    }
                } else {
                    log.error("CONFIGURATION ERROR: Private key not found in Secret Manager or is empty");
                    log.error("Please ensure the secret 'dev_lti_private_key' exists in project '{}'", projectId);
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
            log.error("1. The 'dev_lti_private_key' secret exists in Secret Manager in project '{}'", projectId);
            log.error("2. The service account 'seb-canvas@{}.iam.gserviceaccount.com' has Secret Manager access", projectId);
            log.error("3. Network connectivity to Secret Manager is working");

            // Don't throw exception to allow app to start, but set not initialized state
            initialized = false;
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
     *
     * @param clientId The client ID (from LTI configuration)
     * @param issuer The issuer (typically the tool URL)
     * @param audience The audience (typically the Canvas token URL)
     * @return A signed JWT string
     * @throws JOSEException If signing fails
     */
    public String createSignedJwt(String clientId, String issuer, String audience) throws JOSEException {
        ensureInitialized();

        // Current time
        Date now = new Date();

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
        log.debug("Created signed JWT with issuer: {}, subject: {}, audience: {}, keyId: {}",
                issuer, clientId, audience, keyId);

        return serialized;
    }

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
}
