package org.kentdenver.sebcanvas.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Enumeration;

/**
 * Utility class for detecting and validating Safe Exam Browser (SEB) requests.
 *
 * This component provides functionality to:
 * 1. Detect if a request comes from Safe Exam Browser by examining headers
 * 2. Validate Browser Exam Keys sent from SEB
 * 3. Validate Config Key Hash values for more secure SEB validation
 *
 * The implementation follows the SEB detection and validation protocols as
 * documented in SEB integration guide:
 * https://safeexambrowser.org/developer/seb-integration.html
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
     *
     * From the SEB documentation, the BEK is added as a header to HTTP requests
     * when "Use Browser & Config Keys" is enabled in SEB settings.
     *
     * @param request The HTTP request containing the SEB headers
     * @param expectedKey The expected Browser Exam Key
     * @return true if the key is valid, false otherwise
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
     *
     * According to the SEB specification, the Config Key Hash is created by:
     * 1. Taking the Config Key from SEB settings
     * 2. Concatenating it with the requested URL
     * 3. Generating a SHA-256 hash of this string
     *
     * This provides a stronger validation mechanism than the Browser Exam Key.
     *
     * @param request The HTTP request containing the SEB headers
     * @param configKey The expected Config Key
     * @return true if the hash is valid, false otherwise
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
     * According to the SEB specification, the fragment part (everything after #)
     * must be removed from the URL before hash calculation.
     *
     * @param request The HTTP request
     * @return The full URL without fragment
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
     * This is used for Config Key Hash validation according to the SEB specification.
     *
     * @param input The input string
     * @return The SHA-256 hash as a hexadecimal string
     * @throws NoSuchAlgorithmException If SHA-256 is not available
     */
    private String calculateSha256Hash(String input) throws NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
        return bytesToHex(hash);
    }

    /**
     * Converts a byte array to a hexadecimal string.
     * Used for formatting hash values for comparison with SEB headers.
     *
     * @param bytes The byte array
     * @return The hexadecimal string
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
     * This is helpful for debugging SEB integration issues.
     *
     * @param request The HTTP request
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
     * For completeness, let's also include a method to check if a specific Browser Exam Key is present
     * without comparing to an expected value. This can be useful in some scenarios.
     *
     * @param request The HTTP request containing the SEB headers
     * @return The Browser Exam Key if present, null otherwise
     */
    public String extractBrowserExamKey(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        return request.getHeader(BROWSER_EXAM_KEY_HEADER);
    }

    /**
     * For completeness, let's also include a method to check if a specific Config Key Hash is present
     * without comparing to an expected value.
     *
     * @param request The HTTP request containing the SEB headers
     * @return The Config Key Hash if present, null otherwise
     */
    public String extractConfigKeyHash(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        return request.getHeader(CONFIG_KEY_HASH_HEADER);
    }
}