package org.kentdenver.sebcanvas.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SebConfigurationServiceTest {

    private SebConfigurationService sebConfigurationService;

    @BeforeEach
    void setUp() {
        sebConfigurationService = new SebConfigurationService();
        ReflectionTestUtils.setField(sebConfigurationService, "canvasApiConfig", new TestCanvasApiConfig());
        ReflectionTestUtils.setField(sebConfigurationService, "configuredBaseUrl", "https://app.example.com");
        ReflectionTestUtils.setField(sebConfigurationService, "canvasBaseUrl", "");
        ReflectionTestUtils.setField(sebConfigurationService, "quitPassword", "");
    }

    @Test
    void generateSebConfigurationForcesModernWebViewWithoutBekHeaders() {
        String xml = new String(
                sebConfigurationService.generateSebConfiguration(
                        "course-1",
                        "quiz-1",
                        "https://canvas.example.com/courses/course-1/quizzes/quiz-1",
                        "access-1"),
                StandardCharsets.UTF_8
        );

        assertTrue(xml.contains("<key>browserWindowWebView</key>"));
        assertTrue(xml.contains("<integer>3</integer>"));
        assertTrue(xml.contains("<key>browserWindowWebViewClassicHideDeprecationNote</key>"));
        assertTrue(xml.contains("<key>sendBrowserExamKey</key>"));
        assertTrue(xml.contains("<false/>"));
        assertFalse(xml.contains("<key>browserEngine</key>"));
    }

    private static class TestCanvasApiConfig extends CanvasApiConfig {
        TestCanvasApiConfig() {
            super(null);
        }

        @Override
        public String getApplicationBaseUrl() {
            return "https://app.example.com";
        }

        @Override
        public String getCanvasDomain() {
            return "canvas.example.com";
        }
    }
}
