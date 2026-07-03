package org.kentdenver.sebcanvas.service;

import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SebAccessProofService {

    private static final int TOKEN_BYTES = 32;
    private static final long TOKEN_TTL_SECONDS = 120;

    private final SecureRandom secureRandom = new SecureRandom();
    private final Clock clock;
    private final Map<String, Proof> proofs = new ConcurrentHashMap<>();

    public SebAccessProofService() {
        this(Clock.systemUTC());
    }

    SebAccessProofService(Clock clock) {
        this.clock = clock;
    }

    public String mintProof(String courseId, String contentId) {
        cleanupExpiredProofs();

        byte[] tokenBytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(tokenBytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);

        proofs.put(token, new Proof(
                courseId,
                contentId,
                Instant.now(clock).plus(TOKEN_TTL_SECONDS, ChronoUnit.SECONDS)));
        return token;
    }

    public boolean consumeProof(String token, String courseId, String contentId) {
        if (token == null || token.isBlank()) {
            return false;
        }

        Proof proof = proofs.remove(token);
        if (proof == null || proof.expiresAt().isBefore(Instant.now(clock))) {
            return false;
        }

        return proof.courseId().equals(courseId)
                && proof.contentId().equals(contentId);
    }

    public long getTokenTtlSeconds() {
        return TOKEN_TTL_SECONDS;
    }

    private void cleanupExpiredProofs() {
        Instant now = Instant.now(clock);
        Iterator<Map.Entry<String, Proof>> iterator = proofs.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, Proof> entry = iterator.next();
            if (entry.getValue().expiresAt().isBefore(now)) {
                iterator.remove();
            }
        }
    }

    private record Proof(String courseId, String contentId, Instant expiresAt) {
    }
}
