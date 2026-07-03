package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

/**
 * Service for generating Safe Exam Browser (SEB) configuration files.
 *
 * This service creates comprehensive SEB configuration files that:
 * - Work on both Mac and Windows (cross-platform compatible)
 * - Completely lock down the computer during exam sessions
 * - Implement all necessary security measures for academic integrity
 * - Automatically provide quiz access codes to Canvas
 * - Configure allowed websites and browser restrictions
 * - Generate proper Browser Exam Keys for Canvas integration
 *
 * Based on SEB Configuration Specification v15 and official documentation.
 * Platform-specific settings are included for both Mac and Windows in the same file.
 * Each platform ignores settings it doesn't support.
 */
@Slf4j
@Service
public class SebConfigurationService {

    @Value("${app.canvas.base-url:}")
    private String canvasBaseUrl;

    @Value("${app.seb.quit-password:${SEB_QUIT_PASSWORD:}}")
    private String quitPassword;

    @Value("${app.base-url:}")
    private String configuredBaseUrl;

    @Value("${app.seb.required-url-filter-domains:}")
    private String requiredUrlFilterDomains;

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

    private String getCanvasDomain() {
        if (canvasBaseUrl != null && !canvasBaseUrl.isBlank()) {
            return canvasBaseUrl.replaceFirst("^https?://", "").replaceAll("/+$", "");
        }

        try {
            String domain = canvasApiConfig.getCanvasDomain();
            if (domain != null && !domain.isBlank()) {
                return domain.replaceFirst("^https?://", "").replaceAll("/+$", "");
            }
        } catch (Exception e) {
            log.warn("Could not get Canvas domain from config: {}", e.getMessage());
        }

        throw new IllegalStateException("Canvas domain is not configured");
    }

    /**
     * Generates a comprehensive SEB configuration file for a specific quiz.
     * 
     * @param courseId The Canvas course ID
     * @param quizId The Canvas quiz ID
     * @param quizUrl The direct URL to the quiz
     * @param accessCode The quiz access code (if any)
     * @return Byte array containing the SEB configuration XML
     */
    public byte[] generateSebConfiguration(String courseId, String quizId, String quizUrl, String accessCode) {
        return generateSebConfiguration(courseId, quizId, quizUrl, accessCode, List.of(), null);
    }

    public byte[] generateSebConfiguration(String courseId,
                                           String quizId,
                                           String quizUrl,
                                           String accessCode,
                                           List<String> additionalAllowedDomains) {
        return generateSebConfiguration(courseId, quizId, quizUrl, accessCode, additionalAllowedDomains, null);
    }

    public byte[] generateSebConfiguration(String courseId,
                                           String quizId,
                                           String quizUrl,
                                           String accessCode,
                                           List<String> additionalAllowedDomains,
                                           String quizQuitPassword) {
        try {
            String effectiveQuitPassword = resolveQuitPassword(quizQuitPassword);
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.newDocument();

            // Root element - SEB configuration plist
            Element plist = doc.createElement("plist");
            plist.setAttribute("version", "1.0");
            doc.appendChild(plist);

            Element dict = doc.createElement("dict");
            plist.appendChild(dict);

            // === BASIC CONFIGURATION ===
            addKeyValue(doc, dict, "sebConfigPurpose", "integer", "0"); // Starting exam
            addKeyValue(doc, dict, "originatorVersion", "string", "3.7.0");
            addKeyValue(doc, dict, "sebServerURL", "string", "");
            
            // === SECURITY SETTINGS - MAXIMUM LOCKDOWN (CROSS-PLATFORM) ===

            // Browser and Application Control (Universal)
            addKeyValue(doc, dict, "allowQuit", effectiveQuitPassword.isBlank() ? "false" : "true", null); // Manual quit only when password-protected
            addKeyValue(doc, dict, "ignoreExitKeys", "true", null); // Ignore exit key combinations
            addKeyValue(doc, dict, "allowSwitchToApplications", "false", null); // Block app switching
            addKeyValue(doc, dict, "enableEsc", "false", null); // Disable Escape key
            addKeyValue(doc, dict, "enableF1", "false", null); // Disable F1 (Help)
            addKeyValue(doc, dict, "enableF2", "false", null); // Disable F2
            addKeyValue(doc, dict, "enableF3", "false", null); // Disable F3 (Search)
            addKeyValue(doc, dict, "enableF4", "false", null); // Disable F4
            addKeyValue(doc, dict, "enableF5", "false", null); // Disable F5 (Refresh)
            addKeyValue(doc, dict, "enableF6", "false", null); // Disable F6
            addKeyValue(doc, dict, "enableF7", "false", null); // Disable F7
            addKeyValue(doc, dict, "enableF8", "false", null); // Disable F8
            addKeyValue(doc, dict, "enableF9", "false", null); // Disable F9
            addKeyValue(doc, dict, "enableF10", "false", null); // Disable F10
            addKeyValue(doc, dict, "enableF11", "false", null); // Disable F11 (Fullscreen)
            addKeyValue(doc, dict, "enableF12", "false", null); // Disable F12 (Dev Tools)

            // Windows-Specific Settings (ignored on Mac)
            addKeyValue(doc, dict, "enableAltTab", "false", null); // Disable Alt+Tab
            addKeyValue(doc, dict, "enableAltEsc", "false", null); // Disable Alt+Esc
            addKeyValue(doc, dict, "enableAltF4", "false", null); // Disable Alt+F4
            addKeyValue(doc, dict, "enableCtrlAltDel", "false", null); // Disable Ctrl+Alt+Del
            addKeyValue(doc, dict, "killExplorerShell", "true", null); // Kill Windows Explorer
            addKeyValue(doc, dict, "allowWindowsUpdate", "false", null); // Block Windows Update
            addKeyValue(doc, dict, "enableRightMouse", "false", null); // Block right-click on Windows

            // Mac-Specific Settings (ignored on Windows)
            addKeyValue(doc, dict, "enableCmdTab", "false", null); // Disable Cmd+Tab on Mac
            addKeyValue(doc, dict, "enableCmdQ", effectiveQuitPassword.isBlank() ? "false" : "true", null); // Allow emergency quit shortcut only with password
            addKeyValue(doc, dict, "enableCmdW", "false", null); // Disable Cmd+W on Mac
            addKeyValue(doc, dict, "enableCmdM", "false", null); // Disable Cmd+M (minimize) on Mac
            addKeyValue(doc, dict, "enableCmdH", "false", null); // Disable Cmd+H (hide) on Mac
            addKeyValue(doc, dict, "enableCmdOption", "false", null); // Disable Cmd+Option combinations
            addKeyValue(doc, dict, "enableCmdSpace", "false", null); // Disable Cmd+Space (Spotlight)
            addKeyValue(doc, dict, "allowMacOSNotifications", "false", null); // Block macOS notifications
            addKeyValue(doc, dict, "allowMacOSMissionControl", "false", null); // Block Mission Control
            addKeyValue(doc, dict, "allowMacOSExpose", "false", null); // Block Exposé
            addKeyValue(doc, dict, "allowMacOSDashboard", "false", null); // Block Dashboard
            addKeyValue(doc, dict, "allowMacOSSpaces", "false", null); // Block Spaces

            // Cross-Platform System Integration
            addKeyValue(doc, dict, "allowVirtualMachine", "false", null); // Block VMs
            addKeyValue(doc, dict, "detectVirtualMachine", "true", null); // Detect VMs
            addKeyValue(doc, dict, "allowScreenSharing", "false", null); // Block screen sharing
            addKeyValue(doc, dict, "allowApplicationLog", "false", null); // Disable app logging
            
            // Display and Window Control
            addKeyValue(doc, dict, "allowedDisplaysMaxNumber", "integer", "1"); // Single display only
            addKeyValue(doc, dict, "allowDisplayMirroring", "false", null); // No display mirroring
            addKeyValue(doc, dict, "allowedDisplayBuiltin", "true", null); // Allow built-in display
            addKeyValue(doc, dict, "allowedDisplayExternal", "false", null); // Block external displays
            addKeyValue(doc, dict, "enableTouchExit", "false", null); // Disable touch exit
            addKeyValue(doc, dict, "touchOptimized", "false", null); // Not touch optimized

            // === BROWSER CONFIGURATION ===

            // Start URL - Use direct quiz URL (Canvas will redirect to SSO if needed)
            log.info("Setting SEB startURL to quiz URL: {}", quizUrl);
            addKeyValue(doc, dict, "startURL", "string", quizUrl);
            addKeyValue(doc, dict, "sendBrowserExamKey", "false", null); // WKWebView exposes keys via SEB JavaScript API, not HTTP headers
            addKeyValue(doc, dict, "browserExamKey", "string", generateBrowserExamKey(courseId, quizId, accessCode));

            // Browser Security (allow reload to fix blank page issues)
            addKeyValue(doc, dict, "allowBrowsingBackForward", "false", null); // No back/forward
            addKeyValue(doc, dict, "allowReload", "true", null); // Allow page reload (fixes blank pages)
            addKeyValue(doc, dict, "showReloadButton", "true", null); // Show reload button
            addKeyValue(doc, dict, "browserWindowAllowReload", "true", null); // Allow window reload
            addKeyValue(doc, dict, "newBrowserWindowAllowReload", "true", null); // Allow new window reload
            addKeyValue(doc, dict, "allowDownUploads", "false", null); // Block downloads
            addKeyValue(doc, dict, "downloadDirectoryOSX", "string", ""); // No download directory
            addKeyValue(doc, dict, "downloadDirectoryWin", "string", ""); // No download directory
            addKeyValue(doc, dict, "allowPDFPlugIn", "false", null); // Block PDF plugin
            addKeyValue(doc, dict, "allowFlashFullscreen", "false", null); // Block Flash fullscreen
            addKeyValue(doc, dict, "allowVideoFullscreen", "false", null); // Block video fullscreen

            // Developer Tools and Debugging
            addKeyValue(doc, dict, "allowDeveloperConsole", "false", null); // Block dev console
            addKeyValue(doc, dict, "enableJavaScript", "true", null); // Allow JS (needed for Canvas)
            addKeyValue(doc, dict, "enableJava", "false", null); // Block Java
            addKeyValue(doc, dict, "enablePlugIns", "false", null); // Block plugins
            addKeyValue(doc, dict, "allowPrint", "false", null); // Block printing
            addKeyValue(doc, dict, "allowRightMouse", "false", null); // Block right-click

            // Content and Storage Settings (fix blank page issues)
            addKeyValue(doc, dict, "removeBrowserProfile", "false", null); // Keep browser profile
            addKeyValue(doc, dict, "removeLocalStorage", "false", null); // Keep local storage
            addKeyValue(doc, dict, "browserURLSalt", "false", null); // Disable URL salt
            addKeyValue(doc, dict, "blockPopUpWindows", "false", null); // Allow popups (Canvas may need)
            addKeyValue(doc, dict, "allowSpellCheck", "true", null); // Allow spell check
            addKeyValue(doc, dict, "allowDictionaryLookup", "false", null); // Block dictionary lookup

            // Additional page loading settings
            addKeyValue(doc, dict, "restartExamPasswordProtected", "false", null); // No restart password
            addKeyValue(doc, dict, "restartExamText", "string", ""); // No restart text

            // Set proper quit URLs for SEB exit functionality
            String baseUrl = getBaseUrl();
            String quitPathId = quitPathId(quizId);
            String quitUrl = String.format("%s/seb/exit/quit/%s/%s", baseUrl, courseId, quitPathId);

            addKeyValue(doc, dict, "restartExamURL", "string", quizUrl); // Restart/back should return to the assessment, not the SEB exit page
            addKeyValue(doc, dict, "quitURL", "string", quitUrl); // Dedicated quit link students click from the summary page
            addKeyValue(doc, dict, "quitURLConfirm", "false", null); // Quit immediately when the SEB quit URL is detected
            addKeyValue(doc, dict, "startResource", "string", ""); // No start resource
            addKeyValue(doc, dict, "additionalResources", "array", null); // No additional resources

            // Browser session settings
            addKeyValue(doc, dict, "browserSessionPolicy", "integer", "1"); // Separate session
            addKeyValue(doc, dict, "browserUserAgentWinDesktopMode", "integer", "0"); // Standard mode
            addKeyValue(doc, dict, "browserUserAgentWinTouchMode", "integer", "0"); // Standard mode

            // === NETWORK AND URL FILTERING ===

            // URL Filter - Only allow Canvas and essential domains
            // ENABLED for production security - blocks access to unauthorized sites
            addKeyValue(doc, dict, "URLFilterEnable", "true", null);
            log.info("URL filtering ENABLED - only authorized domains allowed");
            Element urlFilterRules = addKeyValue(doc, dict, "URLFilterRules", "array", null);
            String canvasDomain = getCanvasDomain();
            String insecureBaseUrl = baseUrl.startsWith("https://")
                    ? "http://" + baseUrl.substring("https://".length())
                    : baseUrl;
            
            // Canvas application and native New Quizzes rendering.
            addUrlFilterRule(doc, urlFilterRules, true, "https://" + canvasDomain + "/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.canvaslms.com/*");

            // Canvas-owned media, uploads, and APIs. Avoid broad shared-cloud/CDN allowlists.
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.instructuremedia.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://media.instructuremedia.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-media.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://api.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-api.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-rce-api.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-rce.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-files-prod.s3.amazonaws.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-network.s3.amazonaws.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-static.s3.amazonaws.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-user-content.s3.amazonaws.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://instructure-uploads.s3.amazonaws.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://instructure-uploads-prod.s3.amazonaws.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.canvas-user-content.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.inscloudgate.net/*");

            for (String requiredDomain : getRequiredUrlFilterDomains()) {
                addConfiguredAllowedDomain(doc, urlFilterRules, requiredDomain);
            }

            // Legacy New Quizzes LTI hosts remain for schools not yet fully native.
            addUrlFilterRule(doc, urlFilterRules, true, "https://quiz-lti.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://quiz-api.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://quiz-lti-iad-prod.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://quiz-lti-pdx-prod.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://quiz-lti-dub-prod.instructure.com/*");

            List<String> configuredAllowedDomains = additionalAllowedDomains != null ? additionalAllowedDomains : List.of();
            for (String allowedDomain : configuredAllowedDomains) {
                addConfiguredAllowedDomain(doc, urlFilterRules, allowedDomain);
            }

            // SEB-Canvas LTI Application (our own service)
            addUrlFilterRule(doc, urlFilterRules, true, baseUrl + "/*");
            addUrlFilterRule(doc, urlFilterRules, true, insecureBaseUrl + "/*");

            // Allow HTTP versions of essential domains (for redirects and mixed content)
            addUrlFilterRule(doc, urlFilterRules, true, "http://" + canvasDomain + "/*"); // HTTP Canvas
            addUrlFilterRule(doc, urlFilterRules, true, "http://*.instructure.com/*"); // HTTP Instructure

            // Note: No "block all" rule needed - SEB automatically blocks anything not explicitly allowed when URL filtering is enabled

            // === QUIZ ACCESS CONFIGURATION ===

            // Configure session management (modified for SSO compatibility)
            addKeyValue(doc, dict, "examSessionClearCookiesOnStart", "false", null); // Don't clear cookies to preserve SSO session
            addKeyValue(doc, dict, "examSessionClearCookiesOnEnd", "true", null); // Clear cookies at end for security

            if (!effectiveQuitPassword.isBlank()) {
                addKeyValue(doc, dict, "hashedQuitPassword", "string", hashPassword(effectiveQuitPassword));
                addKeyValue(doc, dict, "ignoreQuitPassword", "false", null);
            }

            // === ADDITIONAL SECURITY MEASURES ===
            
            // Audio/Video Control
            addKeyValue(doc, dict, "audioControlEnabled", "true", null); // Enable audio control
            addKeyValue(doc, dict, "audioMute", "false", null); // Don't mute (may need audio for quiz)
            addKeyValue(doc, dict, "allowAudioCapture", "false", null); // Block audio capture
            addKeyValue(doc, dict, "allowVideoCapture", "false", null); // Block video capture

            // Clipboard and Text
            addKeyValue(doc, dict, "allowPasteFromClipboard", "false", null); // Block paste
            addKeyValue(doc, dict, "allowCopyFromClipboard", "false", null); // Block copy
            addKeyValue(doc, dict, "allowFind", "false", null); // Block Ctrl+F search
            addKeyValue(doc, dict, "allowSpellCheck", "false", null); // Block spell check
            addKeyValue(doc, dict, "allowSpellCheckDictionary", "false", null); // Block spell check dictionary

            // Zoom and Accessibility
            addKeyValue(doc, dict, "allowZoomText", "false", null); // Block text zoom
            addKeyValue(doc, dict, "allowZoomPage", "false", null); // Block page zoom
            addKeyValue(doc, dict, "zoomMode", "integer", "0"); // No zoom mode

            // === MONITORING AND LOGGING ===
            
            addKeyValue(doc, dict, "allowApplicationLog", "false", null); // Disable application logging
            addKeyValue(doc, dict, "logLevel", "integer", "0"); // Minimal logging
            addKeyValue(doc, dict, "enableLogging", "false", null); // Disable detailed logging

            // === EXAM INTEGRITY FEATURES ===
            
            // Browser Exam Key for Canvas integration
            addKeyValue(doc, dict, "browserUserAgent", "string",
                "SEB/3.7 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36");

            // Browser Window Settings (fix blank page and WebView issues)
            addKeyValue(doc, dict, "browserWindowShowURL", "false", null); // Hide URL bar
            addKeyValue(doc, dict, "browserWindowShowToolBar", "false", null); // Hide toolbar
            addKeyValue(doc, dict, "browserWindowShowMenuBar", "false", null); // Hide menu bar
            addKeyValue(doc, dict, "browserWindowShowStatusBar", "false", null); // Hide status bar
            addKeyValue(doc, dict, "browserWindowTitleSuffix", "string", ""); // No title suffix
            addKeyValue(doc, dict, "mainBrowserWindowWidth", "string", "100%"); // Full width
            addKeyValue(doc, dict, "mainBrowserWindowHeight", "string", "100%"); // Full height
            addKeyValue(doc, dict, "mainBrowserWindowPositioning", "integer", "1"); // Center window
            addKeyValue(doc, dict, "enableBrowserWindowToolbar", "false", null); // Disable toolbar
            addKeyValue(doc, dict, "hideBrowserWindowToolbar", "true", null); // Hide toolbar

            // Modern WebView Configuration (fix classic WebView deprecation)
            addKeyValue(doc, dict, "browserWindowWebView", "integer", "3"); // Force Modern WKWebView
            addKeyValue(doc, dict, "browserWindowWebViewClassicHideDeprecationNote", "false", null);
            addKeyValue(doc, dict, "newBrowserWindowByLinkBlockForeign", "true", null); // Block foreign links
            addKeyValue(doc, dict, "newBrowserWindowByScriptBlockForeign", "true", null); // Block foreign scripts
            addKeyValue(doc, dict, "browserWindowAllowAddressBar", "false", null); // Hide address bar
            addKeyValue(doc, dict, "browserWindowAllowNavigationBar", "false", null); // Hide navigation
            addKeyValue(doc, dict, "browserWindowAllowDeveloperConsole", "false", null); // Block dev console

            // Canvas-specific settings for access code integration
            if (accessCode != null && !accessCode.trim().isEmpty()) {
                // Note: Access code is embedded in the Browser Exam Key for Canvas integration
                // Browser engine settings should handle WebView properly
            }

            // Convert to XML string
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

        } catch (Exception e) {
            throw new RuntimeException("Failed to generate SEB configuration", e);
        }
    }

    /**
     * Adds a key-value pair to the SEB configuration dictionary.
     */
    private Element addKeyValue(Document doc, Element dict, String key, String type, String value) {
        Element keyElement = doc.createElement("key");
        keyElement.setTextContent(key);
        dict.appendChild(keyElement);

        Element valueElement;
        if ("true".equals(type) || "false".equals(type)) {
            valueElement = doc.createElement(type);
        } else if ("array".equals(type)) {
            valueElement = doc.createElement("array");
        } else if ("integer".equals(type)) {
            valueElement = doc.createElement("integer");
            valueElement.setTextContent(value);
        } else {
            valueElement = doc.createElement("string");
            valueElement.setTextContent(value != null ? value : "");
        }
        
        dict.appendChild(valueElement);
        return valueElement;
    }

    /**
     * Adds a URL filter rule to the configuration.
     */
    private void addUrlFilterRule(Document doc, Element urlFilterRules, boolean allow, String pattern) {
        Element ruleDict = doc.createElement("dict");
        urlFilterRules.appendChild(ruleDict);

        addKeyValue(doc, ruleDict, "action", "integer", allow ? "1" : "0");
        addKeyValue(doc, ruleDict, "active", "true", null);
        addKeyValue(doc, ruleDict, "regex", "false", null);
        addKeyValue(doc, ruleDict, "expression", "string", pattern);
    }

    private void addConfiguredAllowedDomain(Document doc, Element urlFilterRules, String domainOrPattern) {
        if (domainOrPattern == null || domainOrPattern.isBlank()) {
            return;
        }

        String normalized = domainOrPattern.trim();
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            normalized = "https://" + normalized;
        }
        if (!normalized.endsWith("/*")) {
            normalized = normalized.endsWith("/") ? normalized + "*" : normalized + "/*";
        }

        if (isUnsafeAllowPattern(normalized)) {
            log.warn("Skipping overly broad SEB URL allowlist entry: {}", domainOrPattern);
            return;
        }

        addUrlFilterRule(doc, urlFilterRules, true, normalized);
    }

    private List<String> getRequiredUrlFilterDomains() {
        if (requiredUrlFilterDomains == null || requiredUrlFilterDomains.isBlank()) {
            return List.of();
        }

        return Arrays.stream(requiredUrlFilterDomains.split("[,\\n]"))
                .map(String::trim)
                .filter(domain -> !domain.isBlank())
                .toList();
    }

    private boolean isUnsafeAllowPattern(String pattern) {
        String lower = pattern.toLowerCase();
        return lower.equals("https://*/*")
                || lower.equals("http://*/*")
                || lower.equals("https://*.amazonaws.com/*")
                || lower.equals("https://*.s3.amazonaws.com/*")
                || lower.equals("https://*.com/*")
                || lower.equals("https://*.org/*")
                || lower.equals("https://*.edu/*");
    }

    /**
     * Generates a browser exam key for Canvas integration.
     */
    private String generateBrowserExamKey(String courseId, String quizId, String accessCode) {
        return sha256Base64("SEB_BROWSER_EXAM_KEY|" + courseId + "|" + quizId + "|" + nullToEmpty(accessCode));
    }

    private String resolveQuitPassword(String quizQuitPassword) {
        if (quizQuitPassword != null && !quizQuitPassword.isBlank()) {
            return quizQuitPassword.trim();
        }
        if (quitPassword != null && !quitPassword.isBlank()) {
            return quitPassword.trim();
        }
        return "";
    }

    private String quitPathId(String quizId) {
        if (quizId != null && quizId.startsWith("classicquiz_")) {
            return quizId.substring("classicquiz_".length());
        }
        return quizId;
    }

    /**
     * Hashes a password for SEB quit password functionality.
     */
    private String hashPassword(String password) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(password.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private String sha256Base64(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new IllegalStateException("Unable to compute SHA-256 hash", e);
        }
    }

    private String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
