package org.kentdenver.sebcanvas.util;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Enhanced SebDetector with additional methods for validating Safe Exam Browser requests.
 * This class extends the existing SebDetector functionality to support the new SEB redirection flow.
 */
@Component
@Slf4j
public class SebDetectorExtension {

    private final SebDetector sebDetector;

    /**
     * Constructor with dependency injection for SebDetector.
     *
     * @param sebDetector The original SebDetector implementation
     */
    public SebDetectorExtension(SebDetector sebDetector) {
        this.sebDetector = sebDetector;
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
        boolean isSebBrowser = sebDetector.isSebBrowser(request);

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
        // Validate a BEK header when present, but do not reject modern SEB solely because the
        // classic WebView header is absent.
        String browserExamKey = sebSetting.getBrowserExamKey();
        if (browserExamKey != null && !browserExamKey.isEmpty()) {
            String browserExamKeyHeader = request.getHeader("X-SafeExamBrowser-BrowserExamKey");
            if (browserExamKeyHeader == null || browserExamKeyHeader.isEmpty()) {
                log.debug("SEB Browser Exam Key header absent; accepting detected SEB request for modern WebView compatibility");
                return true;
            }
            boolean isValid = sebDetector.validateBrowserExamKey(request, browserExamKey);
            log.debug("Browser Exam Key validation result: {}", isValid);
            return isValid;
        }

        // If there's a SEB setting but no Browser Exam Key, just return true based on browser detection
        log.debug("SEB setting has no Browser Exam Key, accepting SEB browser based on detection alone");
        return true;
    }

    /**
     * Validates a provided Browser Exam Key against the expected key.
     * This method is useful for standalone validation API endpoints.
     *
     * @param providedKey The Browser Exam Key provided in the request
     * @param expectedKey The expected Browser Exam Key from the SEB setting
     * @return true if the keys match, false otherwise
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
}
