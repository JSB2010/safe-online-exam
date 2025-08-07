package org.kentdenver.sebcanvas.service;

import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Service for generating Safe Exam Browser (SEB) configuration files.
 * 
 * SEB config files are XML files in Apple plist format that configure
 * the browser environment for secure exam taking.
 */
@Service
public class SebConfigService {

    private static final Logger log = LoggerFactory.getLogger(SebConfigService.class);

    @Autowired
    private QuizService quizService;

    /**
     * Generates a SEB configuration file for a specific quiz.
     * 
     * @param courseId Canvas course ID
     * @param quizId Canvas quiz ID
     * @param canvasUrl Original Canvas quiz URL
     * @param userId Canvas user ID
     * @return SEB configuration file as byte array
     */
    public byte[] generateSebConfig(String courseId, String quizId, String canvasUrl, String userId) {
        log.info("Generating SEB config for quiz {} in course {}", quizId, courseId);

        try {
            // Get or create SEB settings for this quiz (handle fallback mode gracefully)
            QuizSebSetting sebSetting = null;
            try {
                sebSetting = quizService.getSebSettingForQuiz(quizId);
                if (sebSetting == null) {
                    sebSetting = createDefaultSebSetting(quizId);
                }
            } catch (Exception e) {
                log.warn("Could not retrieve SEB settings for quiz {} (fallback mode), using defaults: {}", quizId, e.getMessage());
                sebSetting = createDefaultSebSetting(quizId);
            }

            // Decode Canvas URL
            String startUrl = canvasUrl;
            if (startUrl != null) {
                startUrl = URLDecoder.decode(startUrl, StandardCharsets.UTF_8);
            } else {
                startUrl = String.format("https://kentdenver.instructure.com/courses/%s/quizzes/%s", courseId, quizId);
            }

            // Generate SEB configuration
            Map<String, Object> sebConfig = createSebConfiguration(startUrl, courseId, quizId, sebSetting);

            // Convert to XML plist format
            String xmlConfig = convertToXmlPlist(sebConfig);

            // Generate Browser Exam Key
            String browserExamKey = generateBrowserExamKey(xmlConfig);

            // Try to update browser exam key, but don't fail if it doesn't work (fallback mode)
            try {
                quizService.updateBrowserExamKey(quizId, browserExamKey);
                log.info("Generated SEB config with Browser Exam Key: {}", browserExamKey.substring(0, 8) + "...");
            } catch (Exception e) {
                log.warn("Could not update browser exam key for quiz {} (fallback mode): {}", quizId, e.getMessage());
                log.info("Generated SEB config with Browser Exam Key (not stored): {}", browserExamKey.substring(0, 8) + "...");
            }

            return xmlConfig.getBytes(StandardCharsets.UTF_8);

        } catch (Exception e) {
            log.error("Error generating SEB config: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to generate SEB configuration", e);
        }
    }

    /**
     * Creates the SEB configuration map with all necessary settings.
     */
    private Map<String, Object> createSebConfiguration(String startUrl, String courseId, String quizId, QuizSebSetting sebSetting) {
        Map<String, Object> config = new HashMap<>();

        // Basic SEB settings
        config.put("startURL", startUrl);
        config.put("sendBrowserExamKey", true);
        config.put("examKeySalt", generateSalt());
        
        // Browser settings
        config.put("allowBrowsingBackForward", false);
        config.put("allowReloading", true);
        config.put("showReloadButton", true);
        config.put("allowDisplaySettingsMenu", false);
        config.put("allowPreferencesMenu", false);
        
        // Security settings
        config.put("enableSebBrowser", true);
        config.put("browserMessagingSocket", "ws://localhost:8706");
        config.put("browserMessagingPingTime", 120000);
        
        // URL filtering - only allow Canvas domain
        config.put("URLFilterEnable", true);
        config.put("URLFilterEnableContentFilter", false);
        
        // Allow Canvas domain and our SEB enforcement service
        Map<String, Object> urlFilter = new HashMap<>();
        urlFilter.put("URLFilterRuleAction", 1); // Allow
        urlFilter.put("URLFilterRuleExpression", "kentdenver.instructure.com");
        urlFilter.put("URLFilterRuleRegex", false);
        config.put("URLFilterRules", new Object[]{urlFilter});

        // Add our SEB enforcement domain
        Map<String, Object> sebServiceFilter = new HashMap<>();
        sebServiceFilter.put("URLFilterRuleAction", 1); // Allow
        sebServiceFilter.put("URLFilterRuleExpression", "canvas-seb-dev-184075650720.us-central1.run.app");
        sebServiceFilter.put("URLFilterRuleRegex", false);
        
        // Quit settings
        String quitUrl = startUrl.contains("?") ? startUrl + "&seb_quit=true" : startUrl + "?seb_quit=true";
        config.put("quitURL", quitUrl);
        config.put("quitURLConfirm", false);
        
        // Exam settings
        config.put("hashedQuitPassword", generateHashedPassword("quit123")); // Default quit password
        config.put("allowQuit", true);
        config.put("ignoreExitKeys", true);
        
        // Disable potentially dangerous features
        config.put("allowSpellCheck", false);
        config.put("allowDictionaryLookup", false);
        config.put("allowPDFPlugIn", false);
        config.put("allowFlashFullscreen", false);
        
        // Touch and gesture settings (for tablets)
        config.put("touchOptimized", false);
        config.put("enableTouchExit", false);
        
        // Logging
        config.put("enableLogging", true);
        config.put("logLevel", 1); // Info level
        
        log.debug("Created SEB configuration with {} settings", config.size());
        return config;
    }

    /**
     * Converts the configuration map to XML plist format.
     * SEB uses Apple's plist (property list) format.
     */
    private String convertToXmlPlist(Map<String, Object> config) {
        StringBuilder xml = new StringBuilder();
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n");
        xml.append("<plist version=\"1.0\">\n");
        xml.append("<dict>\n");

        for (Map.Entry<String, Object> entry : config.entrySet()) {
            xml.append("    <key>").append(entry.getKey()).append("</key>\n");
            appendValue(xml, entry.getValue(), "    ");
        }

        xml.append("</dict>\n");
        xml.append("</plist>\n");

        return xml.toString();
    }

    /**
     * Appends a value to the XML with proper type handling.
     */
    private void appendValue(StringBuilder xml, Object value, String indent) {
        if (value instanceof String) {
            xml.append(indent).append("<string>").append(escapeXml((String) value)).append("</string>\n");
        } else if (value instanceof Boolean) {
            xml.append(indent).append((Boolean) value ? "<true/>" : "<false/>").append("\n");
        } else if (value instanceof Integer) {
            xml.append(indent).append("<integer>").append(value).append("</integer>\n");
        } else if (value instanceof Object[]) {
            xml.append(indent).append("<array>\n");
            for (Object item : (Object[]) value) {
                appendValue(xml, item, indent + "    ");
            }
            xml.append(indent).append("</array>\n");
        } else if (value instanceof Map) {
            xml.append(indent).append("<dict>\n");
            @SuppressWarnings("unchecked")
            Map<String, Object> dict = (Map<String, Object>) value;
            for (Map.Entry<String, Object> entry : dict.entrySet()) {
                xml.append(indent).append("    <key>").append(entry.getKey()).append("</key>\n");
                appendValue(xml, entry.getValue(), indent + "    ");
            }
            xml.append(indent).append("</dict>\n");
        } else {
            xml.append(indent).append("<string>").append(escapeXml(value.toString())).append("</string>\n");
        }
    }

    /**
     * Escapes XML special characters.
     */
    private String escapeXml(String text) {
        return text.replace("&", "&amp;")
                  .replace("<", "&lt;")
                  .replace(">", "&gt;")
                  .replace("\"", "&quot;")
                  .replace("'", "&apos;");
    }

    /**
     * Generates a Browser Exam Key hash for the configuration.
     * This is used by SEB to verify the configuration integrity.
     */
    private String generateBrowserExamKey(String configXml) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(configXml.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            log.error("Error generating Browser Exam Key: {}", e.getMessage());
            return generateSalt(); // Fallback to random salt
        }
    }

    /**
     * Generates a random salt for exam key generation.
     */
    private String generateSalt() {
        SecureRandom random = new SecureRandom();
        byte[] salt = new byte[32];
        random.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }

    /**
     * Generates a hashed password for SEB quit functionality.
     */
    private String generateHashedPassword(String password) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(password.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            log.error("Error generating hashed password: {}", e.getMessage());
            return "";
        }
    }

    /**
     * Creates default SEB settings for a quiz.
     */
    private QuizSebSetting createDefaultSebSetting(String quizId) {
        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId(quizId);
        setting.setSebRequired(true);
        setting.setBrowserExamKey(""); // Will be generated
        return setting;
    }
}
