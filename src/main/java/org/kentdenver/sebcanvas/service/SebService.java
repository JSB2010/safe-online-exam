package org.kentdenver.sebcanvas.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.model.SebConfig;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.util.SebConfigGenerator;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Optional;
import java.util.UUID;

/**
 * Service for SEB-related operations including detection, validation, and configuration generation.
 * Provides methods to work with Safe Exam Browser configs and headers.
 *
 * This service handles:
 * 1. Detection of SEB browser based on HTTP headers
 * 2. Validation of Browser Exam Keys sent by SEB
 * 3. Generation of SEB configuration files (.seb) for Canvas quizzes
 * 4. Management of Browser Exam Keys for quiz security
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class SebService {

    // Service dependencies injected through constructor
    private final SebSettingRepository sebSettingRepository;
    private final SebConfigGenerator sebConfigGenerator;

    // Constants for SEB-specific headers
    private static final String USER_AGENT_HEADER = "User-Agent";
    private static final String CONFIG_KEY_HASH_HEADER = "X-SafeExamBrowser-ConfigKeyHash";
    private static final String BROWSER_EXAM_KEY_HEADER = "X-SafeExamBrowser-BrowserExamKey";
    private static final String SEB_UA_PATTERN = "SEB";

    /**
     * Check if the user is using SEB based on request headers.
     * SEB adds specific headers to HTTP requests that can be detected.
     *
     * @param request The HTTP request to check
     * @return true if the request appears to come from SEB, false otherwise
     */
    public boolean isUsingSeb(HttpServletRequest request) {
        if (request == null) {
            log.debug("Request is null, cannot detect SEB");
            return false;
        }

        // Check for SEB in User-Agent header
        String userAgent = request.getHeader(USER_AGENT_HEADER);
        if (userAgent != null && userAgent.contains(SEB_UA_PATTERN)) {
            log.debug("SEB detected through User-Agent: {}", userAgent);
            return true;
        }

        // Check for SEB-specific headers
        String configKeyHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        if (configKeyHash != null && !configKeyHash.isEmpty()) {
            log.debug("SEB detected through Config Key Hash header: {}", configKeyHash);
            return true;
        }

        String browserExamKey = request.getHeader(BROWSER_EXAM_KEY_HEADER);
        if (browserExamKey != null && !browserExamKey.isEmpty()) {
            log.debug("SEB detected through Browser Exam Key header: {}", browserExamKey);
            return true;
        }

        log.debug("SEB not detected in request headers");
        return false;
    }

    /**
     * Generate a SEB .seb file for a quiz.
     * This generates a configuration file that can be opened by SEB to launch the quiz.
     *
     * @param quizId The ID of the quiz
     * @param quizUrl The URL of the quiz in Canvas
     * @return The generated SEB configuration file as a byte array
     * @throws IOException If there's an error generating the file
     * @throws NoSuchAlgorithmException If there's an error with cryptographic operations
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

        // Generate the .seb file with the Browser Exam Key
        byte[] sebFileContent = sebConfigGenerator.generateSebFile(config, browserExamKey);
        log.debug("Generated SEB config file for quiz: {} ({} bytes)", quizId, sebFileContent.length);

        return sebFileContent;
    }

    /**
     * Creates a SEB configuration with settings appropriate for Canvas quizzes.
     *
     * @param quizId The ID of the quiz
     * @param quizUrl The URL of the quiz in Canvas
     * @return A SebConfig object with appropriate settings
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
        config.setBlockExplorer(true);    // Block accessing file system
        config.setDisableScreenCapture(true); // Prevent screenshots
        config.setDisablePrinting(true);  // Disable printing

        // Additional settings could be added here
        // For example:
        // config.setEnableAudio(true);
        // config.setEnablePlugIns(false);
        // config.setAllowSpellCheck(false);

        return config;
    }

    /**
     * Validates a Browser Exam Key from a request against the expected key for a quiz.
     * This ensures the student is using the correct SEB configuration.
     *
     * @param quizId The ID of the quiz
     * @param providedKey The Browser Exam Key provided in the request header
     * @return true if the key is valid, false otherwise
     */
    public boolean validateBrowserExamKey(String quizId, String providedKey) {
        log.debug("Validating Browser Exam Key for quiz: {}", quizId);

        if (providedKey == null || providedKey.isEmpty()) {
            log.debug("No Browser Exam Key provided for validation");
            return false;
        }

        Optional<QuizSebSetting> settingOpt = sebSettingRepository.findByQuizId(quizId);

        if (settingOpt.isPresent()) {
            String expectedKey = settingOpt.get().getBrowserExamKey();

            if (expectedKey != null && expectedKey.equals(providedKey)) {
                log.debug("Browser Exam Key validation successful for quiz: {}", quizId);
                return true;
            } else {
                log.debug("Browser Exam Key validation failed for quiz: {}", quizId);
                return false;
            }
        }

        log.debug("No SEB setting found for quiz: {}", quizId);
        return false;
    }

    /**
     * Validate the Config Key Hash from a request.
     * This is a more complex validation involving the URL of the request.
     *
     * @param request The HTTP request containing the Config Key Hash
     * @param quizId The ID of the quiz
     * @return true if the hash is valid, false otherwise
     */
    public boolean validateConfigKeyHash(HttpServletRequest request, String quizId) {
        log.debug("Validating Config Key Hash for quiz: {}", quizId);

        if (request == null) {
            log.debug("No request provided for Config Key Hash validation");
            return false;
        }

        String configKeyHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        if (configKeyHash == null || configKeyHash.isEmpty()) {
            log.debug("No Config Key Hash header found in request");
            return false;
        }

        Optional<QuizSebSetting> settingOpt = sebSettingRepository.findByQuizId(quizId);
        if (!settingOpt.isPresent() || settingOpt.get().getConfigKey() == null) {
            log.debug("No Config Key found in SEB settings for quiz: {}", quizId);
            return false;
        }

        String configKey = settingOpt.get().getConfigKey();

        try {
            // Get the request URL
            String requestUrl = getFullRequestUrl(request);

            // Calculate the expected hash: SHA-256(URL + ConfigKey)
            String urlWithKey = requestUrl + configKey;
            String expectedHash = calculateSha256Hash(urlWithKey);

            // Compare with the provided hash
            boolean isValid = expectedHash.equalsIgnoreCase(configKeyHash);
            log.debug("Config Key Hash validation result for quiz {}: {}", quizId, isValid);

            return isValid;
        } catch (Exception e) {
            log.error("Error validating Config Key Hash", e);
            return false;
        }
    }

    /**
     * Get the full URL of a request, including query parameters.
     *
     * @param request The HTTP request
     * @return The full URL as a string
     */
    private String getFullRequestUrl(HttpServletRequest request) {
        StringBuilder url = new StringBuilder();

        url.append(request.getScheme()).append("://")
                .append(request.getServerName());

        // Add port if it's not the default
        if (request.getServerPort() != 80 && request.getServerPort() != 443) {
            url.append(":").append(request.getServerPort());
        }

        url.append(request.getRequestURI());

        // Add query string if present
        if (request.getQueryString() != null) {
            url.append("?").append(request.getQueryString());
        }

        return url.toString();
    }

    /**
     * Generate a random Browser Exam Key.
     * This creates a unique identifier for a SEB configuration.
     *
     * @return A SHA-256 hash as a hex string
     * @throws NoSuchAlgorithmException If SHA-256 is not available
     */
    private String generateBrowserExamKey() throws NoSuchAlgorithmException {
        // Create a unique string combining a prefix, a random UUID, and the current timestamp
        String randomStr = "SEB" + UUID.randomUUID().toString() + System.currentTimeMillis();

        // Hash it with SHA-256 to create the Browser Exam Key
        return calculateSha256Hash(randomStr);
    }

    /**
     * Calculate a SHA-256 hash of a string.
     *
     * @param input The input string
     * @return The SHA-256 hash as a hex string
     * @throws NoSuchAlgorithmException If SHA-256 algorithm is not available
     */
    private String calculateSha256Hash(String input) throws NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] encodedHash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
        return bytesToHex(encodedHash);
    }

    /**
     * Convert a byte array to a hexadecimal string.
     *
     * @param bytes The byte array
     * @return The hexadecimal string
     */
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
}