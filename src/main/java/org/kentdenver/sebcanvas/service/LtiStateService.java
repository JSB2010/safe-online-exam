package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class LtiStateService {

    private static final String ALGORITHM = "AES";
    private static final String DEV_STATE_ENCRYPTION_FALLBACK = "seb-canvas-dev-state-key";
    private static final long STATE_TTL_SECONDS = 600;

    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final Map<String, Instant> issuedStates = new ConcurrentHashMap<>();

    @Value("${app.security.state-encryption-key:${STATE_ENCRYPTION_KEY:}}")
    private String stateEncryptionKey;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @Autowired
    public LtiStateService(ObjectMapper objectMapper) {
        this(objectMapper, Clock.systemUTC());
    }

    LtiStateService(ObjectMapper objectMapper, Clock clock) {
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    public String createState(Map<String, String> stateData) {
        try {
            String stateJson = objectMapper.writeValueAsString(stateData);
            SecretKeySpec secretKey = buildStateSecretKey();
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            String state = Base64.getUrlEncoder()
                    .encodeToString(cipher.doFinal(stateJson.getBytes(StandardCharsets.UTF_8)));
            issuedStates.put(state, Instant.now(clock).plus(STATE_TTL_SECONDS, ChronoUnit.SECONDS));
            cleanupExpiredStates();
            return state;
        } catch (Exception e) {
            throw new IllegalStateException("Error creating LTI state", e);
        }
    }

    public Map<String, String> consumeState(String encryptedState) {
        if (encryptedState == null || encryptedState.isBlank()) {
            throw new IllegalArgumentException("Missing LTI state");
        }

        Instant expiresAt = issuedStates.remove(encryptedState);
        if (expiresAt == null || expiresAt.isBefore(Instant.now(clock))) {
            throw new IllegalArgumentException("Invalid or replayed LTI state");
        }

        try {
            byte[] encryptedBytes = Base64.getUrlDecoder().decode(encryptedState);
            SecretKeySpec secretKey = buildStateSecretKey();
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secretKey);
            byte[] decryptedBytes = cipher.doFinal(encryptedBytes);
            String decryptedJson = new String(decryptedBytes, StandardCharsets.UTF_8);
            return objectMapper.readValue(decryptedJson, new TypeReference<>() {
            });
        } catch (Exception e) {
            log.warn("Failed to decode consumed LTI state: {}", e.getMessage());
            throw new IllegalArgumentException("Invalid LTI state", e);
        }
    }

    private void cleanupExpiredStates() {
        Instant now = Instant.now(clock);
        Iterator<Map.Entry<String, Instant>> iterator = issuedStates.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, Instant> entry = iterator.next();
            if (entry.getValue().isBefore(now)) {
                iterator.remove();
            }
        }
    }

    private SecretKeySpec buildStateSecretKey() throws Exception {
        String rawKey = stateEncryptionKey;
        if (rawKey == null || rawKey.isBlank()) {
            if ("prod".equalsIgnoreCase(activeProfile)) {
                throw new IllegalStateException("State encryption key is required in production");
            }
            rawKey = DEV_STATE_ENCRYPTION_FALLBACK;
        }

        byte[] keyBytes = MessageDigest.getInstance("SHA-256").digest(rawKey.getBytes(StandardCharsets.UTF_8));
        return new SecretKeySpec(keyBytes, ALGORITHM);
    }
}
