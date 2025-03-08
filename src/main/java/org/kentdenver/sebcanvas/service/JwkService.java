package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.security.interfaces.RSAPrivateKey;
import java.util.UUID;

/**
 * Service for handling JSON Web Keys (JWK) operations for LTI authentication.
 * This service loads the private key from Secret Manager and provides functionality
 * for signing JWT tokens used in the LTI client credentials flow.
 *
 * The @Slf4j annotation adds a 'log' field to the class for logging.
 * This addresses the compilation error related to missing 'log' variables.
 */
@Service
@Slf4j
public class JwkService {

    private final SecretManagerService secretManagerService;
    private final ObjectMapper objectMapper;
    private RSAPrivateKey privateKey;
    private JWSSigner signer;
    private String keyId;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    /**
     * Constructor for JwkService.
     * Initializes the key ID with a random UUID as a fallback.
     *
     * @param secretManagerService Service to access secrets from GCP Secret Manager
     * @param objectMapper Jackson ObjectMapper for parsing JSON
     */
    @Autowired
    public JwkService(SecretManagerService secretManagerService, ObjectMapper objectMapper) {
        this.secretManagerService = secretManagerService;
        this.objectMapper = objectMapper;
        this.keyId = UUID.randomUUID().toString();
    }

    /**
     * Initializes the JWK service by loading the private key from Secret Manager.
     * This should be called once during application startup.
     */
    public void initialize() {
        try {
            loadPrivateKeyFromJwk();
            createSigner();
            log.info("JWK Service initialized successfully with key ID: {}", keyId);
        } catch (Exception e) {
            log.error("Failed to initialize JWK Service", e);
            throw new RuntimeException("Failed to initialize JWK Service", e);
        }
    }

    /**
     * Gets the JWT signer based on the private key.
     * This is used for signing JWT claims.
     *
     * @return The JWSSigner for creating signed JWTs
     */
    public JWSSigner getSigner() {
        if (signer == null) {
            throw new IllegalStateException("JWK Service has not been initialized properly");
        }
        return signer;
    }

    /**
     * Gets the key ID for this JWK.
     *
     * @return The key ID (kid) from the JWK
     */
    public String getKeyId() {
        return keyId;
    }

    /**
     * Loads the private key from Secret Manager.
     * The secret contains a complete RSA JWK with private key components.
     *
     * @throws IOException If there's an error loading or parsing the key
     * @throws JOSEException If there's an error processing the JWK
     */
    private void loadPrivateKeyFromJwk() throws IOException, JOSEException {
        // Determine which secret to use based on the active profile
        String privateKeySecret = activeProfile.equals("prod") ? "prod_lti_private_key" : "dev_lti_private_key";

        // Load the JWK JSON from Secret Manager
        String jwkJson = secretManagerService.getSecret(privateKeySecret, "latest");
        if (jwkJson == null || jwkJson.isEmpty()) {
            throw new IOException("Failed to load private key from Secret Manager");
        }

        try {
            // Parse the JWK from JSON
            JWK jwk = JWK.parse(jwkJson);
            if (!(jwk instanceof RSAKey)) {
                throw new JOSEException("The loaded key is not an RSA key");
            }

            // Convert to RSA key and extract private key
            RSAKey rsaKey = (RSAKey) jwk;
            this.privateKey = rsaKey.toRSAPrivateKey();
            this.keyId = rsaKey.getKeyID();

            log.info("Successfully loaded RSA private key with ID: {}", keyId);
        } catch (Exception e) {
            throw new JOSEException("Error parsing JWK from Secret Manager", e);
        }
    }

    /**
     * Creates a JWT signer based on the private key.
     *
     * @throws JOSEException If there's an error creating the signer
     */
    private void createSigner() throws JOSEException {
        if (privateKey == null) {
            throw new JOSEException("Private key has not been loaded");
        }

        this.signer = new RSASSASigner(privateKey);
        log.debug("Created RSA signer with private key");
    }
}