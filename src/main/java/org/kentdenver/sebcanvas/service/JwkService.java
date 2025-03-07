package org.kentdenver.sebcanvas.service;

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
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.UUID;

@Service
@Slf4j
public class JwkService {

    private final SecretManagerService secretManagerService;
    private RSAPrivateKey privateKey;
    private JWSSigner signer;
    private String keyId;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @Autowired
    public JwkService(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
        this.keyId = UUID.randomUUID().toString();
    }

    /**
     * Initializes the JWK service by loading the private key from Secret Manager.
     * This should be called once during application startup.
     */
    public void initialize() {
        try {
            loadPrivateKey();
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
     */
    public JWSSigner getSigner() {
        if (signer == null) {
            initialize();
        }
        return signer;
    }

    /**
     * Gets the key ID for this JWK.
     */
    public String getKeyId() {
        return keyId;
    }

    /**
     * Loads the private key from Secret Manager.
     */
    private void loadPrivateKey() throws IOException, NoSuchAlgorithmException, InvalidKeySpecException {
        // Determine which secret to use based on the active profile
        String privateKeySecret = activeProfile.equals("prod") ? "prod_lti_private_key" : "dev_lti_private_key";

        String pemKey = secretManagerService.getSecret(privateKeySecret, "latest");
        if (pemKey == null || pemKey.isEmpty()) {
            throw new IOException("Failed to load private key from Secret Manager");
        }

        // Remove PEM headers and newlines
        pemKey = pemKey.replaceAll("-----BEGIN PRIVATE KEY-----", "")
                .replaceAll("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");

        // Convert from Base64 to binary
        byte[] encodedKey = Base64.getDecoder().decode(pemKey);

        // Create the private key from the binary data
        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
        PKCS8EncodedKeySpec keySpec = new PKCS8EncodedKeySpec(encodedKey);
        this.privateKey = (RSAPrivateKey) keyFactory.generatePrivate(keySpec);
    }

    /**
     * Creates a JWT signer based on the private key.
     */
    private void createSigner() throws JOSEException {
        if (privateKey == null) {
            throw new JOSEException("Private key has not been loaded");
        }

        this.signer = new RSASSASigner(privateKey);
    }
}
