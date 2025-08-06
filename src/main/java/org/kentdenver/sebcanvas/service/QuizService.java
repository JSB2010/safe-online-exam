package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.FirestoreQuizRepository;
import org.kentdenver.sebcanvas.repository.FirestoreSebSettingRepository;
import org.kentdenver.sebcanvas.util.SebConfigGenerator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
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

    /**
     * Constructor for QuizService with dependency injection.
     *
     * @param quizRepository Repository for quiz data
     * @param sebSettingRepository Repository for SEB settings
     * @param hybridAuthService Service for hybrid Canvas authentication
     * @param sebConfigGenerator Utility for generating SEB config files
     */
    @Autowired
    public QuizService(
            FirestoreQuizRepository quizRepository,
            FirestoreSebSettingRepository sebSettingRepository,
            HybridCanvasAuthService hybridAuthService,
            SebConfigGenerator sebConfigGenerator) {
        this.quizRepository = quizRepository;
        this.sebSettingRepository = sebSettingRepository;
        this.hybridAuthService = hybridAuthService;
        this.sebConfigGenerator = sebConfigGenerator;
        log.info("Initialized QuizService with hybrid authentication support");
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
     * If not found in the local database, fetches them from Canvas using LTI AGS (preferred) or OAuth fallback.
     *
     * @param courseId The Canvas course ID
     * @param userId The user ID for authentication context
     * @return List of quizzes
     */
    public List<Quiz> getQuizzesForCourse(String courseId, String userId) {
        log.debug("Getting quizzes for course: {} with user: {}", courseId, userId);
        List<Quiz> quizzes = quizRepository.findByCourseId(courseId);

        if (quizzes.isEmpty()) {
            log.debug("No quizzes found in database for course: {}, fetching from Canvas", courseId);

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
                log.info("Successfully retrieved {} quizzes using hybrid authentication", quizzes.size());
            }

            // Save fetched quizzes to database if any were returned
            if (!quizzes.isEmpty()) {
                try {
                    quizzes = quizRepository.saveAll(quizzes);
                    log.debug("Saved {} quizzes from Canvas to database", quizzes.size());
                } catch (Exception e) {
                    log.error("Error saving quizzes to database: {}", e.getMessage());
                    // Continue with the fetched quizzes even if saving fails
                }
            } else {
                log.info("No quizzes found in Canvas for course: {} using any method", courseId);
            }
        }

        return quizzes;
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
     * @return The updated setting
     */
    public QuizSebSetting updateSebConfiguration(String quizId, String allowedSites, String externalToolUrl) {
        log.debug("Updating comprehensive SEB configuration for quiz: {}", quizId);

        // Find existing setting or create a new one
        QuizSebSetting setting = sebSettingRepository.findByQuizId(quizId)
                .orElseGet(() -> {
                    QuizSebSetting newSetting = new QuizSebSetting();
                    newSetting.setQuizId(quizId);
                    newSetting.setSebRequired(true); // Enable SEB when configuring
                    return newSetting;
                });

        // Update the comprehensive settings
        setting.setAllowedSites(allowedSites);
        setting.setExternalToolUrl(externalToolUrl);
        setting.setSebRequired(true); // Ensure SEB is enabled

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
}