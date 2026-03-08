package org.kentdenver.sebcanvas.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SebConfigServiceTest {

    @Mock
    private CanvasApiConfig canvasApiConfig;

    private SebConfigService sebConfigService;

    @BeforeEach
    void setUp() {
        sebConfigService = new SebConfigService();
        ReflectionTestUtils.setField(sebConfigService, "canvasApiConfig", canvasApiConfig);

        when(canvasApiConfig.getApplicationBaseUrl()).thenReturn("https://app.example.com");
        when(canvasApiConfig.getCanvasDomain()).thenReturn("canvas.example.com");
    }

    @Test
    void generateSebConfigDoesNotEmitQuitPasswordHashWithoutConfiguredPassword() {
        ReflectionTestUtils.setField(sebConfigService, "configuredQuitPassword", "");

        String xml = generateXml(Map.of(
                "ssoDomains", List.of(),
                "educationalToolDomains", List.of(),
                "customDomains", List.of()
        ));

        assertFalse(xml.contains("<key>hashedQuitPassword</key>"));
        assertTrue(xml.contains("<key>allowQuit</key>"));
        assertTrue(xml.contains("<false/>"));
        assertTrue(xml.contains("<key>ignoreQuitPassword</key>"));
    }

    @Test
    void generateSebConfigUsesExplicitQuitPasswordInsteadOfLegacyDefault() throws Exception {
        ReflectionTestUtils.setField(sebConfigService, "configuredQuitPassword", "server-default");

        String xml = generateXml(Map.of(
                "quitPassword", "quiz-specific-secret",
                "ssoDomains", List.of(),
                "educationalToolDomains", List.of(),
                "customDomains", List.of()
        ));

        assertTrue(xml.contains("<key>hashedQuitPassword</key>"));
        assertTrue(xml.contains(hash("quiz-specific-secret")));
        assertFalse(xml.contains(hash("quit123")));
        assertFalse(xml.contains(hash("server-default")));
    }

    private String generateXml(Map<String, Object> customSettings) {
        return new String(
                sebConfigService.generateSebConfig("course-1", "quiz-1", "access-1", new QuizSebSetting(), customSettings),
                StandardCharsets.UTF_8
        );
    }

    private String hash(String password) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(password.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(digest);
    }
}