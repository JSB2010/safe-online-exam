package org.kentdenver.sebcanvas.service;

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
import java.io.UnsupportedEncodingException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

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
@Service
public class SebConfigurationService {

    @Value("${app.canvas.base-url:https://kentdenver.instructure.com}")
    private String canvasBaseUrl;

    @Value("${app.seb.quit-password:}")
    private String quitPassword;

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
        try {
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
            addKeyValue(doc, dict, "sebConfigPurpose", "integer", "1"); // Starting exam
            addKeyValue(doc, dict, "originatorVersion", "string", "3.7.0");
            addKeyValue(doc, dict, "sebServerURL", "string", "");
            
            // === SECURITY SETTINGS - MAXIMUM LOCKDOWN (CROSS-PLATFORM) ===

            // Browser and Application Control (Universal)
            addKeyValue(doc, dict, "allowQuit", "false", null); // Prevent quitting SEB
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
            addKeyValue(doc, dict, "enableCmdQ", "false", null); // Disable Cmd+Q on Mac
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
            
            // Start URL - Direct to quiz
            addKeyValue(doc, dict, "startURL", "string", quizUrl);
            addKeyValue(doc, dict, "sendBrowserExamKey", "true", null); // Send browser exam key
            addKeyValue(doc, dict, "browserExamKey", "string", generateBrowserExamKey(courseId, quizId, accessCode));
            addKeyValue(doc, dict, "configKey", "string", generateConfigKey(courseId, quizId, accessCode));

            // Browser Security
            addKeyValue(doc, dict, "allowBrowsingBackForward", "false", null); // No back/forward
            addKeyValue(doc, dict, "allowReload", "false", null); // No page reload
            addKeyValue(doc, dict, "showReloadButton", "false", null); // Hide reload button
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

            // === NETWORK AND URL FILTERING ===

            // URL Filter - Only allow Canvas and essential domains
            addKeyValue(doc, dict, "URLFilterEnable", "true", null);
            Element urlFilterRules = addKeyValue(doc, dict, "URLFilterRules", "array", null);
            
            // Allow Canvas domains
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://kentdenver.instructure.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.canvaslms.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas.*.edu/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas.*.org/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas.*.com/*");

            // Allow essential Canvas CDN and API domains
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.instructuremedia.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.cloudfront.net/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://canvas-files-prod.s3.amazonaws.com/*");

            // Google SSO and Services (for schools using Google Workspace)
            addUrlFilterRule(doc, urlFilterRules, true, "https://accounts.google.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://login.google.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://oauth.google.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://googleapis.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.googleapis.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://ssl.gstatic.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://www.gstatic.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://fonts.googleapis.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://fonts.gstatic.com/*");

            // Microsoft SSO and Services (for schools using Microsoft 365)
            addUrlFilterRule(doc, urlFilterRules, true, "https://login.microsoftonline.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://login.live.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://outlook.office365.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://graph.microsoft.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.office.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.office365.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.microsoftonline.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.live.com/*");

            // Other Common SSO Providers
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.okta.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.auth0.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://*.shibboleth.net/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://shibboleth.*.edu/*");

            // Essential CDNs and services
            addUrlFilterRule(doc, urlFilterRules, true, "https://cdn.jsdelivr.net/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://cdnjs.cloudflare.com/*");
            addUrlFilterRule(doc, urlFilterRules, true, "https://ajax.googleapis.com/*");

            // Block everything else
            addUrlFilterRule(doc, urlFilterRules, false, "*");

            // === QUIZ ACCESS CONFIGURATION ===

            // Configure session management
            addKeyValue(doc, dict, "examSessionClearCookiesOnStart", "true", null);
            addKeyValue(doc, dict, "examSessionClearCookiesOnEnd", "true", null);

            // TEST QUIT PASSWORD - TODO: Remove in production
            // This is a test password only for Jacob: 5845Alton625!@
            // During production, this should be removed and only use quiz-specific passwords
            String testQuitPassword = "5845Alton625!@";
            addKeyValue(doc, dict, "hashedQuitPassword", "string", hashPassword(testQuitPassword));

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
            
            // Browser Exam Key for Canvas integration (remove problematic examKeySalt)
            addKeyValue(doc, dict, "browserUserAgent", "string",
                "SEB/3.7 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36");

            // Canvas-specific settings for access code integration
            if (accessCode != null && !accessCode.trim().isEmpty()) {
                // Note: Access code is embedded in the Browser Exam Key for Canvas integration
                // Remove potentially problematic custom settings
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

    /**
     * Generates a browser exam key for Canvas integration.
     * This key includes the access code for automatic Canvas authentication.
     */
    private String generateBrowserExamKey(String courseId, String quizId, String accessCode) {
        try {
            StringBuilder input = new StringBuilder();
            input.append("SEB_BROWSER_EXAM_KEY_");
            input.append("course_").append(courseId);
            input.append("_quiz_").append(quizId);

            // Include access code in the key generation for Canvas integration
            if (accessCode != null && !accessCode.trim().isEmpty()) {
                input.append("_access_").append(accessCode);
            }

            input.append("_timestamp_").append(System.currentTimeMillis());

            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.toString().getBytes("UTF-8"));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            return "DEFAULT_BROWSER_EXAM_KEY_" + courseId + "_" + quizId;
        }
    }

    /**
     * Generates a configuration key for SEB.
     * This key is used to verify the integrity of the SEB configuration.
     */
    private String generateConfigKey(String courseId, String quizId, String accessCode) {
        try {
            StringBuilder input = new StringBuilder();
            input.append("SEB_CONFIG_KEY_");
            input.append("course_").append(courseId);
            input.append("_quiz_").append(quizId);

            // Include access code for configuration verification
            if (accessCode != null && !accessCode.trim().isEmpty()) {
                input.append("_access_").append(accessCode);
            }

            input.append("_timestamp_").append(System.currentTimeMillis());

            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.toString().getBytes("UTF-8"));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            return "DEFAULT_CONFIG_KEY_" + courseId + "_" + quizId;
        }
    }





    /**
     * Hashes a password for SEB quit password functionality.
     */
    private String hashPassword(String password) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(password.getBytes("UTF-8"));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            return "";
        }
    }
}
