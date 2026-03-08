package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.ApiSecurityConfig;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Service for validating API security including API keys, rate limiting, and SEB detection.
 * This service provides security for sensitive endpoints.
 */
@Service
@Slf4j
public class ApiSecurityService {

    private final ApiSecurityConfig apiSecurityConfig;
    private final SebDetector sebDetector;

    @Autowired
    public ApiSecurityService(ApiSecurityConfig apiSecurityConfig, SebDetector sebDetector) {
        this.apiSecurityConfig = apiSecurityConfig;
        this.sebDetector = sebDetector;
    }

    /**
     * Validates a request for accessing sensitive SEB endpoints.
     * This includes API key validation, rate limiting, and SEB detection.
     */
    public SecurityValidationResult validateSebApiRequest(HttpServletRequest request) {
        String clientIp = getClientIpAddress(request);
        
        log.info("=== SEB API Security Validation ===");
        log.info("Client IP: {}", clientIp);
        log.info("User Agent: {}", request.getHeader("User-Agent"));
        log.info("Request URI: {}", request.getRequestURI());
        
        // 1. Check rate limiting first (fastest check)
        if (!apiSecurityConfig.isWithinRateLimit(clientIp)) {
            log.warn("Rate limit exceeded for IP: {}", clientIp);
            return SecurityValidationResult.rateLimitExceeded();
        }
        
        // 2. Validate API key
        String apiKey = extractApiKey(request);
        if (!apiSecurityConfig.isValidApiKey(apiKey)) {
            log.warn("Invalid or missing API key from IP: {}", clientIp);
            return SecurityValidationResult.invalidApiKey();
        }
        
        // 3. Validate SEB user agent (additional security layer)
        if (!sebDetector.isRequestFromSEB(request, (QuizSebSetting) null)) {
            log.warn("Request not from SEB browser, IP: {}", clientIp);
            return SecurityValidationResult.notFromSeb();
        }
        
        log.info("Security validation passed for IP: {}", clientIp);
        return SecurityValidationResult.success();
    }
    
    /**
     * Validates a request for admin/debug endpoints.
     * This requires stronger authentication.
     */
    public SecurityValidationResult validateAdminRequest(HttpServletRequest request) {
        String clientIp = getClientIpAddress(request);
        
        log.info("=== Admin API Security Validation ===");
        log.info("Client IP: {}", clientIp);
        
        // For admin endpoints, we need stronger validation
        // In production, this should check for admin authentication
        
        // 1. Check rate limiting
        if (!apiSecurityConfig.isWithinRateLimit(clientIp)) {
            log.warn("Rate limit exceeded for admin request from IP: {}", clientIp);
            return SecurityValidationResult.rateLimitExceeded();
        }
        
        // 2. Validate API key
        String apiKey = extractApiKey(request);
        if (!apiSecurityConfig.isValidApiKey(apiKey)) {
            log.warn("Invalid or missing API key for admin request from IP: {}", clientIp);
            return SecurityValidationResult.invalidApiKey();
        }
        
        // TODO: Add additional admin authentication here
        // For now, we'll allow if API key is valid
        
        log.info("Admin security validation passed for IP: {}", clientIp);
        return SecurityValidationResult.success();
    }
    
    /**
     * Extracts the API key from the request headers
     */
    private String extractApiKey(HttpServletRequest request) {
        // Try multiple header names for flexibility
        String apiKey = request.getHeader("X-SEB-API-Key");
        if (apiKey == null) {
            apiKey = request.getHeader("X-API-Key");
        }
        if (apiKey == null) {
            apiKey = request.getHeader("Authorization");
            if (apiKey != null && apiKey.startsWith("Bearer ")) {
                apiKey = apiKey.substring(7);
            }
        }
        return apiKey;
    }
    
    /**
     * Gets the real client IP address, handling proxies and load balancers
     */
    private String getClientIpAddress(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            // Take the first IP in the chain
            return xForwardedFor.split(",")[0].trim();
        }
        
        String xRealIp = request.getHeader("X-Real-IP");
        if (xRealIp != null && !xRealIp.isEmpty()) {
            return xRealIp;
        }
        
        return request.getRemoteAddr();
    }
    
    /**
     * Gets the current API key for embedding in JavaScript
     */
    public String getApiKeyForJavaScript() {
        return apiSecurityConfig.getApiKey();
    }
    
    /**
     * Gets rate limiting statistics for monitoring
     */
    public ApiSecurityConfig.RateLimitStats getRateLimitStats() {
        return apiSecurityConfig.getRateLimitStats();
    }
    
    /**
     * Result of security validation
     */
    public static class SecurityValidationResult {
        private final boolean valid;
        private final String reason;
        private final int httpStatus;
        
        private SecurityValidationResult(boolean valid, String reason, int httpStatus) {
            this.valid = valid;
            this.reason = reason;
            this.httpStatus = httpStatus;
        }
        
        public static SecurityValidationResult success() {
            return new SecurityValidationResult(true, "Valid", 200);
        }
        
        public static SecurityValidationResult invalidApiKey() {
            return new SecurityValidationResult(false, "Invalid or missing API key", 401);
        }
        
        public static SecurityValidationResult rateLimitExceeded() {
            return new SecurityValidationResult(false, "Rate limit exceeded", 429);
        }
        
        public static SecurityValidationResult notFromSeb() {
            return new SecurityValidationResult(false, "Request must be from Safe Exam Browser", 403);
        }
        
        public boolean isValid() {
            return valid;
        }
        
        public String getReason() {
            return reason;
        }
        
        public int getHttpStatus() {
            return httpStatus;
        }
    }
}
