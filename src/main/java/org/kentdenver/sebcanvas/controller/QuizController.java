package org.kentdenver.sebcanvas.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpSession;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Controller for quiz-related operations.
 * Handles API calls for quiz SEB settings and viewing quizzes.
 */
@Controller
@RequestMapping("/api/quizzes")
@Slf4j
@RequiredArgsConstructor
public class QuizController {

    private final QuizService quizService;
    private final CanvasApiService canvasApiService;

    /**
     * API endpoint to update SEB requirement for a quiz.
     */
    @PutMapping("/{quizId}/seb")
    @ResponseBody
    public ResponseEntity<QuizSebSetting> updateSebRequirement(
            @PathVariable String quizId,
            @RequestBody Map<String, Boolean> requestBody,
            @RequestHeader(value = "X-Auth-Token", required = false) String authToken,
            HttpSession session) {

        // Verify that the user is authorized (should be instructor)
        // Try session-based authentication first
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        log.debug("Session launchData: {}", launchData != null ? "present" : "null");
        log.debug("Auth token header: {}", authToken != null ? "present" : "null");
        log.debug("Session ID: {}", session.getId());

        boolean isAuthorized = false;
        String authMethod = "none";

        if (launchData != null && launchData.isInstructor()) {
            isAuthorized = true;
            authMethod = "session";
            log.debug("User authorized via session - roles: {}", launchData.getRoles());
        } else if (authToken != null) {
            // Try token-based authentication as fallback
            log.debug("Attempting token-based authentication");
            isAuthorized = validateAuthToken(authToken, session);
            authMethod = isAuthorized ? "token" : "invalid-token";
        }

        if (!isAuthorized) {
            log.warn("Unauthorized attempt to update SEB requirement for quiz: {} (method: {}, launchData: {}, token: {})",
                    quizId, authMethod, launchData != null ? "present" : "null", authToken != null ? "present" : "null");
            return ResponseEntity.status(403).build();
        }

        log.info("User authorized via {} to update SEB requirement for quiz: {}", authMethod, quizId);

        boolean required = requestBody.getOrDefault("required", false);
        log.debug("Updating SEB requirement for quiz {} to {}", quizId, required);

        QuizSebSetting setting = quizService.updateSebRequirement(quizId, required);
        return ResponseEntity.ok(setting);
    }

    /**
     * Saves comprehensive SEB configuration including allowed sites and Canvas integration.
     *
     * @param request SEB configuration request
     * @param userId User ID from authentication
     * @return Updated SEB setting
     */
    @PostMapping("/seb-config")
    public ResponseEntity<QuizSebSetting> saveSebConfiguration(
            @RequestBody SebConfigRequest request,
            @RequestParam String userId,
            HttpSession session) {

        log.info("Saving SEB configuration for quiz {} by user {}", request.getQuizId(), userId);

        try {
            // Update comprehensive SEB settings
            QuizSebSetting updatedSetting = quizService.updateSebConfiguration(
                request.getQuizId(),
                request.getAllowedSites(),
                request.getExternalToolUrl()
            );

            // Update Canvas assignment if requested
            if (request.isUpdateCanvas()) {
                LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
                if (launchData != null) {
                    updateCanvasAssignment(launchData.getCourseId(), request.getQuizId(), request.getExternalToolUrl(), userId);
                }
            }

            log.info("Successfully saved SEB configuration for quiz {}", request.getQuizId());
            return ResponseEntity.ok(updatedSetting);

        } catch (Exception e) {
            log.error("Error saving SEB configuration for quiz {}: {}", request.getQuizId(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Updates the Canvas assignment to use external tool.
     */
    private void updateCanvasAssignment(String courseId, String quizId, String externalToolUrl, String userId) {
        try {
            // Find the assignment ID for this quiz
            String assignmentId = canvasApiService.findAssignmentIdForQuiz(courseId, quizId, userId);
            if (assignmentId != null) {
                boolean success = canvasApiService.updateAssignmentToExternalTool(
                    courseId, assignmentId, quizId, externalToolUrl, userId);

                if (success) {
                    log.info("Successfully updated Canvas assignment {} to use external tool", assignmentId);
                } else {
                    log.error("Failed to update Canvas assignment {} to use external tool", assignmentId);
                }
            } else {
                log.warn("No assignment found for quiz {}, cannot update Canvas", quizId);
            }
        } catch (Exception e) {
            log.error("Error updating Canvas assignment for quiz {}: {}", quizId, e.getMessage(), e);
        }
    }

    /**
     * Gets all quizzes for the current course.
     */
    @GetMapping
    @ResponseBody
    public ResponseEntity<List<Quiz>> getQuizzes(HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.warn("Attempted to get quizzes without valid launch data");
            return ResponseEntity.status(403).build();
        }

        String courseId = launchData.getCourseId();
        log.debug("Getting quizzes for course: {}", courseId);

        List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId);
        return ResponseEntity.ok(quizzes);
    }

    /**
     * Gets all SEB settings for quizzes in the current course.
     */
    @GetMapping("/seb-settings")
    @ResponseBody
    public ResponseEntity<Map<String, QuizSebSetting>> getQuizSebSettings(HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.warn("Attempted to get SEB settings without valid launch data");
            return ResponseEntity.status(403).build();
        }

        String courseId = launchData.getCourseId();
        log.debug("Getting SEB settings for course: {}", courseId);

        // Get all quizzes in the course
        List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId);

        // Get SEB settings for each quiz
        Map<String, QuizSebSetting> settings = new HashMap<>();
        for (Quiz quiz : quizzes) {
            QuizSebSetting setting = quizService.getSebSettingForQuiz(quiz.getId());
            if (setting != null) {
                settings.put(quiz.getId(), setting);
            }
        }

        return ResponseEntity.ok(settings);
    }

    /**
     * View endpoint to display all quizzes and their SEB settings.
     */
    @GetMapping("/view")
    public String viewQuizzes(Model model, HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.warn("Attempted to view quizzes without valid launch data");
            return "redirect:/login";
        }

        String courseId = launchData.getCourseId();
        log.debug("Viewing quizzes for course: {}", courseId);

        // Get all quizzes in the course
        List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId);
        model.addAttribute("quizzes", quizzes);

        // Get SEB settings for each quiz
        Map<String, QuizSebSetting> quizSebSettings = quizzes.stream()
                .map(quiz -> quizService.getSebSettingForQuiz(quiz.getId()))
                .filter(setting -> setting != null)
                .collect(Collectors.toMap(QuizSebSetting::getQuizId, setting -> setting));

        model.addAttribute("quizSebSettings", quizSebSettings);
        model.addAttribute("launchData", launchData);

        return "quizzes";
    }

    /**
     * Gets details for a specific quiz.
     */
    @GetMapping("/{quizId}")
    @ResponseBody
    public ResponseEntity<Quiz> getQuiz(@PathVariable String quizId, HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.warn("Attempted to get quiz without valid launch data");
            return ResponseEntity.status(403).build();
        }

        log.debug("Getting details for quiz: {}", quizId);

        Quiz quiz = quizService.getQuiz(quizId);
        if (quiz == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(quiz);
    }

    /**
     * Test endpoint for hybrid authentication - gets quizzes without requiring LTI session.
     * This is for testing the new hybrid authentication system.
     */
    @GetMapping("/test-hybrid")
    @ResponseBody
    public ResponseEntity<List<Quiz>> testHybridAuth(
            @RequestParam String courseId,
            @RequestParam String userId) {

        log.info("Testing hybrid authentication for course: {}, user: {}", courseId, userId);

        try {
            List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId, userId);
            log.info("Successfully retrieved {} quizzes using hybrid authentication", quizzes.size());
            return ResponseEntity.ok(quizzes);
        } catch (Exception e) {
            log.error("Error testing hybrid authentication", e);
            return ResponseEntity.status(500).build();
        }
    }

    /**
     * Validates the authentication token as a fallback for session issues.
     */
    private boolean validateAuthToken(String authToken, HttpSession session) {
        try {
            // Check if token matches the one stored in session
            String sessionToken = (String) session.getAttribute("authToken");
            if (sessionToken != null && sessionToken.equals(authToken)) {
                log.debug("Token validation successful via session match");
                return true;
            }

            // Decode and validate token structure
            String decodedToken = new String(java.util.Base64.getDecoder().decode(authToken));
            String[] parts = decodedToken.split(":");

            if (parts.length == 4) {
                String userId = parts[0];
                String courseId = parts[1];
                String role = parts[2];
                long timestamp = Long.parseLong(parts[3]);

                // Check if token is not too old (1 hour max)
                long currentTime = System.currentTimeMillis();
                if (currentTime - timestamp < 3600000) { // 1 hour
                    boolean isInstructor = "instructor".equals(role);
                    log.debug("Token validation successful - user: {}, course: {}, instructor: {}", userId, courseId, isInstructor);
                    return isInstructor;
                }
            }
        } catch (Exception e) {
            log.debug("Token validation failed: {}", e.getMessage());
        }

        return false;
    }

    /**
     * Request object for SEB configuration.
     */
    public static class SebConfigRequest {
        private String quizId;
        private String allowedSites;
        private String externalToolUrl;
        private boolean updateCanvas;

        // Getters and setters
        public String getQuizId() { return quizId; }
        public void setQuizId(String quizId) { this.quizId = quizId; }

        public String getAllowedSites() { return allowedSites; }
        public void setAllowedSites(String allowedSites) { this.allowedSites = allowedSites; }

        public String getExternalToolUrl() { return externalToolUrl; }
        public void setExternalToolUrl(String externalToolUrl) { this.externalToolUrl = externalToolUrl; }

        public boolean isUpdateCanvas() { return updateCanvas; }
        public void setUpdateCanvas(boolean updateCanvas) { this.updateCanvas = updateCanvas; }
    }
}