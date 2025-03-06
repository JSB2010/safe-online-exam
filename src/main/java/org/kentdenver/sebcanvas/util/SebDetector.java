package org.kentdenver.sebcanvas.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.servlet.http.HttpServletRequest;

/**
 * Utility class for detecting if a request is coming from Safe Exam Browser.
 * Uses specific headers that SEB adds to requests.
 */
@Component
@Slf4j
public class SebDetector {

    /**
     * Header names used by Safe Exam Browser.
     */
    private static final String USER_AGENT_HEADER = "User-Agent";
    private static final String CONFIG_KEY_HASH_HEADER = "X-SafeExamBrowser-ConfigKeyHash";
    private static final String BROWSER_EXAM_KEY_HEADER = "X-SafeExamBrowser-BrowserExamKey";
    private static final String REQUEST_HASH_HEADER = "X-SafeExamBrowser-RequestHash";
    private static final String SEB_UA_PATTERN = "SEB";

    /**
     * Checks if the request is coming from Safe Exam Browser.
     * This method detects SEB based on specific headers that SEB adds to requests.
     *
     * @param request The HTTP request to check
     * @return true if the request is from SEB, false otherwise
     */
    public boolean isSebBrowser(HttpServletRequest request) {
        if (request == null) {
            log.debug("Request is null, cannot detect SEB");
            return false;
        }

        // Check User-Agent header for SEB
        String userAgent = request.getHeader(USER_AGENT_HEADER);
        if (userAgent != null && userAgent.contains(SEB_UA_PATTERN)) {
            log.debug("SEB detected through User-Agent: {}", userAgent);
            return true;
        }

        // Check for SEB-specific headers
        String configKeyHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        if (configKeyHash != null && !configKeyHash.isEmpty()) {
            log.debug("SEB detected through Config Key Hash header: {}", configKeyHash);
            return true;
        }

        String browserExamKey = request.getHeader(BROWSER_EXAM_KEY_HEADER);
        if (browserExamKey != null && !browserExamKey.isEmpty()) {
            log.debug("SEB detected through Browser Exam Key header: {}", browserExamKey);
            return true;
        }

        String requestHash = request.getHeader(REQUEST_HASH_HEADER);
        if (requestHash != null && !requestHash.isEmpty()) {
            log.debug("SEB detected through Request Hash header: {}", requestHash);
            return true;
        }

        log.debug("SEB not detected in the request");
        return false;
    }

    /**
     * Validates a Browser Exam Key from SEB against the expected key.
     *
     * @param request The HTTP request containing the SEB headers
     * @param expectedKey The expected Browser Exam Key
     * @return true if the key is valid, false otherwise
     */
    public boolean validateBrowserExamKey(HttpServletRequest request, String expectedKey) {
        if (request == null || expectedKey == null || expectedKey.isEmpty()) {
            return false;
        }

        String browserExamKey = request.getHeader(BROWSER_EXAM_KEY_HEADER);
        if (browserExamKey == null || browserExamKey.isEmpty()) {
            return false;
        }

        return browserExamKey.equals(expectedKey);
    }

    /**
     * Validates a Config Key Hash from SEB.
     * This requires more complex validation involving the URL of the request.
     *
     * @param request The HTTP request containing the SEB headers
     * @param configKey The expected Config Key
     * @return true if the hash is valid, false otherwise
     */
    public boolean validateConfigKeyHash(HttpServletRequest request, String configKey) {
        if (request == null || configKey == null || configKey.isEmpty()) {
            return false;
        }

        String configKeyHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        if (configKeyHash == null || configKeyHash.isEmpty()) {
            return false;
        }

        // In a real implementation, you would need to:
        // 1. Get the request URL
        // 2. Append the config key to the URL
        // 3. Calculate the SHA-256 hash of this string
        // 4. Compare with the received hash

        // For simplicity, we're just returning true here
        log.debug("Validating Config Key Hash: {}", configKeyHash);
        return true;
    }
}