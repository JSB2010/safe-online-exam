package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.FirestoreQuizRepository;
import org.kentdenver.sebcanvas.repository.FirestoreSebSettingRepository;
import org.kentdenver.sebcanvas.util.SebConfigGenerator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service class for managing quizzes and their SEB settings.
 * Updated to use the CanvasService interface for Canvas API interactions.
 */
@Service
@Slf4j
public class QuizService {

    private final FirestoreQuizRepository quizRepository;
    private final FirestoreSebSettingRepository sebSettingRepository;
    private final HybridCanvasAuthService hybridAuthService;
    private final SebConfigGenerator sebConfigGenerator;
    private final CanvasApiService canvasApiService;
    private final SebConfigService sebConfigService;
    private final CanvasApiConfig canvasApiConfig;

    /**
     * Constructor for QuizService with dependency injection.
     *
     * @param quizRepository Repository for quiz data
     * @param sebSettingRepository Repository for SEB settings
     * @param hybridAuthService Service for hybrid Canvas authentication
     * @param sebConfigGenerator Utility for generating SEB config files
     * @param canvasApiService Service for Canvas API interactions
     * @param sebConfigService Service for SEB configuration file generation
     */
    @Autowired
    public QuizService(
            FirestoreQuizRepository quizRepository,
            FirestoreSebSettingRepository sebSettingRepository,
            HybridCanvasAuthService hybridAuthService,
            SebConfigGenerator sebConfigGenerator,
            CanvasApiService canvasApiService,
            SebConfigService sebConfigService,
            CanvasApiConfig canvasApiConfig) {
        this.quizRepository = quizRepository;
        this.sebSettingRepository = sebSettingRepository;
        this.hybridAuthService = hybridAuthService;
        this.sebConfigGenerator = sebConfigGenerator;
        this.canvasApiService = canvasApiService;
        this.sebConfigService = sebConfigService;
        this.canvasApiConfig = canvasApiConfig;
        log.info("Initialized QuizService with enhanced SEB support");
    }

    /**
     * Gets all quizzes for a specific course (backward compatibility).
     * If not found in the local database, fetches them from Canvas and saves them to Firestore.
     * Note: This method uses courseId as userId which may not work with OAuth.
     *
     * @param courseId The Canvas course ID
     * @return List of quizzes
     */
    public List<Quiz> getQuizzesForCourse(String courseId) {
        return getQuizzesForCourse(courseId, courseId);
    }

    /**
     * Retrieves all quizzes for a specific course.
     * By default, fetches fresh data from Canvas to ensure up-to-date information.
     *
     * @param courseId The Canvas course ID
     * @param userId The user ID for authentication context
     * @return List of quizzes
     */
    public List<Quiz> getQuizzesForCourse(String courseId, String userId) {
        return getQuizzesForCourse(courseId, userId, true); // Default to fresh data
    }

    /**
     * Retrieves all quizzes for a specific course with option to use cached data.
     *
     * @param courseId The Canvas course ID
     * @param userId The user ID for authentication context
     * @param forceRefresh If true, fetches fresh data from Canvas; if false, uses cache if available
     * @return List of quizzes
     */
    public List<Quiz> getQuizzesForCourse(String courseId, String userId, boolean forceRefresh) {
        log.debug("Getting quizzes for course: {} with user: {} (forceRefresh: {})", courseId, userId, forceRefresh);

        List<Quiz> quizzes = new ArrayList<>();

        // Check cache first only if not forcing refresh
        if (!forceRefresh) {
            quizzes = quizRepository.findByCourseId(courseId);
            if (!quizzes.isEmpty()) {
                log.info("Using cached quizzes for course: {} ({} quizzes found)", courseId, quizzes.size());
                return quizzes;
            }
        } else {
            log.info("Force refresh enabled - fetching fresh quiz data from Canvas for course: {}", courseId);
        }

        // Fetch fresh data from Canvas
        log.debug("Fetching fresh quiz data from Canvas for course: {}", courseId);

        // Use hybrid authentication service for intelligent fallback
        log.info("Attempting to fetch quizzes using hybrid authentication strategy");
        List<Map<String, Object>> rawQuizzes = hybridAuthService.getQuizzes(courseId, userId);

        // Convert raw quiz data to Quiz objects
        quizzes = rawQuizzes.stream()
                .map(rawQuiz -> {
                    Quiz quiz = convertToQuiz(rawQuiz);
                    // Ensure course ID is set
                    if (quiz.getCourseId() == null || quiz.getCourseId().isEmpty()) {
                        quiz.setCourseId(courseId);
                    }
                    return quiz;
                })
                .collect(Collectors.toList());

        if (!quizzes.isEmpty()) {
            log.info("Successfully retrieved {} fresh quizzes from Canvas using hybrid authentication", quizzes.size());

            // Clear old cached data and save fresh data
            try {
                // Delete old cached quizzes for this course
                List<Quiz> oldQuizzes = quizRepository.findByCourseId(courseId);
                for (Quiz oldQuiz : oldQuizzes) {
                    quizRepository.deleteById(oldQuiz.getId());
                }
                log.debug("Cleared {} old cached quizzes for course: {}", oldQuizzes.size(), courseId);

                // Save fresh quizzes to cache
                quizzes = quizRepository.saveAll(quizzes);
                log.debug("Cached {} fresh quizzes from Canvas", quizzes.size());
            } catch (Exception e) {
                log.error("Error updating quiz cache: {}", e.getMessage());
                // Continue with the fetched quizzes even if caching fails
            }
        } else {
            log.warn("No quizzes found in Canvas for course: {} using any method", courseId);

            // If fresh fetch failed, try cache as last resort
            if (forceRefresh) {
                log.info("Fresh fetch failed, checking cache as fallback");
                quizzes = quizRepository.findByCourseId(courseId);
                if (!quizzes.isEmpty()) {
                    log.warn("Using stale cached data - {} quizzes found in cache", quizzes.size());
                }
            }
        }

        return quizzes;
    }

    /**
     * Clears all cached quiz data for a specific course.
     * This forces the next quiz fetch to get fresh data from Canvas.
     *
     * @param courseId The Canvas course ID
     */
    public void clearQuizCache(String courseId) {
        log.info("Clearing quiz cache for course: {}", courseId);
        try {
            List<Quiz> cachedQuizzes = quizRepository.findByCourseId(courseId);
            for (Quiz quiz : cachedQuizzes) {
                quizRepository.deleteById(quiz.getId());
            }
            log.info("Cleared {} cached quizzes for course: {}", cachedQuizzes.size(), courseId);
        } catch (Exception e) {
            log.error("Error clearing quiz cache for course {}: {}", courseId, e.getMessage());
        }
    }

    // The rest of the QuizService methods can remain unchanged
    // They operate on local data and don't interact with Canvas API

    /**
     * Checks if a quiz requires SEB.
     *
     * @param quizId The quiz ID
     * @return true if SEB is required, false otherwise
     */
    public boolean isSebRequired(String quizId) {
        log.debug("Checking if SEB is required for quiz: {}", quizId);
        Optional<QuizSebSetting> setting = sebSettingRepository.findByQuizId(quizId);

        if (setting.isPresent()) {
            boolean required = setting.get().isSebRequired();
            log.debug("SEB requirement for quiz {}: {}", quizId, required);
            return required;
        }

        log.debug("No SEB setting found for quiz: {}, defaulting to not required", quizId);
        return false;
    }

    /**
     * Gets SEB requirements for a list of quizzes.
     * This is a convenience method for the UI to display SEB requirements for multiple quizzes.
     *
     * @param quizzes The list of quizzes
     * @return A map of quiz IDs to boolean values indicating SEB requirements
     */
    public Map<String, Boolean> getQuizSebRequirements(List<Quiz> quizzes) {
        log.debug("Getting SEB requirements for {} quizzes", quizzes.size());

        // Create a map of quiz IDs to SEB requirements
        Map<String, Boolean> requirements = new HashMap<>();

        if (quizzes.isEmpty()) {
            return requirements;
        }

        // Get all quiz IDs
        List<String> quizIds = quizzes.stream()
                .map(Quiz::getId)
                .collect(Collectors.toList());

        // Find all SEB settings for these quizzes using the Firestore repository
        List<QuizSebSetting> settings = sebSettingRepository.findAllByQuizIdIn(quizIds);

        // Create a map of quiz ID to SEB required flag
        Map<String, Boolean> settingsMap = settings.stream()
                .collect(Collectors.toMap(
                        QuizSebSetting::getQuizId,
                        QuizSebSetting::isSebRequired
                ));

        // Set the requirement for each quiz
        for (Quiz quiz : quizzes) {
            requirements.put(quiz.getId(), settingsMap.getOrDefault(quiz.getId(), false));
        }

        return requirements;
    }

    /**
     * Updates the SEB requirement for a quiz.
     * In Firestore, this uses a find-then-update pattern since there are no JPA-style transactions.
     *
     * @param quizId The quiz ID
     * @param required Whether SEB is required
     * @return The updated setting
     */
    public QuizSebSetting updateSebRequirement(String quizId, boolean required) {
        log.debug("Updating SEB requirement for quiz: {} to {}", quizId, required);

        // Find existing setting or create a new one
        QuizSebSetting setting = sebSettingRepository.findByQuizId(quizId)
                .orElseGet(() -> {
                    QuizSebSetting newSetting = new QuizSebSetting();
                    newSetting.setQuizId(quizId);
                    return newSetting;
                });

        setting.setSebRequired(required);

        // If enabling SEB, generate a new Browser Exam Key if needed
        if (required && (setting.getBrowserExamKey() == null || setting.getBrowserExamKey().isEmpty())) {
            try {
                String browserExamKey = generateBrowserExamKey();
                setting.setBrowserExamKey(browserExamKey);
                log.debug("Generated new Browser Exam Key for quiz: {}", quizId);
            } catch (NoSuchAlgorithmException e) {
                log.error("Error generating Browser Exam Key for quiz: {}", quizId, e);
            }
        }

        // Save to Firestore
        QuizSebSetting savedSetting = sebSettingRepository.save(setting);
        log.debug("Saved SEB setting for quiz: {}", quizId);

        return savedSetting;
    }

    /**
     * Updates comprehensive SEB settings including allowed sites and external tool URL.
     *
     * @param quizId The quiz ID
     * @param allowedSites JSON string of allowed sites
     * @param externalToolUrl The external tool URL for Canvas integration
     * @param sebRequired Whether SEB is required for this quiz
     * @return The updated setting
     */
    public QuizSebSetting updateSebConfiguration(String quizId, String allowedSites, String externalToolUrl, boolean sebRequired) {
        log.debug("Updating comprehensive SEB configuration for quiz: {}", quizId);

        // Find existing setting or create a new one
        QuizSebSetting setting = sebSettingRepository.findByQuizId(quizId)
                .orElseGet(() -> {
                    QuizSebSetting newSetting = new QuizSebSetting();
                    newSetting.setQuizId(quizId);
                    newSetting.setSebRequired(sebRequired);
                    return newSetting;
                });

        // Update the comprehensive settings
        setting.setAllowedSites(allowedSites);
        setting.setExternalToolUrl(externalToolUrl);
        setting.setSebRequired(sebRequired);

        // Generate Browser Exam Key if needed
        if (setting.getBrowserExamKey() == null || setting.getBrowserExamKey().isEmpty()) {
            try {
                String browserExamKey = generateBrowserExamKey();
                setting.setBrowserExamKey(browserExamKey);
                log.debug("Generated new Browser Exam Key for quiz: {}", quizId);
            } catch (NoSuchAlgorithmException e) {
                log.error("Error generating Browser Exam Key for quiz: {}", quizId, e);
            }
        }

        // Save to Firestore
        QuizSebSetting savedSetting = sebSettingRepository.save(setting);
        log.info("Updated comprehensive SEB configuration for quiz: {}", quizId);
        return savedSetting;
    }

    /**
     * Updates SEB configuration with structured domain settings.
     *
     * @param quizId The quiz ID
     * @param ssoDomains List of SSO domains
     * @param educationalToolDomains List of educational tool domains
     * @param customDomains List of custom domains
     * @param externalToolUrl The external tool URL for Canvas integration
     * @param sebRequired Whether SEB is required for this quiz
     * @return The updated setting
     */
    public QuizSebSetting updateSebConfigurationStructured(String quizId, List<String> ssoDomains,
                                                          List<String> educationalToolDomains,
                                                          List<String> customDomains,
                                                          String externalToolUrl, boolean sebRequired) {
        log.debug("Updating structured SEB configuration for quiz: {}", quizId);

        QuizSebSetting setting = sebSettingRepository.findByQuizId(quizId)
                .orElseGet(() -> {
                    QuizSebSetting newSetting = new QuizSebSetting();
                    newSetting.setQuizId(quizId);
                    return newSetting;
                });

        // Update structured domain settings
        setting.setSsoDomains(ssoDomains != null ? ssoDomains : new ArrayList<>());
        setting.setEducationalToolDomains(educationalToolDomains != null ? educationalToolDomains : new ArrayList<>());
        setting.setCustomDomains(customDomains != null ? customDomains : new ArrayList<>());
        setting.setExternalToolUrl(externalToolUrl);
        setting.setSebRequired(sebRequired);

        // Set Canvas domain from configuration
        try {
            String canvasDomain = canvasApiConfig.getCanvasDomain();
            if (canvasDomain != null && !canvasDomain.isEmpty()) {
                setting.setCanvasDomain(canvasDomain.replace("https://", ""));
            }
        } catch (Exception e) {
            log.warn("Could not set Canvas domain: {}", e.getMessage());
        }

        // Generate Browser Exam Key if needed
        if (setting.getBrowserExamKey() == null || setting.getBrowserExamKey().isEmpty()) {
            try {
                String browserExamKey = generateBrowserExamKey();
                setting.setBrowserExamKey(browserExamKey);
                log.debug("Generated new Browser Exam Key for quiz: {}", quizId);
            } catch (NoSuchAlgorithmException e) {
                log.error("Error generating Browser Exam Key for quiz: {}", quizId, e);
            }
        }

        // Save to Firestore
        QuizSebSetting savedSetting = sebSettingRepository.save(setting);
        log.info("Updated structured SEB configuration for quiz: {}", quizId);
        return savedSetting;
    }

    /**
     * Updates the Browser Exam Key for a specific quiz.
     *
     * @param quizId The quiz ID
     * @param browserExamKey The Browser Exam Key to set
     * @return The updated setting
     */
    public QuizSebSetting updateBrowserExamKey(String quizId, String browserExamKey) {
        log.debug("Updating Browser Exam Key for quiz: {}", quizId);

        QuizSebSetting setting = sebSettingRepository.findByQuizId(quizId)
                .orElseThrow(() -> new RuntimeException("SEB setting not found for quiz: " + quizId));

        setting.setBrowserExamKey(browserExamKey);

        QuizSebSetting savedSetting = sebSettingRepository.save(setting);
        log.debug("Updated Browser Exam Key for quiz: {}", quizId);

        return savedSetting;
    }

    /**
     * Gets the URL of a quiz.
     *
     * @param quizId The quiz ID
     * @return The quiz URL
     */
    public String getQuizUrl(String quizId) {
        log.debug("Getting URL for quiz: {}", quizId);
        Optional<Quiz> quiz = quizRepository.findById(quizId);

        if (quiz.isPresent()) {
            String url = quiz.get().getHtmlUrl();
            log.debug("Found URL for quiz {}: {}", quizId, url);
            return url;
        }

        log.warn("Quiz not found in database: {}", quizId);
        throw new IllegalArgumentException("Quiz not found: " + quizId);
    }

    /**
     * Generates a SEB configuration file for a quiz.
     *
     * @param quizId The quiz ID
     * @param quizUrl The quiz URL
     * @return The SEB configuration file as a byte array
     * @throws IOException If there's an error generating the file
     * @throws NoSuchAlgorithmException If there's an error generating cryptographic keys
     */
    public byte[] generateSebConfig(String quizId, String quizUrl) throws IOException, NoSuchAlgorithmException {
        log.debug("Generating SEB config for quiz: {} with URL: {}", quizId, quizUrl);

        // Check if there's an existing Browser Exam Key for this quiz
        String browserExamKey = null;
        Optional<QuizSebSetting> setting = sebSettingRepository.findByQuizId(quizId);

        if (setting.isPresent() && setting.get().getBrowserExamKey() != null) {
            browserExamKey = setting.get().getBrowserExamKey();
            log.debug("Using existing Browser Exam Key for quiz: {}", quizId);
        } else {
            // Generate a new Browser Exam Key
            browserExamKey = generateBrowserExamKey();

            // Save the new key
            if (setting.isPresent()) {
                QuizSebSetting sebSetting = setting.get();
                sebSetting.setBrowserExamKey(browserExamKey);
                sebSettingRepository.save(sebSetting);
                log.debug("Saved new Browser Exam Key for quiz: {}", quizId);
            } else {
                // Create a new setting with the Browser Exam Key
                QuizSebSetting newSetting = new QuizSebSetting();
                newSetting.setQuizId(quizId);
                newSetting.setSebRequired(true);
                newSetting.setBrowserExamKey(browserExamKey);
                sebSettingRepository.save(newSetting);
                log.debug("Created new SEB setting with Browser Exam Key for quiz: {}", quizId);
            }
        }

        // Create a SEB configuration
        org.kentdenver.sebcanvas.model.SebConfig config = new org.kentdenver.sebcanvas.model.SebConfig();
        config.setName("Quiz " + quizId);
        config.setDescription("SEB Config for Canvas Quiz");
        config.setAllowQuit(true);
        config.setBlockExplorer(true);
        config.setDisableScreenCapture(true);
        config.setDisablePrinting(true);
        config.setStartURL(quizUrl);

        // For Canvas quizzes, we want to quit SEB after submission
        // The quiz submission confirmation page URL can be used as the quit URL
        // This is a simplification - in reality, you would need a more robust approach
        config.setQuitURL(quizUrl + "/submitted");

        // Generate the SEB file with the Browser Exam Key
        byte[] sebFileContent = sebConfigGenerator.generateSebFile(config, browserExamKey);
        log.debug("Generated SEB config file for quiz: {} ({} bytes)", quizId, sebFileContent.length);

        return sebFileContent;
    }

    /**
     * Gets a specific quiz by ID.
     *
     * @param quizId The quiz ID
     * @return The quiz, or null if not found
     */
    public Quiz getQuiz(String quizId) {
        log.debug("Getting quiz: {}", quizId);
        return quizRepository.findById(quizId).orElse(null);
    }

    /**
     * Gets the SEB setting for a specific quiz.
     *
     * @param quizId The quiz ID
     * @return The SEB setting, or null if not found
     */
    public QuizSebSetting getSebSettingForQuiz(String quizId) {
        log.debug("Getting SEB setting for quiz: {}", quizId);
        return sebSettingRepository.findByQuizId(quizId).orElse(null);
    }

    /**
     * Generates a random Browser Exam Key.
     *
     * @return A SHA-256 hash as a hex string
     * @throws NoSuchAlgorithmException If SHA-256 is not available
     */
    private String generateBrowserExamKey() throws NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        String randomStr = "SEB" + UUID.randomUUID().toString() + System.currentTimeMillis();
        byte[] encodedHash = digest.digest(randomStr.getBytes(StandardCharsets.UTF_8));
        return bytesToHex(encodedHash);
    }

    /**
     * Converts a byte array to a hexadecimal string.
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

    /**
     * Converts a raw Canvas API quiz data map to a Quiz object.
     * This method handles the mapping from Canvas API format to our internal model.
     *
     * @param rawQuiz The raw quiz data from Canvas API
     * @return Quiz object
     */
    private Quiz convertToQuiz(Map<String, Object> rawQuiz) {
        Quiz quiz = new Quiz();

        // Extract basic information
        Object idObj = rawQuiz.get("id");
        if (idObj != null) {
            quiz.setId(idObj.toString());
            quiz.setCanvasQuizId(idObj.toString());
        }

        quiz.setTitle((String) rawQuiz.get("title"));
        quiz.setDescription((String) rawQuiz.getOrDefault("description", ""));
        quiz.setHtmlUrl((String) rawQuiz.get("html_url"));

        // Set course ID if available in the raw data, otherwise it should be set by the caller
        Object courseIdObj = rawQuiz.get("course_id");
        if (courseIdObj != null) {
            quiz.setCourseId(courseIdObj.toString());
        }

        return quiz;
    }

    /**
     * Enables SEB for a quiz with access code enforcement.
     */
    public boolean enableSebWithAccessCode(String courseId, String quizId, String userId, Map<String, Object> customSettings) {
        try {
            log.info("Attempting to enable SEB for quiz {} in course {} for user {}", quizId, courseId, userId);

            // Check if user has valid access token
            if (userId == null || userId.isEmpty()) {
                log.error("No user ID provided for enabling SEB");
                return false;
            }

            // Generate secure access code
            String accessCode = generateSecureAccessCode();
            log.info("Generated access code for quiz {}: {}", quizId, accessCode);

            log.info("Setting access code for Classic Quiz {} using Classic Quizzes API", quizId);
            boolean accessCodeSet = canvasApiService.setQuizAccessCode(courseId, quizId, accessCode, userId);

            if (!accessCodeSet) {
                log.error("Failed to set access code for quiz {} in course {} - Canvas API call failed", quizId, courseId);
                return false;
            }

            // Get or create SEB setting
            QuizSebSetting sebSetting = getSebSettingForQuiz(quizId);
            if (sebSetting == null) {
                log.info("Creating new SEB setting for quiz {}", quizId);
                sebSetting = new QuizSebSetting();
                sebSetting.setQuizId(quizId);
                sebSetting.setCourseId(courseId);
            } else {
                log.info("Updating existing SEB setting for quiz {}", quizId);
            }

            // Update SEB settings
            sebSetting.setSebRequired(true);
            sebSetting.setAccessCode(accessCode);
            sebSetting.setEnabled(true);

            // Save SEB settings
            sebSettingRepository.save(sebSetting);
            log.info("SEB database setting saved for quiz {}", quizId);

            log.info("Successfully enabled SEB with access code for quiz {} in course {}", quizId, courseId);
            return true;

        } catch (Exception e) {
            log.error("Error enabling SEB for quiz {}: {}", quizId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * Disables SEB for a quiz and removes access code.
     */
    public boolean disableSebWithAccessCode(String courseId, String quizId, String userId) {
        try {
            log.info("Attempting to disable SEB for quiz {} in course {} for user {}", quizId, courseId, userId);

            // Check if user has valid access token
            if (userId == null || userId.isEmpty()) {
                log.error("No user ID provided for disabling SEB");
                return false;
            }

            // Get current SEB settings
            QuizSebSetting sebSetting = getSebSettingForQuiz(quizId);
            boolean hasAccessCode = (sebSetting != null && sebSetting.getAccessCode() != null && !sebSetting.getAccessCode().isEmpty());

            log.info("Quiz {} treated as classic quiz during SEB disable flow (has access code: {})", quizId, hasAccessCode);

            // For quizzes with access codes, try to remove the access code from Canvas
            boolean accessCodeRemoved = true; // Default to true for quizzes without access codes
            if (hasAccessCode) {
                log.info("Attempting to remove access code from Canvas for Classic Quiz {}", quizId);
                accessCodeRemoved = canvasApiService.removeQuizAccessCode(courseId, quizId, userId);

                if (!accessCodeRemoved) {
                    log.error("Failed to remove access code for quiz {} in course {} - Canvas API call failed", quizId, courseId);
                    return false;
                }
                log.info("Successfully removed access code from Canvas for quiz {}", quizId);
            } else {
                log.info("Skipping Canvas access code removal for quiz {} (no access code to remove)", quizId);
            }

            // Update SEB settings in our database
            if (sebSetting != null) {
                sebSetting.setSebRequired(false);
                sebSetting.setAccessCode(null);
                sebSetting.setEnabled(false);
                sebSettingRepository.save(sebSetting);
                log.info("SEB database setting updated for quiz {}", quizId);
            } else {
                log.info("Creating new disabled SEB setting for legacy quiz {}", quizId);
                // Create a disabled setting to track that SEB was disabled
                sebSetting = new QuizSebSetting();
                sebSetting.setQuizId(quizId);
                sebSetting.setCourseId(courseId);
                sebSetting.setSebRequired(false);
                sebSetting.setEnabled(false);
                sebSetting.setAccessCode(null);
                sebSettingRepository.save(sebSetting);
            }

            log.info("Successfully disabled SEB for quiz {} in course {}", quizId, courseId);
            return true;

        } catch (Exception e) {
            log.error("Error disabling SEB for quiz {} in course {}: {}", quizId, courseId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * Generates a SEB configuration file for a quiz.
     */
    public byte[] generateSebConfigFile(String courseId, String quizId, Map<String, Object> customSettings) {
        try {
            QuizSebSetting sebSetting = getSebSettingForQuiz(quizId);
            if (sebSetting == null || !sebSetting.isSebRequired()) {
                throw new IllegalStateException("SEB is not enabled for quiz " + quizId);
            }

            String accessCode = sebSetting.getAccessCode();
            if (accessCode == null || accessCode.isEmpty()) {
                throw new IllegalStateException("No access code found for quiz " + quizId);
            }

            return sebConfigService.generateSebConfig(courseId, quizId, accessCode, sebSetting, customSettings);

        } catch (Exception e) {
            log.error("Error generating SEB config file for quiz {}: {}", quizId, e.getMessage(), e);
            throw new RuntimeException("Failed to generate SEB configuration file", e);
        }
    }

    /**
     * Generates a secure random access code.
     */
    private String generateSecureAccessCode() {
        SecureRandom random = new SecureRandom();
        StringBuilder accessCode = new StringBuilder();

        // Generate 8-character alphanumeric code
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        for (int i = 0; i < 8; i++) {
            accessCode.append(chars.charAt(random.nextInt(chars.length())));
        }

        return accessCode.toString();
    }

    /**
     * Validates if a quiz has proper SEB configuration.
     */
    public boolean validateSebConfiguration(String quizId) {
        try {
            QuizSebSetting sebSetting = getSebSettingForQuiz(quizId);
            return sebSetting != null &&
                   sebSetting.isSebRequired() &&
                   sebSetting.getAccessCode() != null &&
                   !sebSetting.getAccessCode().isEmpty();
        } catch (Exception e) {
            log.error("Error validating SEB configuration for quiz {}: {}", quizId, e.getMessage());
            return false;
        }
    }
}