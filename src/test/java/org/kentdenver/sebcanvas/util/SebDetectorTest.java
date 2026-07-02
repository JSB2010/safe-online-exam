package org.kentdenver.sebcanvas.util;

import org.junit.jupiter.api.Test;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SebDetectorTest {

    private final SebDetector sebDetector = new SebDetector();

    @Test
    void isRequestFromSebAcceptsModernWebViewWithoutBrowserExamKeyHeader() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("User-Agent", "Mozilla/5.0 AppleWebKit/605.1.15 SEB/3.6.1");

        QuizSebSetting setting = new QuizSebSetting();
        setting.setBrowserExamKey("expected-key");

        assertTrue(sebDetector.isRequestFromSEB(request, setting));
    }

    @Test
    void isRequestFromSebRejectsWrongBrowserExamKeyHeaderWhenHeaderIsPresent() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("User-Agent", "Mozilla/5.0 AppleWebKit/605.1.15 SEB/3.6.1");
        request.addHeader("X-SafeExamBrowser-BrowserExamKey", "wrong-key");

        QuizSebSetting setting = new QuizSebSetting();
        setting.setBrowserExamKey("expected-key");

        assertFalse(sebDetector.isRequestFromSEB(request, setting));
    }
}
