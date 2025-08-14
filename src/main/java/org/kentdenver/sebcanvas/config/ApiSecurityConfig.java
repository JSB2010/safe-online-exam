package org.kentdenver.sebcanvas.config;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Configuration for API security including API keys and rate limiting.
 * This provides security for sensitive endpoints like the SEB access code API.
 */
@Configuration
@Component
@Slf4j
@Getter
public class ApiSecurityConfig {

    /**
     * API key for securing SEB-related endpoints.
     * This key is embedded in the JavaScript and required for access code requests.
     */
    @Value("${seb.api.key:}")
    private String configuredApiKey;
    
    private String apiKey;
    
    /**
     * Rate limiting configuration
     */
    @Value("${seb.api.rate-limit.requests-per-minute:10}")
    private int requestsPerMinute;
    
    @Value("${seb.api.rate-limit.enabled:true}")
    private boolean rateLimitEnabled;
    
    /**
     * Rate limiting storage - in production this should use Redis or similar
     */
    private final ConcurrentHashMap<String, RateLimitInfo> rateLimitMap = new ConcurrentHashMap<>();
    
    /**
     * Initialize the API key on startup
     */
    @PostConstruct
    public void initializeApiKey() {
        if (configuredApiKey != null && !configuredApiKey.trim().isEmpty()) {
            this.apiKey = configuredApiKey.trim();
            log.info("Using configured API key for SEB endpoints");
        } else {
            this.apiKey = generateSecureApiKey();
            log.warn("No API key configured, generated random key: {}...", 
                    apiKey.substring(0, Math.min(8, apiKey.length())));
            log.warn("For production, set SEB_API_KEY environment variable");
        }
    }
    
    /**
     * Generates a cryptographically secure API key
     */
    private String generateSecureApiKey() {
        SecureRandom random = new SecureRandom();
        byte[] keyBytes = new byte[32]; // 256 bits
        random.nextBytes(keyBytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(keyBytes);
    }
    
    /**
     * Validates an API key
     */
    public boolean isValidApiKey(String providedKey) {
        if (providedKey == null || apiKey == null) {
            return false;
        }
        return apiKey.equals(providedKey);
    }
    
    /**
     * Checks if a request from the given IP is within rate limits
     */
    public boolean isWithinRateLimit(String clientIp) {
        if (!rateLimitEnabled) {
            return true;
        }
        
        long currentTime = System.currentTimeMillis();
        long windowStart = currentTime - 60000; // 1 minute window
        
        RateLimitInfo info = rateLimitMap.computeIfAbsent(clientIp, k -> new RateLimitInfo());
        
        synchronized (info) {
            // Clean old requests outside the window
            info.requestTimes.removeIf(time -> time < windowStart);
            
            // Check if within limit
            if (info.requestTimes.size() >= requestsPerMinute) {
                info.blockedRequests.incrementAndGet();
                return false;
            }
            
            // Add current request
            info.requestTimes.add(currentTime);
            info.totalRequests.incrementAndGet();
            return true;
        }
    }
    
    /**
     * Gets rate limit statistics for monitoring
     */
    public RateLimitStats getRateLimitStats() {
        int totalClients = rateLimitMap.size();
        int totalRequests = rateLimitMap.values().stream()
                .mapToInt(info -> info.totalRequests.get())
                .sum();
        int totalBlocked = rateLimitMap.values().stream()
                .mapToInt(info -> info.blockedRequests.get())
                .sum();
        
        return new RateLimitStats(totalClients, totalRequests, totalBlocked);
    }
    
    /**
     * Cleans up old rate limit entries to prevent memory leaks
     */
    public void cleanupRateLimitData() {
        long cutoff = System.currentTimeMillis() - 300000; // 5 minutes ago
        rateLimitMap.entrySet().removeIf(entry -> {
            RateLimitInfo info = entry.getValue();
            synchronized (info) {
                info.requestTimes.removeIf(time -> time < cutoff);
                return info.requestTimes.isEmpty();
            }
        });
    }
    
    /**
     * Rate limit information for a client IP
     */
    private static class RateLimitInfo {
        private final java.util.List<Long> requestTimes = new java.util.ArrayList<>();
        private final AtomicInteger totalRequests = new AtomicInteger(0);
        private final AtomicInteger blockedRequests = new AtomicInteger(0);
    }
    
    /**
     * Rate limit statistics
     */
    public static class RateLimitStats {
        @Getter
        private final int totalClients;
        @Getter
        private final int totalRequests;
        @Getter
        private final int totalBlocked;
        
        public RateLimitStats(int totalClients, int totalRequests, int totalBlocked) {
            this.totalClients = totalClients;
            this.totalRequests = totalRequests;
            this.totalBlocked = totalBlocked;
        }
    }
}
