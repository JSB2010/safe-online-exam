package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * Service for generating Safe Exam Browser (SEB) configuration files.
 * Creates .seb XML configuration files with quiz URLs, access codes, and security settings.
 */
@Service
@Slf4j
public class SebConfigService {

    private static final String SEB_CONFIG_VERSION = "2.4.1";

    @Value("${app.base-url:}")
    private String configuredBaseUrl;

    @Value("${app.seb.quit-password:${SEB_QUIT_PASSWORD:}}")
    private String configuredQuitPassword;

    @Autowired
    private CanvasApiConfig canvasApiConfig;

    /**
     * Gets the base URL for this application, dynamically determined from configuration.
     */
    private String getBaseUrl() {
        // First try configured base URL
        if (configuredBaseUrl != null && !configuredBaseUrl.isEmpty()) {
            return configuredBaseUrl;
        }

        try {
            String baseUrl = canvasApiConfig.getApplicationBaseUrl();
            if (baseUrl != null && !baseUrl.isBlank()) {
                return baseUrl;
            }
        } catch (Exception e) {
            log.warn("Could not get base URL from Canvas API config: {}", e.getMessage());
        }

        throw new IllegalStateException("Application base URL is not configured");
    }

    /**
     * Gets the Canvas domain dynamically from the Canvas API configuration.
     */
    private String getCanvasDomain() {
        try {
            String domain = canvasApiConfig.getCanvasDomain();
            if (domain != null && !domain.isEmpty()) {
                // Remove https:// if present
                return domain.replace("https://", "");
            }
        } catch (Exception e) {
            log.warn("Could not get Canvas domain from config: {}", e.getMessage());
        }

        throw new IllegalStateException("Canvas domain is not configured");
    }

    /**
     * Generates a complete SEB configuration file for a quiz.
     */
    public byte[] generateSebConfig(String courseId, String quizId, String accessCode,
                                   QuizSebSetting sebSetting, Map<String, Object> customSettings) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.newDocument();

            // Root element
            Element root = doc.createElement("dict");
            doc.appendChild(root);

            // Add SEB configuration settings
            addBasicSettings(doc, root, courseId, quizId, accessCode);
            addSecuritySettings(doc, root, sebSetting);
            addUrlFilterSettings(doc, root, sebSetting, customSettings);
            addBrowserSettings(doc, root, sebSetting);
            addExamSettings(doc, root, sebSetting, customSettings, courseId, quizId);

            // Convert to XML string
            return documentToByteArray(doc);

        } catch (Exception e) {
            log.error("Error generating SEB configuration: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to generate SEB configuration", e);
        }
    }

    /**
     * Adds basic SEB configuration settings.
     */
    private void addBasicSettings(Document doc, Element root, String courseId, String quizId, String accessCode) {
        // Get Canvas domain dynamically from configuration
        String canvasDomain = getCanvasDomain();

        // Start URL - direct link to the Canvas quiz with access code parameter
        // This allows SEB to automatically provide the access code when accessing the quiz
        String startUrl = String.format("https://%s/courses/%s/quizzes/%s", canvasDomain, courseId, quizId);
        if (accessCode != null && !accessCode.isEmpty()) {
            startUrl += "?access_code=" + accessCode;
        }
        addKeyValue(doc, root, "startURL", startUrl);

        // SEB version and configuration
        addKeyValue(doc, root, "sebConfigPurpose", 1); // 1 = starting exam
        addKeyValue(doc, root, "sebServicePolicy", 1); // 1 = use SEB service

        // Browser Exam Key (BEK) - unique identifier for this configuration
        String browserExamKey = generateBrowserExamKey(courseId, quizId, accessCode);
        addKeyValue(doc, root, "browserExamKey", browserExamKey);

        // Config Key - hash of the configuration for verification
        addKeyValue(doc, root, "configKey", generateConfigKey(browserExamKey));

        // Add access code for automatic form filling (additional method)
        if (accessCode != null && !accessCode.isEmpty()) {
            addKeyValue(doc, root, "examSessionClearCookiesOnStart", true);
            // Add JavaScript injection for automatic access code entry
            addKeyValue(doc, root, "additionalResources", createAccessCodeJavaScript(accessCode));
        }
    }

    /**
     * Adds security settings to prevent cheating.
     */
    private void addSecuritySettings(Document doc, Element root, QuizSebSetting sebSetting) {
        // Disable dangerous features
        addKeyValue(doc, root, "allowBrowsingBackForward", false);
        addKeyValue(doc, root, "allowReload", false);
        addKeyValue(doc, root, "showReloadButton", false);
        addKeyValue(doc, root, "allowQuit", false);
        addKeyValue(doc, root, "ignoreExitKeys", true);
        addKeyValue(doc, root, "enableAltEsc", false);
        addKeyValue(doc, root, "enableAltTab", false);
        addKeyValue(doc, root, "enableCtrlAltDel", false);
        addKeyValue(doc, root, "enableF1", false);
        addKeyValue(doc, root, "enableF2", false);
        addKeyValue(doc, root, "enableF3", false);
        addKeyValue(doc, root, "enableF4", false);
        addKeyValue(doc, root, "enableF5", false);
        addKeyValue(doc, root, "enableF6", false);
        addKeyValue(doc, root, "enableF7", false);
        addKeyValue(doc, root, "enableF8", false);
        addKeyValue(doc, root, "enableF9", false);
        addKeyValue(doc, root, "enableF10", false);
        addKeyValue(doc, root, "enableF11", false);
        addKeyValue(doc, root, "enableF12", false);

        // Screen capture prevention
        addKeyValue(doc, root, "enablePrintScreen", false);
        addKeyValue(doc, root, "enableRightMouse", false);

        // Application switching prevention
        addKeyValue(doc, root, "allowSwitchToApplications", false);
        addKeyValue(doc, root, "allowFlashFullscreen", false);

        // Audio/video restrictions
        addKeyValue(doc, root, "audioControlEnabled", true);
        addKeyValue(doc, root, "audioMute", false);
        addKeyValue(doc, root, "audioSetVolumeLevel", true);
        addKeyValue(doc, root, "audioVolumeLevel", 25);
    }

    /**
     * Adds URL filtering settings to restrict browsing.
     */
    private void addUrlFilterSettings(Document doc, Element root, QuizSebSetting sebSetting, Map<String, Object> customSettings) {
        // Enable URL filtering
        addKeyValue(doc, root, "URLFilterEnable", true);
        addKeyValue(doc, root, "URLFilterEnableContentFilter", true);

        // Create URL filter rules array
        Element urlFilterRules = doc.createElement("array");
        addKeyElement(doc, root, "URLFilterRules", urlFilterRules);

        // Get Canvas domain dynamically
        String canvasDomain = getCanvasDomain();

        // Allow Canvas domain with specific paths for security
        addUrlFilterRule(doc, urlFilterRules, true, "https://" + canvasDomain + "/courses/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://" + canvasDomain + "/api/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://" + canvasDomain + "/login/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://" + canvasDomain + "/files/*");

        // Allow Canvas infrastructure domains
        addCanvasInfrastructureDomains(doc, urlFilterRules);

        // Add structured domain configuration if available
        addStructuredDomains(doc, urlFilterRules, sebSetting, customSettings);

        // Add legacy custom allowed URLs if provided
        if (customSettings != null && customSettings.containsKey("allowedUrls")) {
            @SuppressWarnings("unchecked")
            List<String> allowedUrls = (List<String>) customSettings.get("allowedUrls");
            for (String url : allowedUrls) {
                if (isValidUrlPattern(url)) {
                    addUrlFilterRule(doc, urlFilterRules, true, url);
                } else {
                    log.warn("Skipping invalid URL pattern: {}", url);
                }
            }
        }

        // Note: No "block all" rule needed - SEB automatically blocks anything not explicitly allowed when URL filtering is enabled
    }

    /**
     * Adds browser-specific settings.
     */
    private void addBrowserSettings(Document doc, Element root, QuizSebSetting sebSetting) {
        // Browser window settings
        addKeyValue(doc, root, "browserWindowAllowReload", false);
        addKeyValue(doc, root, "browserWindowShowURL", false);
        addKeyValue(doc, root, "newBrowserWindowByLinkPolicy", 2); // 2 = block
        addKeyValue(doc, root, "newBrowserWindowByScriptPolicy", 2); // 2 = block

        // Zoom settings
        addKeyValue(doc, root, "zoomMode", 0); // 0 = page zoom
        addKeyValue(doc, root, "allowZoomText", true);
        addKeyValue(doc, root, "allowZoomPage", true);

        // User agent string
        addKeyValue(doc, root, "browserUserAgent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 SEB/3.5");

        // Force WKWebView. In SEB macOS, browserWindowWebView values are:
        // 0=Automatic, 1=Force Classic, 2=Force Modern for foreign new tabs, 3=Force Modern.
        addKeyValue(doc, root, "browserWindowWebView", 3);
        addKeyValue(doc, root, "browserWindowWebViewClassicHideDeprecationNote", false);
        addKeyValue(doc, root, "sendBrowserExamKey", false);

        // Additional modern browser settings
        addKeyValue(doc, root, "newBrowserWindowByLinkBlockForeign", true); // Block foreign links in new windows
        addKeyValue(doc, root, "newBrowserWindowByScriptBlockForeign", true); // Block foreign scripts in new windows
    }

    /**
     * Adds exam-specific settings.
     */
    private void addExamSettings(Document doc, Element root, QuizSebSetting sebSetting, Map<String, Object> customSettings, String courseId, String quizId) {
        String quitPassword = resolveQuitPassword(customSettings);
        boolean hasQuitPassword = quitPassword != null && !quitPassword.isBlank();

        if (hasQuitPassword) {
            String hashedPassword = generateHashedPassword(quitPassword);
            addKeyValue(doc, root, "hashedQuitPassword", hashedPassword);
            addKeyValue(doc, root, "hashedAdminPassword", hashedPassword);
        }

        addKeyValue(doc, root, "allowQuit", hasQuitPassword);
        addKeyValue(doc, root, "ignoreQuitPassword", !hasQuitPassword);
        addKeyValue(doc, root, "showMenuBar", false); // Hide menu bar to prevent easy access
        addKeyValue(doc, root, "enableTouchExit", false); // Disable touch exit on tablets
        addKeyValue(doc, root, "allowPreferencesWindow", false); // Block access to preferences without password

        // Quit URL for after exam completion - points to our SEB exit handler
        String baseUrl = getBaseUrl();
        String quitUrl = String.format("%s/seb/exit/quit/%s/%s",
                                       baseUrl, courseId, quizId);
        addKeyValue(doc, root, "quitURL", quitUrl);

        // Additional quit URLs for different scenarios
        String exitPageUrl = String.format("%s/seb/exit/%s/%s",
                                           baseUrl, courseId, quizId);
        addKeyValue(doc, root, "sebExitPageURL", exitPageUrl);

        // Restart exam URL - this is where SEB goes when exam is restarted/completed
        // Point this to our exit page so students see the completion screen
        addKeyValue(doc, root, "restartExamURL", exitPageUrl);

        // Additional SEB completion handling settings
        addKeyValue(doc, root, "examSessionClearCookiesOnEnd", true);
        addKeyValue(doc, root, "examSessionClearCookiesOnStart", false);

        // === SUPPRESS RE-CONFIGURATION DIALOG ===
        // These settings help suppress the "SEB Re-Configured" dialog
        addKeyValue(doc, root, "showReconfigurationDialog", false); // Don't show reconfiguration dialog
        addKeyValue(doc, root, "allowReconfiguration", true); // Allow reconfiguration but silently
        addKeyValue(doc, root, "forceAppFolderInstall", false); // Don't force app folder install dialog
        addKeyValue(doc, root, "sebConfigPurpose", 1); // 1 = starting exam (vs configuring client)

        // Additional settings
        addKeyValue(doc, root, "showTaskBar", false);
        addKeyValue(doc, root, "hideTaskBarOnFullscreen", true);
        addKeyValue(doc, root, "taskBarHeight", 40);
    }

    private String resolveQuitPassword(Map<String, Object> customSettings) {
        if (customSettings != null) {
            Object customQuitPassword = customSettings.get("quitPassword");
            if (customQuitPassword instanceof String password && !password.isBlank()) {
                return password;
            }
        }

        if (configuredQuitPassword != null && !configuredQuitPassword.isBlank()) {
            return configuredQuitPassword;
        }

        return null;
    }

    /**
     * Adds a URL filter rule to the rules array.
     */
    private void addUrlFilterRule(Document doc, Element rulesArray, boolean allow, String expression) {
        Element rule = doc.createElement("dict");
        rulesArray.appendChild(rule);

        addKeyValue(doc, rule, "action", allow ? 1 : 0); // 1 = allow, 0 = block
        addKeyValue(doc, rule, "active", true);
        addKeyValue(doc, rule, "expression", expression);
        addKeyValue(doc, rule, "regex", false);
    }

    /**
     * Generates a Browser Exam Key for the configuration.
     */
    private String generateBrowserExamKey(String courseId, String quizId, String accessCode) {
        try {
            String input = String.format("SEB_%s_%s_%s_%d", courseId, quizId, accessCode, System.currentTimeMillis());
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes());
            return Base64.getEncoder().encodeToString(hash).substring(0, 32);
        } catch (Exception e) {
            log.error("Error generating browser exam key: {}", e.getMessage());
            return generateRandomString(32);
        }
    }

    /**
     * Generates a Config Key hash for verification.
     */
    private String generateConfigKey(String browserExamKey) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(browserExamKey.getBytes());
            return Base64.getEncoder().encodeToString(hash).substring(0, 32);
        } catch (Exception e) {
            log.error("Error generating config key: {}", e.getMessage());
            return generateRandomString(32);
        }
    }

    /**
     * Generates a hashed password for SEB.
     */
    private String generateHashedPassword(String password) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(password.getBytes());
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            log.error("Error generating hashed password: {}", e.getMessage());
            return "";
        }
    }

    /**
     * Generates a random string of specified length.
     */
    private String generateRandomString(int length) {
        SecureRandom random = new SecureRandom();
        byte[] bytes = new byte[length];
        random.nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes).substring(0, length);
    }

    /**
     * Helper method to add a key-value pair to the XML document.
     */
    private void addKeyValue(Document doc, Element parent, String key, Object value) {
        Element keyElement = doc.createElement("key");
        keyElement.setTextContent(key);
        parent.appendChild(keyElement);

        Element valueElement;
        if (value instanceof Boolean) {
            valueElement = doc.createElement((Boolean) value ? "true" : "false");
        } else if (value instanceof Integer) {
            valueElement = doc.createElement("integer");
            valueElement.setTextContent(value.toString());
        } else if (value instanceof String) {
            valueElement = doc.createElement("string");
            valueElement.setTextContent((String) value);
        } else {
            valueElement = doc.createElement("string");
            valueElement.setTextContent(value.toString());
        }
        parent.appendChild(valueElement);
    }

    /**
     * Helper method to add a key with an element value.
     */
    private void addKeyElement(Document doc, Element parent, String key, Element element) {
        Element keyElement = doc.createElement("key");
        keyElement.setTextContent(key);
        parent.appendChild(keyElement);
        parent.appendChild(element);
    }

    /**
     * Converts XML document to byte array.
     */
    private byte[] documentToByteArray(Document doc) throws Exception {
        TransformerFactory transformerFactory = TransformerFactory.newInstance();
        Transformer transformer = transformerFactory.newTransformer();
        transformer.setOutputProperty(OutputKeys.INDENT, "yes");
        transformer.setOutputProperty(OutputKeys.DOCTYPE_PUBLIC,
            "-//Apple//DTD PLIST 1.0//EN");
        transformer.setOutputProperty(OutputKeys.DOCTYPE_SYSTEM,
            "http://www.apple.com/DTDs/PropertyList-1.0.dtd");

        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        DOMSource source = new DOMSource(doc);
        StreamResult result = new StreamResult(outputStream);
        transformer.transform(source, result);

        return outputStream.toByteArray();
    }

    /**
     * Creates JavaScript code for automatic access code entry.
     * This JavaScript will be injected into the SEB browser to automatically
     * fill in access code fields when they appear.
     */
    private String createAccessCodeJavaScript(String accessCode) {
        return String.format("""
            // SEB Auto Access Code Entry Script
            (function() {
                const accessCode = '%s';

                // Function to automatically fill access code fields
                function fillAccessCode() {
                    // Look for Canvas access code input fields
                    const accessCodeInputs = document.querySelectorAll(
                        'input[name="access_code"], ' +
                        'input[id*="access_code"], ' +
                        'input[placeholder*="access code"], ' +
                        'input[placeholder*="Access Code"]'
                    );

                    accessCodeInputs.forEach(input => {
                        if (input.value === '' || input.value === null) {
                            input.value = accessCode;
                            // Trigger change events
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            console.log('SEB: Auto-filled access code');
                        }
                    });

                    // Auto-submit if there's a submit button
                    const submitButtons = document.querySelectorAll(
                        'button[type="submit"], ' +
                        'input[type="submit"], ' +
                        'button:contains("Submit"), ' +
                        'button:contains("Continue")'
                    );

                    if (submitButtons.length > 0 && accessCodeInputs.length > 0) {
                        setTimeout(() => {
                            submitButtons[0].click();
                            console.log('SEB: Auto-submitted access code form');
                        }, 500);
                    }
                }

                // Run immediately
                fillAccessCode();

                // Run when DOM changes (for dynamic content)
                const observer = new MutationObserver(fillAccessCode);
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                // Run periodically as fallback
                setInterval(fillAccessCode, 1000);

                console.log('SEB: Access code auto-entry script loaded');
            })();
            """, accessCode);
    }

    /**
     * Adds Canvas infrastructure domains that are required for Canvas to function properly.
     */
    private void addCanvasInfrastructureDomains(Document doc, Element urlFilterRules) {
        // Canvas core infrastructure
        addUrlFilterRule(doc, urlFilterRules, true, "https://*.instructure.com/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://*.canvaslms.com/*");

        // Canvas file storage and CDN
        addUrlFilterRule(doc, urlFilterRules, true, "https://instructure-uploads.s3.amazonaws.com/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://instructure-uploads-*.s3.amazonaws.com/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://*.cloudfront.net/dist/images/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://*.cloudfront.net/dist/fonts/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://*.cloudfront.net/dist/css/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://*.cloudfront.net/dist/js/*");

        // Canvas authentication and API
        addUrlFilterRule(doc, urlFilterRules, true, "https://sso.canvaslms.com/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://canvas.instructure.com/api/*");

        // Canvas media and content delivery
        addUrlFilterRule(doc, urlFilterRules, true, "https://media.instructuremedia.com/*");
        addUrlFilterRule(doc, urlFilterRules, true, "https://*.instructuremedia.com/*");
    }

    /**
     * Adds structured domain configuration based on the new domain categories.
     */
    private void addStructuredDomains(Document doc, Element urlFilterRules, QuizSebSetting sebSetting, Map<String, Object> customSettings) {
        // Add SSO domains from sebSetting
        if (sebSetting != null && sebSetting.getSsoDomains() != null) {
            for (String domain : sebSetting.getSsoDomains()) {
                if (isValidSsoDomain(domain)) {
                    addUrlFilterRule(doc, urlFilterRules, true, "https://" + domain + "/*");
                } else {
                    log.warn("Skipping invalid SSO domain: {}", domain);
                }
            }
        }

        // Add educational tool domains from sebSetting
        if (sebSetting != null && sebSetting.getEducationalToolDomains() != null) {
            log.info("Adding {} educational tool domains to SEB configuration", sebSetting.getEducationalToolDomains().size());
            for (String domain : sebSetting.getEducationalToolDomains()) {
                if (isValidEducationalDomain(domain)) {
                    // Add both HTTPS and HTTP versions for compatibility, with wildcard paths
                    addUrlFilterRule(doc, urlFilterRules, true, "https://" + domain + "/*");
                    addUrlFilterRule(doc, urlFilterRules, true, "http://" + domain + "/*");
                    log.info("Added educational tool domain: {}", domain);
                } else {
                    log.warn("Skipping invalid educational domain: {}", domain);
                }
            }
        } else {
            log.info("No educational tool domains configured for this quiz");
        }

        // Add custom domains from sebSetting
        if (sebSetting != null && sebSetting.getCustomDomains() != null) {
            for (String domain : sebSetting.getCustomDomains()) {
                if (isValidCustomDomain(domain)) {
                    addUrlFilterRule(doc, urlFilterRules, true, domain);
                } else {
                    log.warn("Skipping invalid custom domain: {}", domain);
                }
            }
        }

        // Legacy support: Add domains from customSettings if sebSetting domains are empty
        if (customSettings != null) {
            // Add SSO domains from customSettings
            if (customSettings.containsKey("ssoDomains")) {
                @SuppressWarnings("unchecked")
                List<String> ssoDomains = (List<String>) customSettings.get("ssoDomains");
                for (String domain : ssoDomains) {
                    if (isValidSsoDomain(domain)) {
                        addUrlFilterRule(doc, urlFilterRules, true, "https://" + domain + "/*");
                    } else {
                        log.warn("Skipping invalid SSO domain: {}", domain);
                    }
                }
            }

            // Add educational tool domains from customSettings
            if (customSettings.containsKey("educationalToolDomains")) {
                @SuppressWarnings("unchecked")
                List<String> eduDomains = (List<String>) customSettings.get("educationalToolDomains");
                for (String domain : eduDomains) {
                    if (isValidEducationalDomain(domain)) {
                        // Add both HTTPS and HTTP versions for compatibility, with wildcard paths
                        addUrlFilterRule(doc, urlFilterRules, true, "https://" + domain + "/*");
                        addUrlFilterRule(doc, urlFilterRules, true, "http://" + domain + "/*");
                    } else {
                        log.warn("Skipping invalid educational domain: {}", domain);
                    }
                }
            }

            // Add custom domains from customSettings
            if (customSettings.containsKey("customDomains")) {
                @SuppressWarnings("unchecked")
                List<String> customDomains = (List<String>) customSettings.get("customDomains");
                for (String domain : customDomains) {
                    if (isValidCustomDomain(domain)) {
                        addUrlFilterRule(doc, urlFilterRules, true, domain);
                    } else {
                        log.warn("Skipping invalid custom domain: {}", domain);
                    }
                }
            }
        }
    }

    /**
     * Validates URL patterns to ensure they are not overly broad or dangerous.
     */
    private boolean isValidUrlPattern(String url) {
        if (url == null || url.trim().isEmpty()) {
            return false;
        }

        // Remove whitespace
        url = url.trim();

        // Must start with https://
        if (!url.startsWith("https://")) {
            return false;
        }

        // Should not be overly broad patterns
        String[] dangerousPatterns = {"*", "https://*", "https://*/*", "*.com/*", "*.org/*", "*.edu/*"};
        for (String pattern : dangerousPatterns) {
            if (url.equals(pattern)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Validates SSO domains to ensure they are specific authentication endpoints.
     */
    private boolean isValidSsoDomain(String domain) {
        if (domain == null || domain.trim().isEmpty()) {
            return false;
        }

        domain = domain.trim().toLowerCase();

        // List of known valid SSO domain patterns
        String[] validSsoPatterns = {
            "accounts.google.com",
            "login.microsoftonline.com",
            "login.live.com",
            "auth.okta.com",
            "*.okta.com",
            "*.oktapreview.com",
            "sso.*.edu",
            "login.*.edu"
        };

        for (String pattern : validSsoPatterns) {
            if (domain.equals(pattern) || (pattern.contains("*") && domain.matches(pattern.replace("*", ".*")))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Validates educational tool domains.
     */
    private boolean isValidEducationalDomain(String domain) {
        if (domain == null || domain.trim().isEmpty()) {
            return false;
        }

        domain = domain.trim().toLowerCase();

        // List of known educational tool domains
        String[] validEduDomains = {
            "www.desmos.com/calculator",
            "teacher.desmos.com",
            "www.khanacademy.org",
            "www.geogebra.org",
            "www.wolframalpha.com",
            "calculator.net",
            "www.calculator.net",
            "translate.google.com",
            "docs.google.com"
        };

        for (String validDomain : validEduDomains) {
            if (domain.equals(validDomain)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Validates custom domains to ensure they are not overly broad.
     */
    private boolean isValidCustomDomain(String domain) {
        if (domain == null || domain.trim().isEmpty()) {
            return false;
        }

        domain = domain.trim();

        // Must be a specific domain pattern
        if (!domain.startsWith("https://")) {
            return false;
        }

        // Should not be overly broad
        return isValidUrlPattern(domain);
    }
}
