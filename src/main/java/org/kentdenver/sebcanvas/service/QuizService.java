package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.QuizRepository;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.util.SebConfigGenerator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
 * Handles quiz retrieval, SEB configuration generation, and enforcing SEB requirements.
 */
@Service
@Slf4j
public class QuizService {

    private final QuizRepository quizRepository;
    private final SebSettingRepository sebSettingRepository;
    private final CanvasService canvasService;
    private final SebConfigGenerator sebConfigGenerator;

    /**
     * Constructor for QuizService with dependency injection.
     *
     * @param quizRepository Repository for quiz data
     * @param sebSettingRepository Repository for SEB settings
     * @param canvasService Service for Canvas API integration
     * @param sebConfigGenerator Utility for generating SEB config files
     */
    @Autowired
    public QuizService(
            QuizRepository quizRepository,
            SebSettingRepository sebSettingRepository,
            CanvasService canvasService,
            SebConfigGenerator sebConfigGenerator) {
        this.quizRepository = quizRepository;
        this.sebSettingRepository = sebSettingRepository;
        this.canvasService = canvasService;
        this.sebConfigGenerator = sebConfigGenerator;
    }

    /**
     * Retrieves all quizzes for a specific course.
     * If not found in the local database, fetches them from Canvas.
     *
     * @param courseId The Canvas course ID
     * @return List of quizzes
     */
    public List<Quiz> getQuizzesForCourse(String courseId) {
        log.debug("Getting quizzes for course: {}", courseId);
        List<Quiz> quizzes = quizRepository.findByCourseId(courseId);

        if (quizzes.isEmpty()) {
            log.debug("No quizzes found in database for course: {}, fetching from Canvas", courseId);
            // In a real implementation, you would pass an access token
            // This would typically be retrieved during the LTI launch
            String accessToken = "dummy_token";
            quizzes = canvasService.getQuizzesForCourse(courseId, accessToken);

            // Save fetched quizzes to database
            if (!quizzes.isEmpty()) {
                quizRepository.saveAll(quizzes);
                log.debug("Saved {} quizzes from Canvas to database", quizzes.size());
            }
        }

        return quizzes;
    }

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

        // Find all SEB settings for these quizzes
        // Note: Since findAllByQuizIdIn might not be implemented, we'll use a workaround
        // In a production environment, you would implement this method in the repository
        List<QuizSebSetting> settings = sebSettingRepository.findAll().stream()
                .filter(setting -> quizIds.contains(setting.getQuizId()))
                .collect(Collectors.toList());

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
     *
     * @param quizId The quiz ID
     * @param required Whether SEB is required
     * @return The updated setting
     */
    @Transactional
    public QuizSebSetting updateSebRequirement(String quizId, boolean required) {
        log.debug("Updating SEB requirement for quiz: {} to {}", quizId, required);

        QuizSebSetting setting = sebSettingRepository.findByQuizId(quizId)
                .orElseGet(() -> {
                    QuizSebSetting newSetting = new QuizSebSetting();
                    newSetting.setQuizId(quizId);
                    return newSetting;
                });

        setting.setSebRequired(required);

        // If enabling SEB, generate a new Browser Exam Key
        if (required && (setting.getBrowserExamKey() == null || setting.getBrowserExamKey().isEmpty())) {
            try {
                String browserExamKey = generateBrowserExamKey();
                setting.setBrowserExamKey(browserExamKey);
                log.debug("Generated new Browser Exam Key for quiz: {}", quizId);
            } catch (NoSuchAlgorithmException e) {
                log.error("Error generating Browser Exam Key for quiz: {}", quizId, e);
            }
        }

        QuizSebSetting savedSetting = sebSettingRepository.save(setting);
        log.debug("Saved SEB setting for quiz: {}", quizId);

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

            // Save the new key if we have a setting
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
}