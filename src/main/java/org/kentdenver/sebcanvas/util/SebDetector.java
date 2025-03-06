package org.kentdenver.sebcanvas.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.servlet.http.HttpServletRequest;

@Component
@Slf4j
public class SebDetector {

    private static final String USER_AGENT_HEADER = "User-Agent";
    private static final String CONFIG_KEY_HASH_HEADER = "X-SafeExamBrowser-ConfigKeyHash";
    private static final String BROWSER_EXAM_KEY_HEADER = "X-SafeExamBrowser-BrowserExamKey";

    /**
     * Detect if the request is coming from Safe Exam Browser
     */
    public boolean isSebBrowser(HttpServletRequest request) {
        String userAgent = request.getHeader(USER_AGENT_HEADER);

        if (userAgent != null && userAgent.contains("SEB")) {
            log.debug("SEB detected through User-Agent: {}", userAgent);
            return true;
        }

        // Check for SEB-specific headers
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

        log.debug("SEB not detected");
        return false;
    }
}