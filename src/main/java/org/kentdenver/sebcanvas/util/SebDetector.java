package org.kentdenver.sebcanvas.util;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.SebConfigKeyService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Enumeration;

/**
 * Utility class for detecting and validating Safe Exam Browser (SEB) requests.
 * Enhanced with additional methods to support SEB redirection workflow.
 */
@Component
@Slf4j
public class SebDetector {

    private final SebConfigKeyService sebConfigKeyService;

    public SebDetector() {
        this(new SebConfigKeyService());
    }

    @Autowired
    public SebDetector(SebConfigKeyService sebConfigKeyService) {
        this.sebConfigKeyService = sebConfigKeyService;
    }

    /**
     * Header names used by Safe Exam Browser.
     */
    private static final String USER_AGENT_HEADER = "User-Agent";
    private static final String CONFIG_KEY_HASH_HEADER = "X-SafeExamBrowser-ConfigKeyHash";
    private static final String BROWSER_EXAM_KEY_HEADER = "X-SafeExamBrowser-BrowserExamKey";
    private static final String REQUEST_HASH_HEADER = "X-SafeExamBrowser-RequestHash";
    private static final String SEB_UA_PATTERN = "SEB";

    // Enhanced SEB User-Agent patterns to detect
    private static final String[] SEB_USER_AGENT_PATTERNS = {
        "SEB/2",                    // SEB 2.x
        "SEB/3",                    // SEB 3.x
        "SEB/4",                    // SEB 4.x (future)
        "SEB ",                     // Generic SEB
        "SafeExamBrowser",          // Full name
        "Safe Exam Browser",        // Alternative name
        "SEB-macOS",               // macOS version
        "SEB-Win",                 // Windows version
        "SEB-iOS",                 // iOS version
        "SEB-Android"              // Android version
    };

    // Additional SEB-specific headers
    private static final String[] SEB_HEADERS = {
        "X-SafeExamBrowser-RequestHash",
        "X-SafeExamBrowser-ConfigKeyHash",
        "X-SafeExamBrowser-Version",
        "X-SEB-Version",
        "X-SEB-OS"
    };

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

        // Check User-Agent header for SEB with enhanced patterns
        String userAgent = request.getHeader(USER_AGENT_HEADER);
        if (userAgent != null) {
            // Check against all SEB patterns
            for (String pattern : SEB_USER_AGENT_PATTERNS) {
                if (userAgent.contains(pattern)) {
                    log.debug("SEB detected through User-Agent pattern '{}'", pattern);
                    return true;
                }
            }
            // Fallback to original pattern
            if (userAgent.contains(SEB_UA_PATTERN)) {
                log.debug("SEB detected through fallback User-Agent pattern");
                return true;
            }
        }

        // Check for SEB-specific headers (enhanced)
        for (String headerName : SEB_HEADERS) {
            String headerValue = request.getHeader(headerName);
            if (headerValue != null && !headerValue.isEmpty()) {
                log.debug("SEB detected through header '{}'", headerName);
                return true;
            }
        }

        // Legacy header checks for backward compatibility
        String configKeyHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        if (configKeyHash != null && !configKeyHash.isEmpty()) {
            log.debug("SEB detected through Config Key Hash header");
            return true;
        }

        String browserExamKey = request.getHeader(BROWSER_EXAM_KEY_HEADER);
        if (browserExamKey != null && !browserExamKey.isEmpty()) {
            log.debug("SEB detected through Browser Exam Key header");
            return true;
        }

        String requestHash = request.getHeader(REQUEST_HASH_HEADER);
        if (requestHash != null && !requestHash.isEmpty()) {
            log.debug("SEB detected through Request Hash header");
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
     * Validates a Browser Exam Key directly.
     * This is useful for API validation endpoints.
     *
     * @param providedKey The key provided in the request
     * @param expectedKey The expected key from settings
     * @return true if keys match, false otherwise
     */
    public boolean validateBrowserExamKey(String providedKey, String expectedKey) {
        if (providedKey == null || expectedKey == null) {
            log.debug("Provided key or expected key is null, validation failed");
            return false;
        }

        boolean isValid = providedKey.equals(expectedKey);
        log.debug("Browser Exam Key validation result: {}", isValid);
        return isValid;
    }

    /**
     * Checks if a request is coming from Safe Exam Browser and validates any Browser Exam Key
     * if a SEB setting is provided.
     *
     * @param request The HTTP request to check
     * @param sebSetting The SEB setting for the quiz being accessed (can be null)
     * @return true if the request is from SEB and passes any validation, false otherwise
     */
    public boolean isRequestFromSEB(HttpServletRequest request, QuizSebSetting sebSetting) {
        // First check if this is a SEB browser at all
        boolean isSebBrowser = isSebBrowser(request);

        if (!isSebBrowser) {
            log.debug("Request is not from SEB browser");
            return false;
        }

        // If no SEB setting is provided, just return true based on browser detection
        if (sebSetting == null) {
            log.debug("No SEB setting provided, accepting SEB browser based on detection alone");
            return true;
        }

        // Modern WKWebView exposes BEK/CK via the SEB JavaScript API instead of HTTP headers.
        String configKey = sebSetting.getConfigKey();
        String configKeyHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        if (configKey != null && !configKey.isEmpty() && configKeyHash != null && !configKeyHash.isEmpty()) {
            boolean isValid = sebConfigKeyService.validateConfigKeyHash(request, configKey);
            log.debug("Config Key Hash validation result: {}", isValid);
            return isValid;
        }

        // Validate a BEK header when classic WebView sends one, but do not reject modern SEB
        // solely because that header is absent.
        String browserExamKey = sebSetting.getBrowserExamKey();
        if (browserExamKey != null && !browserExamKey.isEmpty()) {
            if (request.getHeader(BROWSER_EXAM_KEY_HEADER) == null || request.getHeader(BROWSER_EXAM_KEY_HEADER).isEmpty()) {
                log.debug("SEB Browser Exam Key header absent; accepting detected SEB request for modern WebView compatibility");
                return true;
            }
            boolean isValid = validateBrowserExamKey(request, browserExamKey);
            log.debug("Browser Exam Key validation result: {}", isValid);
            return isValid;
        }

        // If there's a SEB setting but no Browser Exam Key, just return true based on browser detection
        log.debug("SEB setting has no Browser Exam Key, accepting SEB browser based on detection alone");
        return true;
    }

    /**
     * Checks if a request is coming from Safe Exam Browser for content-scoped settings.
     */
    public boolean isRequestFromSEB(HttpServletRequest request, ContentSebSetting sebSetting) {
        boolean isSebBrowser = isSebBrowser(request);

        if (!isSebBrowser) {
            log.debug("Request is not from SEB browser");
            return false;
        }

        if (sebSetting == null) {
            log.debug("No content SEB setting provided, accepting SEB browser based on detection alone");
            return true;
        }

        String configKey = sebSetting.getConfigKey();
        String configKeyHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        if (configKey != null && !configKey.isEmpty() && configKeyHash != null && !configKeyHash.isEmpty()) {
            boolean isValid = sebConfigKeyService.validateConfigKeyHash(request, configKey);
            log.debug("Content Config Key Hash validation result: {}", isValid);
            return isValid;
        }

        String browserExamKey = sebSetting.getBrowserExamKey();
        if (browserExamKey != null && !browserExamKey.isEmpty()) {
            if (request.getHeader(BROWSER_EXAM_KEY_HEADER) == null || request.getHeader(BROWSER_EXAM_KEY_HEADER).isEmpty()) {
                log.debug("SEB Browser Exam Key header absent; accepting detected SEB request for modern WebView compatibility");
                return true;
            }
            boolean isValid = validateBrowserExamKey(request, browserExamKey);
            log.debug("Content Browser Exam Key validation result: {}", isValid);
            return isValid;
        }

        log.debug("Content SEB setting has no Browser Exam Key, accepting SEB browser based on detection alone");
        return true;
    }

    /**
     * Validates a Config Key Hash from SEB.
     */
    public boolean validateConfigKeyHash(HttpServletRequest request, String configKey) {
        return sebConfigKeyService.validateConfigKeyHash(request, configKey);
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
                log.trace("{}: <present>", headerName);
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
