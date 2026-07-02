package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.model.SebConfig;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.util.SebConfigGenerator;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Optional;
import java.util.UUID;
import java.util.Arrays;

/**
 * Service for SEB-related operations including detection, validation, and configuration generation.
 */
@Service
@Slf4j
public class SebService {

    // Service dependencies
    private final SebSettingRepository sebSettingRepository;
    private final SebConfigGenerator sebConfigGenerator;
    private final SebDetector sebDetector;

    /**
     * Constructor with dependency injection for all required services.
     */
    @Autowired
    public SebService(
            SebSettingRepository sebSettingRepository,
            SebConfigGenerator sebConfigGenerator,
            SebDetector sebDetector) {
        this.sebSettingRepository = sebSettingRepository;
        this.sebConfigGenerator = sebConfigGenerator;
        this.sebDetector = sebDetector;
    }

    /**
     * Check if the user is using SEB based on request headers.
     */
    public boolean isUsingSeb(HttpServletRequest request) {
        return sebDetector.isSebBrowser(request);
    }

    /**
     * Generate a SEB .seb file for a quiz.
     */
    public byte[] generateSebConfig(String quizId, String quizUrl) throws IOException, NoSuchAlgorithmException {
        log.debug("Generating SEB config for quiz ID: {}, URL: {}", quizId, quizUrl);

        // Check if there's an existing Browser Exam Key for this quiz
        String browserExamKey = null;
        Optional<QuizSebSetting> settingOpt = sebSettingRepository.findByQuizId(quizId);

        if (settingOpt.isPresent() && settingOpt.get().getBrowserExamKey() != null) {
            // Use existing Browser Exam Key if available
            browserExamKey = settingOpt.get().getBrowserExamKey();
            log.debug("Using existing Browser Exam Key for quiz: {}", quizId);
        } else {
            // Generate a new Browser Exam Key
            browserExamKey = generateBrowserExamKey();
            log.debug("Generated new Browser Exam Key for quiz: {}", quizId);

            // Save the new key if we have a setting
            if (settingOpt.isPresent()) {
                QuizSebSetting setting = settingOpt.get();
                setting.setBrowserExamKey(browserExamKey);
                sebSettingRepository.save(setting);
                log.debug("Updated existing SEB setting with new Browser Exam Key for quiz: {}", quizId);
            } else {
                // Create a new setting record with the Browser Exam Key
                QuizSebSetting newSetting = new QuizSebSetting();
                newSetting.setQuizId(quizId);
                newSetting.setSebRequired(true); // Set required since we're generating a config
                newSetting.setBrowserExamKey(browserExamKey);
                sebSettingRepository.save(newSetting);
                log.debug("Created new SEB setting with Browser Exam Key for quiz: {}", quizId);
            }
        }

        // Create a SEB configuration with settings appropriate for Canvas quizzes
        SebConfig config = createSebConfigForCanvasQuiz(quizId, quizUrl);

        // Add the Browser Exam Key to the configuration
        config.setBrowserExamKey(browserExamKey);
        config.setSendBrowserExamKey(false); // WKWebView exposes BEK/CK via the SEB JavaScript API, not HTTP headers

        // Generate the .seb file using our config generator
        byte[] sebFileContent = sebConfigGenerator.generateSebFile(config, browserExamKey);
        log.debug("Generated SEB config file for quiz: {} ({} bytes)", quizId, sebFileContent.length);

        return sebFileContent;
    }

    // Rest of the methods remain the same, only HttpServletRequest usage will have been updated by the imports

    // ...

    /**
     * Creates a SEB configuration with settings appropriate for Canvas quizzes.
     */
    private SebConfig createSebConfigForCanvasQuiz(String quizId, String quizUrl) {
        SebConfig config = new SebConfig();

        // Basic identification
        config.setName("Canvas Quiz " + quizId);
        config.setDescription("Safe Exam Browser Configuration for Canvas Quiz");

        // URL settings
        config.setStartURL(quizUrl);
        config.setQuitURL(quizUrl + "/submitted"); // Use submission page as quit URL

        // Security settings - these can be adjusted based on requirements
        config.setAllowQuit(true);        // Allow students to exit SEB
        config.setAllowReload(true);      // Allow page reloads (important for Canvas)
        config.setBlockExplorer(true);    // Block accessing file system
        config.setDisableScreenCapture(true); // Prevent screenshots
        config.setDisablePrinting(true);  // Disable printing
        config.setEnableRightClick(false); // Disable right-click menu
        config.setShowReloadButton(true); // Show reload button (helpful for Canvas)
        config.setEnablePlugIns(true);    // Enable plugins (may be required for some Canvas features)

        // URL filtering - enable filtering and add Canvas domain
        config.setUrlFilterEnable(true);

        // Extract Canvas domain from the quiz URL
        String canvasDomain = extractDomain(quizUrl);
        if (canvasDomain != null) {
            config.setCanvasDomain(canvasDomain);
            config.getAllowedURLs().add("*." + canvasDomain + "/*"); // Allow all subdomains

            // Allow Canvas assets and APIs
            config.getAllowedURLs().add("*.instructure.com/*");
            config.getAllowedURLs().add("*.canvaslms.com/*");
            config.getAllowedURLs().add("*.insops.net/*");
            config.getAllowedURLs().add("*.inscloudgate.net/*");

            // Common CDNs that Canvas might use
            config.getAllowedURLs().add("*.cloudfront.net/*");
            config.getAllowedURLs().add("*.googleapis.com/*");
        }

        // Store Canvas-specific info
        if (quizUrl.contains("/courses/")) {
            // Extract course ID from URL if possible (used for better config management)
            String courseId = extractCourseIdFromUrl(quizUrl);
            if (courseId != null) {
                config.setCanvasCourseId(courseId);
            }
        }
        config.setCanvasQuizId(quizId);

        return config;
    }

    // Additional methods (generateBrowserExamKey, extractDomain, etc.) remain the same
    private String generateBrowserExamKey() throws NoSuchAlgorithmException {
        // Create a unique string combining a prefix, a random UUID, and the current timestamp
        String randomStr = "SEB" + UUID.randomUUID().toString() + System.currentTimeMillis();

        // Hash it with SHA-256 to create the Browser Exam Key
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] encodedHash = digest.digest(randomStr.getBytes(StandardCharsets.UTF_8));
        return bytesToHex(encodedHash);
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }

    private String extractDomain(String url) {
        if (url == null || url.isEmpty()) {
            return null;
        }

        try {
            // Remove protocol if present
            String domain = url.replaceAll("^(https?://)?", "");

            // Extract domain name (stop at first slash or port)
            int endIndex = domain.indexOf('/');
            if (endIndex == -1) {
                endIndex = domain.length();
            }

            int portIndex = domain.indexOf(':');
            if (portIndex != -1 && portIndex < endIndex) {
                endIndex = portIndex;
            }

            return domain.substring(0, endIndex);
        } catch (Exception e) {
            log.warn("Error extracting domain from URL: {}", url, e);
            return null;
        }
    }

    private String extractCourseIdFromUrl(String url) {
        if (url == null || url.isEmpty() || !url.contains("/courses/")) {
            return null;
        }

        try {
            // Find the courses part
            int coursesIndex = url.indexOf("/courses/");
            if (coursesIndex == -1) {
                return null;
            }

            // Extract the course ID (everything between /courses/ and the next /)
            String afterCourses = url.substring(coursesIndex + 9); // 9 is length of "/courses/"
            int nextSlash = afterCourses.indexOf('/');

            if (nextSlash == -1) {
                // No trailing slash
                return afterCourses;
            } else {
                return afterCourses.substring(0, nextSlash);
            }
        } catch (Exception e) {
            log.warn("Error extracting course ID from URL: {}", url, e);
            return null;
        }
    }

    /**
     * Validate the Browser Exam Key from a request against the expected key for a quiz.
     * This is a convenient method that extracts the key from the request and validates it.
     *
     * @param request The HTTP request containing the SEB headers
     * @param quizId The ID of the quiz
     * @return true if the key is valid, false otherwise
     */
    public boolean validateBrowserExamKey(HttpServletRequest request, String quizId) {
        if (request == null) {
            log.debug("No request provided for Browser Exam Key validation");
            return false;
        }

        Optional<QuizSebSetting> settingOpt = sebSettingRepository.findByQuizId(quizId);
        if (!settingOpt.isPresent() || settingOpt.get().getBrowserExamKey() == null) {
            log.debug("No Browser Exam Key found in SEB settings for quiz: {}", quizId);
            return false;
        }

        String expectedKey = settingOpt.get().getBrowserExamKey();
        return sebDetector.validateBrowserExamKey(request, expectedKey);
    }

}
