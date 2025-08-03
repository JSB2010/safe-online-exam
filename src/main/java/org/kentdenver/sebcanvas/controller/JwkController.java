package org.kentdenver.sebcanvas.controller;

import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.RSAKey;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.service.JwkService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Controller for serving JSON Web Key (JWK) sets.
 * This is required for LTI 1.3 integration with Canvas.
 */
@RestController
@Slf4j
public class JwkController {

    private final JwkService jwkService;

    @Autowired
    public JwkController(JwkService jwkService) {
        this.jwkService = jwkService;
    }

    /**
     * Serves the public JWK set for LTI 1.3 authentication.
     * Canvas uses this endpoint to verify JWT tokens signed by this tool.
     */
    @GetMapping(value = "/.well-known/jwks.json", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> getJwkSet() {
        try {
            log.debug("Serving JWK set");
            
            // Get the RSA key from the JWK service
            RSAKey rsaKey = jwkService.getRsaKey();
            
            if (rsaKey == null) {
                log.error("RSA key is not available");
                return ResponseEntity.status(500).body(Map.of("error", "JWK not available"));
            }
            
            // Create public key JWK (without private key material)
            JWK publicJwk = new RSAKey.Builder(rsaKey.toRSAPublicKey())
                    .keyID(jwkService.getKeyId())
                    .keyUse(rsaKey.getKeyUse())
                    .algorithm(rsaKey.getAlgorithm())
                    .build();
            
            // Create JWK Set response
            Map<String, Object> jwkSet = new HashMap<>();
            jwkSet.put("keys", List.of(publicJwk.toJSONObject()));
            
            log.debug("Successfully served JWK set with key ID: {}", jwkService.getKeyId());
            return ResponseEntity.ok(jwkSet);
            
        } catch (Exception e) {
            log.error("Error serving JWK set", e);
            return ResponseEntity.status(500).body(Map.of("error", "Failed to generate JWK set"));
        }
    }
}
