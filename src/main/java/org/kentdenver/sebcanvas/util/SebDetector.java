package org.kentdenver.sebcanvas.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Enumeration;

/**
 * Utility class for detecting and validating Safe Exam Browser (SEB) requests.
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
     */
    public boolean isSebBrowser(HttpServletRequest request) {
        if (request == null) {
            log.debug("Request is null, cannot detect SEB");
            return false;
        }

        // Log all headers for debugging purposes
        logAllHeaders(request);

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
     */
    public boolean validateBrowserExamKey(HttpServletRequest request, String expectedKey) {
        if (request == null || expectedKey == null || expectedKey.isEmpty()) {
            log.debug("Request or expected key is null/empty, cannot validate BEK");
            return false;
        }

        String browserExamKey = request.getHeader(BROWSER_EXAM_KEY_HEADER);
        if (browserExamKey == null || browserExamKey.isEmpty()) {
            log.debug("No Browser Exam Key header found in request");
            return false;
        }

        boolean isValid = browserExamKey.equals(expectedKey);
        log.debug("Browser Exam Key validation result: {}", isValid);
        return isValid;
    }

    /**
     * Validates a Config Key Hash from SEB.
     */
    public boolean validateConfigKeyHash(HttpServletRequest request, String configKey) {
        if (request == null || configKey == null || configKey.isEmpty()) {
            log.debug("Request or config key is null/empty, cannot validate Config Key Hash");
            return false;
        }

        String configKeyHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        if (configKeyHash == null || configKeyHash.isEmpty()) {
            log.debug("No Config Key Hash header found in request");
            return false;
        }

        try {
            // Get the request URL (without fragment)
            String requestUrl = getRequestUrlWithoutFragment(request);

            // Concatenate URL and Config Key
            String urlWithKey = requestUrl + configKey;

            // Calculate SHA-256 hash
            String calculatedHash = calculateSha256Hash(urlWithKey);

            // Compare with the received hash
            boolean isValid = calculatedHash.equalsIgnoreCase(configKeyHash);
            log.debug("Config Key Hash validation result: {}", isValid);

            return isValid;
        } catch (NoSuchAlgorithmException e) {
            log.error("Error validating Config Key Hash", e);
            return false;
        }
    }

    /**
     * Gets the full request URL without the fragment part.
     */
    private String getRequestUrlWithoutFragment(HttpServletRequest request) {
        StringBuilder url = new StringBuilder();

        // Build the URL
        url.append(request.getScheme()).append("://")
                .append(request.getServerName());

        // Add port if non-standard
        if (request.getServerPort() != 80 && request.getServerPort() != 443) {
            url.append(":").append(request.getServerPort());
        }

        url.append(request.getRequestURI());

        // Add query string if present
        if (request.getQueryString() != null) {
            url.append("?").append(request.getQueryString());
        }

        // Note: Fragment is not included as it's not sent to the server

        return url.toString();
    }

    /**
     * Calculates a SHA-256 hash of a string.
     */
    private String calculateSha256Hash(String input) throws NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
        return bytesToHex(hash);
    }

    /**
     * Converts a byte array to a hexadecimal string.
     */
    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }

    /**
     * Logs all headers in the request for debugging purposes.
     */
    private void logAllHeaders(HttpServletRequest request) {
        if (log.isTraceEnabled()) {
            log.trace("--- HTTP Headers ---");
            Enumeration<String> headerNames = request.getHeaderNames();
            while (headerNames.hasMoreElements()) {
                String headerName = headerNames.nextElement();
                log.trace("{}: {}", headerName, request.getHeader(headerName));
            }
            log.trace("-------------------");
        }
    }

    /**
     * Extract Browser Exam Key from request.
     */
    public String extractBrowserExamKey(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        return request.getHeader(BROWSER_EXAM_KEY_HEADER);
    }

    /**
     * Extract Config Key Hash from request.
     */
    public String extractConfigKeyHash(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        return request.getHeader(CONFIG_KEY_HASH_HEADER);
    }
}
