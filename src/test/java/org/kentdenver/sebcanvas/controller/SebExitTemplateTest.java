package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SebExitTemplateTest {

    @Test
    void sebExitTemplateRedirectsToModelQuitUrlWithoutRebuildingLegacyPath() throws Exception {
        String template = loadTemplate("templates/sebExit.html");

        assertTrue(template.contains("id=\"sebQuitLink\""));
        assertTrue(template.contains("th:href=\"${quitUrl}\""));
        assertTrue(template.contains("window.location.assign(document.getElementById('sebQuitLink').href)"));
        assertFalse(template.contains("window.location.href = '/seb/exit/quit/'"));
    }

    @Test
    void sebQuitTemplateProvidesLegacyManualRetryLink() throws Exception {
        String template = loadTemplate("templates/sebQuit.html");

        assertTrue(template.contains("id=\"sebLegacyQuitLink\""));
        assertTrue(template.contains("th:href=\"${legacyQuitUrl}\""));
    }

    private String loadTemplate(String resourceName) throws Exception {
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream(resourceName)) {
            assertNotNull(stream, "Missing template " + resourceName);
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
