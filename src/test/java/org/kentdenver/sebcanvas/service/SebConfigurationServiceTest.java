package org.kentdenver.sebcanvas.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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
        ReflectionTestUtils.setField(sebConfigurationService, "requiredUrlFilterDomains", "du11hjcvx0uqb.cloudfront.net");
    }

    @Test
    void generateSebConfigurationUsesExamStartPurposeNotClientReconfiguration() {
        String xml = new String(
                sebConfigurationService.generateSebConfiguration(
                        "course-1",
                        "quiz-1",
                        "https://canvas.example.com/courses/course-1/quizzes/quiz-1",
                        "access-1"),
                StandardCharsets.UTF_8
        );

        assertEquals(0, integerValueForKey(xml, "sebConfigPurpose"));
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
        assertFalse(xml.contains("<key>configKey</key>"));
    }

    @Test
    void generateSebConfigurationIsDeterministicForSameInputs() {
        byte[] first = sebConfigurationService.generateSebConfiguration(
                "course-1",
                "quiz-1",
                "https://app.example.com/seb/launch/classicquiz_quiz-1",
                "access-1");
        byte[] second = sebConfigurationService.generateSebConfiguration(
                "course-1",
                "quiz-1",
                "https://app.example.com/seb/launch/classicquiz_quiz-1",
                "access-1");

        assertTrue(java.util.Arrays.equals(first, second));
    }

    @Test
    void generateSebConfigurationAllowsCanvasRuntimeDomainsSeenInSebLaunch() {
        String xml = new String(
                sebConfigurationService.generateSebConfiguration(
                        "11825",
                        "23455",
                        "https://kentdenver.instructure.com/courses/11825/quizzes/23455/take?user_id=7288",
                        "access-1"),
                StandardCharsets.UTF_8
        );

        assertTrue(xml.contains("<string>https://du11hjcvx0uqb.cloudfront.net/*</string>"));
        assertTrue(xml.contains("<string>https://*.canvas-user-content.com/*</string>"));
        assertTrue(xml.contains("<string>https://*.inscloudgate.net/*</string>"));
        assertFalse(xml.contains("<string>https://*.cloudfront.net/*</string>"));
    }

    @Test
    void devAndProdProfilesIncludeKentGoogleSsoDomainsForSeb() throws Exception {
        for (String resourceName : new String[]{"application-dev.properties", "application-prod.properties"}) {
            String domains = loadRequiredUrlFilterDomains(resourceName);

            assertConfiguredDomain(domains, "du11hjcvx0uqb.cloudfront.net", resourceName);
            assertConfiguredDomain(domains, "accounts.google.com", resourceName);
            assertConfiguredDomain(domains, "ssl.gstatic.com", resourceName);
            assertConfiguredDomain(domains, "www.gstatic.com", resourceName);
            assertConfiguredDomain(domains, "*.gstatic.com", resourceName);
            assertConfiguredDomain(domains, "*.googleapis.com", resourceName);
        }
    }

    @Test
    void generateSebConfigurationIncludesKentGoogleSsoDomainsFromDevProfile() throws Exception {
        ReflectionTestUtils.setField(
                sebConfigurationService,
                "requiredUrlFilterDomains",
                loadRequiredUrlFilterDomains("application-dev.properties")
        );

        String xml = new String(
                sebConfigurationService.generateSebConfiguration(
                        "11825",
                        "23455",
                        "https://kentdenver.instructure.com/courses/11825/quizzes/23455/take?user_id=7288",
                        "access-1"),
                StandardCharsets.UTF_8
        );

        assertTrue(xml.contains("<string>https://accounts.google.com/*</string>"));
        assertTrue(xml.contains("<string>https://ssl.gstatic.com/*</string>"));
        assertTrue(xml.contains("<string>https://www.gstatic.com/*</string>"));
        assertTrue(xml.contains("<string>https://*.gstatic.com/*</string>"));
        assertTrue(xml.contains("<string>https://*.googleapis.com/*</string>"));
        assertFalse(xml.contains("<string>https://*.cloudfront.net/*</string>"));
    }

    @Test
    void generateSebConfigurationRestartsAssessmentInsteadOfExitPage() {
        String quizUrl = "https://kentdenver.instructure.com/courses/11825/quizzes/23455/take";
        String xml = new String(
                sebConfigurationService.generateSebConfiguration(
                        "11825",
                        "23455",
                        quizUrl,
                        "access-1"),
                StandardCharsets.UTF_8
        );

        assertEquals(quizUrl, stringValueForKey(xml, "restartExamURL"));
        assertEquals("https://app.example.com/seb/exit/quit/11825/23455", stringValueForKey(xml, "quitURL"));
        assertFalse(booleanValueForKey(xml, "allowQuit"));
        assertFalse(booleanValueForKey(xml, "quitURLConfirm"));
        assertFalse(stringValueForKey(xml, "restartExamURL").contains("/seb/exit"));
    }

    @Test
    void generateSebConfigurationUsesPlainCanvasQuizIdForClassicQuizQuitUrl() {
        String xml = new String(
                sebConfigurationService.generateSebConfiguration(
                        "11825",
                        "classicquiz_23455",
                        "https://kentdenver.instructure.com/courses/11825/quizzes/23455/take",
                        "access-1"),
                StandardCharsets.UTF_8
        );

        assertEquals("https://app.example.com/seb/exit/quit/11825/23455", stringValueForKey(xml, "quitURL"));
    }

    @Test
    void generateSebConfigurationEnablesPasswordProtectedManualQuitWhenDefaultPasswordConfigured() {
        ReflectionTestUtils.setField(sebConfigurationService, "quitPassword", "emergency-exit");

        String xml = new String(
                sebConfigurationService.generateSebConfiguration(
                        "11825",
                        "23455",
                        "https://kentdenver.instructure.com/courses/11825/quizzes/23455/take",
                        "access-1"),
                StandardCharsets.UTF_8
        );

        assertTrue(booleanValueForKey(xml, "allowQuit"));
        assertTrue(booleanValueForKey(xml, "enableCmdQ"));
        assertFalse(booleanValueForKey(xml, "ignoreQuitPassword"));
        assertEquals("fa2cc6aa1ee60874ee1c699c6cba76b0497994f3488418f9af343de99559c60d", stringValueForKey(xml, "hashedQuitPassword"));
    }

    @Test
    void generateSebConfigurationUsesQuizSpecificQuitPasswordBeforeDefaultPassword() {
        ReflectionTestUtils.setField(sebConfigurationService, "quitPassword", "default-exit");

        String xml = new String(
                sebConfigurationService.generateSebConfiguration(
                        "11825",
                        "23455",
                        "https://kentdenver.instructure.com/courses/11825/quizzes/23455/take",
                        "access-1",
                        List.of(),
                        "quiz-exit"),
                StandardCharsets.UTF_8
        );

        assertEquals("6065776a383ee8d957c3f9683fa8e287aea9c22fb4c70bb98d98f9968cadce26", stringValueForKey(xml, "hashedQuitPassword"));
    }

    private String loadRequiredUrlFilterDomains(String resourceName) throws Exception {
        Properties properties = new Properties();
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream(resourceName)) {
            assertNotNull(stream, "Missing test resource " + resourceName);
            properties.load(stream);
        }

        String domains = properties.getProperty("app.seb.required-url-filter-domains");
        assertNotNull(domains, "Missing app.seb.required-url-filter-domains in " + resourceName);
        return domains;
    }

    private void assertConfiguredDomain(String domains, String expectedDomain, String resourceName) {
        assertTrue(
                Arrays.stream(domains.split(","))
                        .map(String::trim)
                        .anyMatch(expectedDomain::equals),
                () -> resourceName + " must include " + expectedDomain
        );
    }

    private String stringValueForKey(String xml, String key) {
        Pattern pattern = Pattern.compile("<key>" + Pattern.quote(key) + "</key>\\s*<string>(.*?)</string>", Pattern.DOTALL);
        Matcher matcher = pattern.matcher(xml);
        assertTrue(matcher.find(), "Missing string value for SEB key " + key);
        return matcher.group(1);
    }

    private boolean booleanValueForKey(String xml, String key) {
        Pattern pattern = Pattern.compile("<key>" + Pattern.quote(key) + "</key>\\s*<(true|false)/>", Pattern.DOTALL);
        Matcher matcher = pattern.matcher(xml);
        assertTrue(matcher.find(), "Missing boolean value for SEB key " + key);
        return "true".equals(matcher.group(1));
    }

    private int integerValueForKey(String xml, String key) {
        Pattern pattern = Pattern.compile("<key>" + Pattern.quote(key) + "</key>\\s*<integer>(\\d+)</integer>", Pattern.DOTALL);
        Matcher matcher = pattern.matcher(xml);
        assertTrue(matcher.find(), "Missing integer value for SEB key " + key);
        return Integer.parseInt(matcher.group(1));
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
