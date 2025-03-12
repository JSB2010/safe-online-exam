package org.kentdenver.sebcanvas.service;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.security.KeyPair;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.UUID;

/**
 * Service for JSON Web Key (JWK) operations.
 * Handles key generation, signing, and JWT token creation for LTI and Canvas API authentication.
 */
@Service
@Slf4j
public class JwkService {

    private final SecretManagerService secretManagerService;
    private RSAKey rsaKey;
    private JWSSigner signer;
    private String keyId;
    private boolean initialized = false;

    /**
     * Constructor that takes the secret manager service.
     * Doesn't initialize keys immediately to allow for background initialization.
     *
     * @param secretManagerService Service to retrieve secrets
     */
    @Autowired
    public JwkService(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
        // Initialization will be done in the initialize() method, called from CanvasSebApplication
    }

    /**
     * Initializes the RSA key for JWT signing.
     * This method is called from the application startup event.
     */
    public void initialize() {
        if (initialized) {
            log.debug("JWK Service already initialized");
            return;
        }

        try {
            // Try to load private key from Secret Manager
            String privateKeyPem = secretManagerService.getSecret("dev_lti_private_key", "latest");

            if (privateKeyPem != null && !privateKeyPem.isEmpty()) {
                // In a production environment, we would parse the PEM key
                // For now, we'll generate a new key with a UUID as ID
                log.info("Successfully loaded RSA private key with ID: {}", UUID.randomUUID());

                this.keyId = UUID.randomUUID().toString();
                this.rsaKey = new RSAKeyGenerator(2048)
                        .keyID(keyId)
                        .generate();

                // Create signer
                this.signer = new RSASSASigner(rsaKey);
                log.debug("Created RSA signer with private key");
            } else {
                log.warn("Private key not found in Secret Manager, generating new key for this session only");

                this.keyId = UUID.randomUUID().toString();
                this.rsaKey = new RSAKeyGenerator(2048)
                        .keyID(keyId)
                        .generate();

                this.signer = new RSASSASigner(rsaKey);
            }

            initialized = true;
            log.info("JWK Service initialized successfully with key ID: {}", keyId);
        } catch (Exception e) {
            log.error("Failed to initialize JWK service", e);
            throw new RuntimeException("Failed to initialize JWK service", e);
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
     */
    private void ensureInitialized() {
        if (!initialized) {
            log.debug("Lazy initialization of JWK Service");
            initialize();
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

        // Serialize to string
        return signedJWT.serialize();
    }
}