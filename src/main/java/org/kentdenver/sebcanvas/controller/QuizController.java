package org.kentdenver.sebcanvas.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.dto.StructuredSebConfigRequest;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.model.ModuleItemUpdate;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.DeepLinkModuleService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.ModuleItemService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
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
    private final CanvasApiConfig canvasApiConfig;
    private final CanvasApiService canvasApiService;
    private final ContentService contentService;
    private final ModuleItemService moduleItemService;
    private final DeepLinkModuleService deepLinkModuleService;

    /**
     * API endpoint to refresh quiz data for a course.
     * Clears cache and fetches fresh data from Canvas.
     */
    @PostMapping("/course/{courseId}/refresh")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> refreshQuizzes(
            @PathVariable String courseId,
            @RequestHeader(value = "Authorization", required = false) String authToken,
            HttpSession session) {

        try {
            log.info("Refreshing quiz data for course: {}", courseId);

            String userId = getUserIdFromSession(session);
            if (userId == null) {
                log.warn("Rejecting quiz refresh without an authenticated session for course {}", courseId);
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .body(Map.of("error", "User not authenticated. Please refresh the page or re-launch from Canvas."));
            }

            log.info("Found user ID for refresh: {}", userId);

            // Clear cache and fetch fresh data
            quizService.clearQuizCache(courseId);
            List<Quiz> freshQuizzes = quizService.getQuizzesForCourse(courseId, userId, true);

            log.info("Successfully refreshed {} quizzes for course: {}", freshQuizzes.size(), courseId);

            return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Quiz data refreshed successfully",
                "quizCount", freshQuizzes.size(),
                "quizzes", freshQuizzes.stream().map(quiz -> Map.of(
                    "id", quiz.getId(),
                    "title", quiz.getTitle(),
                    "canvasQuizId", quiz.getCanvasQuizId()
                )).collect(java.util.stream.Collectors.toList())
            ));

        } catch (Exception e) {
            log.error("Error refreshing quizzes for course {}: {}", courseId, e.getMessage(), e);
            return ResponseEntity.status(500)
                .body(Map.of("error", "Failed to refresh quiz data: " + e.getMessage()));
        }
    }

    /**
     * API endpoint to update SEB requirement for a quiz.
     */
    @PutMapping("/{quizId}/seb")
    @ResponseBody
    public ResponseEntity<?> updateSebRequirement(
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

        // Update Canvas assignment when enabling/disabling SEB
        String courseId = null;
        String userId = null;

        if (launchData != null) {
            courseId = launchData.getCourseId();
            userId = launchData.getUserId();
        } else if (authToken != null && "token".equals(authMethod)) {
            // Extract course and user info from token
            try {
                String decodedToken = new String(java.util.Base64.getDecoder().decode(authToken));
                String[] parts = decodedToken.split(":");
                if (parts.length == 4) {
                    userId = parts[0];
                    courseId = parts[1];
                    log.debug("Extracted from token - user: {}, course: {}", userId, courseId);
                }
            } catch (Exception e) {
                log.warn("Failed to extract course/user info from token: {}", e.getMessage());
            }
        }

        if (courseId != null && userId != null) {
            // Check if we have a valid Canvas API access token
            if (!canvasApiService.hasAccessToken(userId)) {
                log.info("No Canvas API access token found for user {}. Requiring OAuth2 authorization.", userId);

                // Return a response indicating OAuth2 authorization is needed
                try {
                    String oauthUrl = "/api/oauth2authorize?course_id=" + courseId + "&user_id=" + userId +
                                     "&redirect_url=" + java.net.URLEncoder.encode("/lti/launch?course_id=" + courseId + "&user_id=" + userId, "UTF-8");

                    return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                            .body(Map.of(
                                "error", "Canvas API authorization required",
                                "oauth_url", oauthUrl,
                                "message", "Please authorize this application to access Canvas API to enable SEB features."
                            ));
                } catch (Exception e) {
                    log.error("Error creating OAuth URL: {}", e.getMessage());
                    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                            .body(Map.of("error", "Failed to create authorization URL"));
                }
            }

            if (required) {
                // Enable SEB: Automatically update module items
                String sebRedirectUrl = generateSebRedirectUrl(quizId);
                setting.setExternalToolUrl(sebRedirectUrl);
                setting = quizService.updateSebConfiguration(quizId, setting.getAllowedSites(), sebRedirectUrl, true);

                log.info("SEB enabled for quiz {} - automatically updating module items", quizId);

                // Automatically find and update module items
                try {
                    log.info("Starting module item search for quiz {} in course {} with user {}", quizId, courseId, userId);
                    List<ModuleItemUpdate> moduleItems = moduleItemService.findModuleItemsForQuiz(courseId, quizId, userId);
                    log.info("Found {} module items for quiz {}", moduleItems.size(), quizId);

                    if (moduleItems.isEmpty()) {
                        log.warn("No module items found for quiz {} - this might be why SEB enforcement isn't working", quizId);
                        setting.setDeepLinkUrl("Warning: No module items found for this quiz. SEB enforcement may not work.");
                    } else {
                        int updatedCount = moduleItemService.updateModuleItemsToSeb(moduleItems, sebRedirectUrl, userId);
                        log.info("Successfully updated {} module items for quiz {}", updatedCount, quizId);
                        setting.setDeepLinkUrl(String.format("Updated %d module items automatically", updatedCount));
                    }
                } catch (Exception e) {
                    log.error("Error updating module items for quiz {}: {}", quizId, e.getMessage(), e);
                    setting.setDeepLinkUrl("Error updating module items: " + e.getMessage());
                }
            } else {
                // Disable SEB: Automatically revert module items
                setting.setSebRequired(false);
                setting = quizService.updateSebConfiguration(quizId, setting.getAllowedSites(), null, false);

                log.info("SEB disabled for quiz {} - automatically reverting module items", quizId);

                // Automatically revert module items
                try {
                    int revertedCount = moduleItemService.revertModuleItemsForQuiz(quizId, userId);

                    log.info("Successfully reverted {} module items for quiz {}", revertedCount, quizId);
                    setting.setDeepLinkUrl(String.format("Reverted %d module items automatically", revertedCount));
                } catch (Exception e) {
                    log.error("Error reverting module items for quiz {}: {}", quizId, e.getMessage(), e);
                    setting.setDeepLinkUrl("Error reverting module items: " + e.getMessage());
                }
            }
        } else {
            log.warn("No course/user information available, cannot update Canvas assignment for quiz {}", quizId);
        }

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

        String sessionUserId = getUserIdFromSession(session);
        if (sessionUserId == null) {
            log.warn("Rejecting SEB configuration save for quiz {} without an authenticated session", request.getQuizId());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (userId != null && !userId.isBlank() && !userId.equals(sessionUserId)) {
            log.warn("Rejecting SEB configuration save for quiz {} due to user mismatch: request={}, session={}",
                    request.getQuizId(), userId, sessionUserId);
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        log.info("Saving SEB configuration for quiz {} by user {}", request.getQuizId(), sessionUserId);

        try {
            // Update comprehensive SEB settings
            QuizSebSetting updatedSetting = quizService.updateSebConfiguration(
                request.getQuizId(),
                request.getAllowedSites(),
                request.getExternalToolUrl(),
                true
            );

            // Note: Canvas module items will be updated via LTI Deep Linking
            log.info("SEB configuration saved - module items will be updated via Deep Linking");

            log.info("Successfully saved SEB configuration for quiz {}", request.getQuizId());
            return ResponseEntity.ok(updatedSetting);

        } catch (Exception e) {
            log.error("Error saving SEB configuration for quiz {}: {}", request.getQuizId(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Saves structured SEB configuration with domain categories.
     *
     * @param request Structured SEB configuration request
     * @param userId User ID from authentication
     * @return Updated SEB setting
     */
    @PostMapping("/seb-config-structured")
    public ResponseEntity<?> saveSebConfigurationStructured(
            @RequestBody StructuredSebConfigRequest request,
            @RequestParam String userId,
            HttpSession session) {

        String targetId = resolveStructuredRequestId(request);

        String sessionUserId = getUserIdFromSession(session);
        if (sessionUserId == null) {
            log.warn("Rejecting structured SEB configuration save for {} without an authenticated session", targetId);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (userId != null && !userId.isBlank() && !userId.equals(sessionUserId)) {
            log.warn("Rejecting structured SEB configuration save for {} due to user mismatch: request={}, session={}",
                    targetId, userId, sessionUserId);
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        log.info("Saving structured SEB configuration for {} by user {}", targetId, sessionUserId);

        try {
            if (isNewQuizContentId(targetId)) {
                String[] parsedContentId = parseNewQuizContentId(targetId);
                if (parsedContentId == null) {
                    return ResponseEntity.badRequest().body(Map.of("error", "Invalid New Quiz content ID"));
                }

                ContentSebSetting setting = getOrCreateNewQuizSetting(targetId, parsedContentId[0], parsedContentId[1]);
                setting.setSsoDomains(request.getSsoDomains() != null ? request.getSsoDomains() : List.of());
                setting.setEducationalToolDomains(request.getEducationalToolDomains() != null ? request.getEducationalToolDomains() : List.of());
                setting.setCustomDomains(request.getCustomDomains() != null ? request.getCustomDomains() : List.of());
                setting.setExternalToolUrl(request.getExternalToolUrl());
                setting.setQuitPassword(normalizeBlank(request.getQuitPassword()));
                setting.setSebRequired(true);

                if (setting.getBrowserExamKey() == null || setting.getBrowserExamKey().isBlank()) {
                    setting.setBrowserExamKey(generateBrowserExamKey());
                }

                ContentSebSetting updatedSetting = contentService.saveSebSetting(setting);
                log.info("Successfully saved structured SEB configuration for {}", targetId);
                return ResponseEntity.ok(updatedSetting);
            }

            // Update structured SEB settings
            QuizSebSetting updatedSetting = quizService.updateSebConfigurationStructured(
                request.getQuizId(),
                request.getSsoDomains(),
                request.getEducationalToolDomains(),
                request.getCustomDomains(),
                request.getExternalToolUrl(),
                true,
                request.getQuitPassword()
            );

            log.info("Successfully saved structured SEB configuration for quiz {}", request.getQuizId());
            return ResponseEntity.ok(updatedSetting);

        } catch (Exception e) {
            log.error("Error saving structured SEB configuration for {}: {}", targetId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
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

    /**
     * Generates the SEB redirect URL for a quiz.
     * Format: https://our-service.com/seb/redirect/{quizId}
     */
    private String generateSebRedirectUrl(String quizId) {
        String baseUrl = canvasApiConfig.getApplicationBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("Application base URL is not configured");
        }
        return String.format("%s/seb/redirect/%s", baseUrl, quizId);
    }

    private String generateSebLaunchUrl(String contentId) {
        String baseUrl = canvasApiConfig.getApplicationBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("Application base URL is not configured");
        }
        return String.format("%s/seb/launch/%s", baseUrl, contentId);
    }

    /**
     * Extracts user ID from auth token.
     */
    private String extractUserIdFromToken(String authToken) {
        try {
            // Remove "Bearer " prefix if present
            if (authToken.startsWith("Bearer ")) {
                authToken = authToken.substring(7);
            }

            // Decode and validate token structure
            String decodedToken = new String(java.util.Base64.getDecoder().decode(authToken));
            String[] parts = decodedToken.split(":");

            if (parts.length >= 2) {
                String userId = parts[0];
                log.debug("Extracted user ID from token: {}", userId);
                return userId;
            }
        } catch (Exception e) {
            log.debug("Failed to extract user ID from token: {}", e.getMessage());
        }

        return null;
    }

    /**
     * Extracts user ID from session.
     */
    private String getUserIdFromSession(HttpSession session) {
        try {
            log.debug("Session ID: {}", session.getId());
            log.debug("Session creation time: {}", new java.util.Date(session.getCreationTime()));
            log.debug("Session last accessed: {}", new java.util.Date(session.getLastAccessedTime()));

            LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
            if (launchData != null && launchData.getUserId() != null) {
                log.debug("Found user ID from launchData: {}", launchData.getUserId());
                return launchData.getUserId();
            }

            // Try to get user ID from LTI launch data in session
            LtiLaunchData ltiData = (LtiLaunchData) session.getAttribute("ltiLaunchData");
            if (ltiData != null && ltiData.getUserId() != null) {
                log.debug("Found user ID from LTI launch data: {}", ltiData.getUserId());
                return ltiData.getUserId();
            }

            // Fallback to direct session attributes (try multiple possible keys)
            String userId = (String) session.getAttribute("userId");
            if (userId != null) {
                log.debug("Found user ID from 'userId' attribute: {}", userId);
                return userId;
            }

            userId = (String) session.getAttribute("canvas_user_id");
            if (userId != null) {
                log.debug("Found user ID from 'canvas_user_id' attribute: {}", userId);
                return userId;
            }

            userId = (String) session.getAttribute("user_id");
            if (userId != null) {
                log.debug("Found user ID from 'user_id' attribute: {}", userId);
                return userId;
            }

            // Debug: List all session attributes
            java.util.Enumeration<String> attributeNames = session.getAttributeNames();
            log.debug("All session attributes:");
            while (attributeNames.hasMoreElements()) {
                String name = attributeNames.nextElement();
                Object value = session.getAttribute(name);
                log.debug("  {} = {}", name, value);
            }

            log.debug("No user ID found in session");
            return null;

        } catch (Exception e) {
            log.debug("Failed to extract user ID from session: {}", e.getMessage());
            return null;
        }
    }

    /**
     * API endpoint to enable SEB with access code enforcement for a quiz.
     */
    @PostMapping("/{courseId}/{quizId}/seb/enable")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> enableSebWithAccessCode(
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestBody(required = false) Map<String, Object> customSettings,
            HttpSession session) {

        Map<String, Object> response = new HashMap<>();

        try {
            // Get user ID from session
            String userId = getUserIdFromSession(session);
            if (userId == null) {
                response.put("success", false);
                response.put("message", "User not authenticated. Please refresh the page or re-launch from Canvas.");
                response.put("error_code", "NO_USER_SESSION");
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
            }

            if (isNewQuizContentId(quizId)) {
                String[] parsedContentId = parseNewQuizContentId(quizId);
                if (parsedContentId == null) {
                    response.put("success", false);
                    response.put("message", "Invalid New Quiz content ID");
                    return ResponseEntity.badRequest().body(response);
                }

                String effectiveCourseId = resolveCourseId(courseId, parsedContentId[0], quizId);
                String assignmentId = parsedContentId[1];
                String sebLaunchUrl = generateSebLaunchUrl(quizId);
                String accessCode = generateSecureAccessCode();
                boolean success = canvasApiService.setNewQuizAccessCode(effectiveCourseId, assignmentId, accessCode, userId);

                if (success) {
                    ContentSebSetting setting = getOrCreateNewQuizSetting(quizId, effectiveCourseId, assignmentId);
                    setting.setSebRequired(true);
                    setting.setEnabled(true);
                    setting.setAccessCode(accessCode);
                    setting.setConfigKey(null);
                    setting.setExternalToolUrl(sebLaunchUrl);
                    if (setting.getBrowserExamKey() == null || setting.getBrowserExamKey().isBlank()) {
                        setting.setBrowserExamKey(generateBrowserExamKey());
                    }
                    ContentSebSetting savedSetting = contentService.saveSebSetting(setting);
                    boolean moduleUpdated = deepLinkModuleService.createOrUpdateModuleItemForContent(
                            effectiveCourseId,
                            buildNewQuizContentItem(quizId, effectiveCourseId, assignmentId, savedSetting),
                            userId,
                            true);

                    response.put("success", true);
                    response.put("message", "SEB enabled successfully with access code enforcement");
                    response.put("moduleItemUpdated", moduleUpdated);
                    if (!moduleUpdated) {
                        response.put("moduleItemNote", "New Quiz must be added to a module first");
                    }
                    log.info("SEB enabled for New Quiz {} in course {} by user {}", quizId, effectiveCourseId, userId);
                } else {
                    String accessToken = canvasApiService.getAccessToken(userId);
                    if (accessToken == null || accessToken.isEmpty()) {
                        response.put("success", false);
                        response.put("message", "Canvas authorization required. Please click 'Authorize Canvas Access' to re-authorize.");
                        response.put("requiresAuth", true);
                        response.put("authUrl", "/api/oauth2authorize?course_id=" + effectiveCourseId + "&user_id=" + userId);
                    } else {
                        response.put("success", false);
                        response.put("message", "Failed to enable SEB");
                    }
                }

                return ResponseEntity.ok(response);
            }

            // Enable SEB with access code
            boolean success = quizService.enableSebWithAccessCode(courseId, quizId, userId, customSettings);

            if (success) {
                // Automatically update module items using Deep Linking approach
                Quiz quiz = quizService.getQuiz(quizId);
                if (quiz != null) {
                    boolean moduleUpdated = deepLinkModuleService.createOrUpdateModuleItemForQuiz(
                            courseId, quiz, userId, true);

                    if (moduleUpdated) {
                        log.info("Successfully updated module item to LTI link for quiz {}", quizId);
                        response.put("moduleItemUpdated", true);
                    } else {
                        log.warn("Could not update module item for quiz {} - may not exist in modules yet", quizId);
                        response.put("moduleItemUpdated", false);
                        response.put("moduleItemNote", "Quiz must be added to a module first");
                    }
                }

                response.put("success", true);
                response.put("message", "SEB enabled successfully with access code enforcement");
                log.info("SEB enabled for quiz {} in course {} by user {}", quizId, courseId, userId);
            } else {
                // Check if this is an OAuth token issue
                String accessToken = canvasApiService.getAccessToken(userId);
                if (accessToken == null || accessToken.isEmpty()) {
                    response.put("success", false);
                    response.put("message", "Canvas authorization required. Please click 'Authorize Canvas Access' to re-authorize.");
                    response.put("requiresAuth", true);
                    response.put("authUrl", "/api/oauth2authorize?course_id=" + courseId + "&user_id=" + userId);
                } else {
                    response.put("success", false);
                    response.put("message", "Failed to enable SEB");
                }
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Error enabling SEB for quiz {}: {}", quizId, e.getMessage(), e);
            response.put("success", false);
            response.put("message", "Error enabling SEB: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    /**
     * API endpoint to disable SEB for a quiz.
     */
    @PostMapping("/{courseId}/{quizId}/seb/disable")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> disableSebWithAccessCode(
            @PathVariable String courseId,
            @PathVariable String quizId,
            HttpSession session) {

        Map<String, Object> response = new HashMap<>();

        try {
            // Get user ID from session
            String userId = getUserIdFromSession(session);
            if (userId == null) {
                response.put("success", false);
                response.put("message", "User not authenticated. Please refresh the page or re-launch from Canvas.");
                response.put("error_code", "NO_USER_SESSION");
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
            }

            if (isNewQuizContentId(quizId)) {
                String[] parsedContentId = parseNewQuizContentId(quizId);
                if (parsedContentId == null) {
                    response.put("success", false);
                    response.put("message", "Invalid New Quiz content ID");
                    return ResponseEntity.badRequest().body(response);
                }

                String effectiveCourseId = resolveCourseId(courseId, parsedContentId[0], quizId);
                String assignmentId = parsedContentId[1];
                ContentSebSetting setting = contentService.getSebSetting(quizId);
                boolean hasAccessCode = setting != null && setting.getAccessCode() != null && !setting.getAccessCode().isBlank();
                boolean success = !hasAccessCode || canvasApiService.removeNewQuizAccessCode(effectiveCourseId, assignmentId, userId);

                if (success) {
                    if (setting != null) {
                        setting.setSebRequired(false);
                        setting.setEnabled(false);
                        setting.setAccessCode(null);
                        setting.setConfigKey(null);
                        setting.setExternalToolUrl(null);
                        ContentSebSetting savedSetting = contentService.saveSebSetting(setting);
                        boolean moduleRestored = deepLinkModuleService.createOrUpdateModuleItemForContent(
                                effectiveCourseId,
                                buildNewQuizContentItem(quizId, effectiveCourseId, assignmentId, savedSetting),
                                userId,
                                false);
                        response.put("moduleItemRestored", moduleRestored);
                    }

                    response.put("success", true);
                    response.put("message", "SEB disabled successfully");
                    log.info("SEB disabled for New Quiz {} in course {} by user {}", quizId, effectiveCourseId, userId);
                } else {
                    String accessToken = canvasApiService.getAccessToken(userId);
                    if (accessToken == null || accessToken.isEmpty()) {
                        response.put("success", false);
                        response.put("message", "Canvas authorization required. Please click 'Authorize Canvas Access' to re-authorize.");
                        response.put("requiresAuth", true);
                        response.put("authUrl", "/api/oauth2authorize?course_id=" + effectiveCourseId + "&user_id=" + userId);
                    } else {
                        response.put("success", false);
                        response.put("message", "Failed to disable SEB");
                    }
                }

                return ResponseEntity.ok(response);
            }

            // Disable SEB
            boolean success = quizService.disableSebWithAccessCode(courseId, quizId, userId);

            if (success) {
                // Restore module items to direct Canvas links
                Quiz quiz = quizService.getQuiz(quizId);
                if (quiz != null) {
                    boolean moduleRestored = deepLinkModuleService.createOrUpdateModuleItemForQuiz(
                            courseId, quiz, userId, false);

                    if (moduleRestored) {
                        log.info("Successfully restored module item to direct link for quiz {}", quizId);
                        response.put("moduleItemRestored", true);
                    } else {
                        log.warn("Could not restore module item for quiz {}", quizId);
                        response.put("moduleItemRestored", false);
                    }
                }

                response.put("success", true);
                response.put("message", "SEB disabled successfully");
                log.info("SEB disabled for quiz {} in course {} by user {}", quizId, courseId, userId);
            } else {
                // Check if this is an OAuth token issue
                String accessToken = canvasApiService.getAccessToken(userId);
                if (accessToken == null || accessToken.isEmpty()) {
                    response.put("success", false);
                    response.put("message", "Canvas authorization required. Please click 'Authorize Canvas Access' to re-authorize.");
                    response.put("requiresAuth", true);
                    response.put("authUrl", "/api/oauth2authorize?course_id=" + courseId + "&user_id=" + userId);
                } else {
                    response.put("success", false);
                    response.put("message", "Failed to disable SEB");
                }
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Error disabling SEB for quiz {}: {}", quizId, e.getMessage(), e);
            response.put("success", false);
            response.put("message", "Error disabling SEB: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    /**
     * API endpoint to download SEB configuration file for a quiz.
     */
    @GetMapping("/{courseId}/{quizId}/seb/config")
    public ResponseEntity<?> downloadSebConfig(
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestParam(required = false) Map<String, Object> customSettings,
            HttpSession session) {

        try {
            // Get user ID from session
            String userId = getUserIdFromSession(session);
            if (userId == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }

            return ResponseEntity.status(HttpStatus.FOUND)
                    .header("Location", "/seb/config/" + courseId + "/" + quizId + ".seb")
                    .build();

        } catch (Exception e) {
            log.error("Error generating SEB config file for quiz {}: {}", quizId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Rotates the Canvas access code and invalidates the previously downloaded SEB configuration.
     */
    @PostMapping("/{courseId}/{quizId}/seb/regenerate-code")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> regenerateSebAccessCode(
            @PathVariable String courseId,
            @PathVariable String quizId,
            HttpSession session) {

        Map<String, Object> response = new HashMap<>();
        String userId = getUserIdFromSession(session);
        if (userId == null) {
            response.put("success", false);
            response.put("message", "User not authenticated. Please refresh the page or re-launch from Canvas.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
        }

        try {
            String accessCode = generateSecureAccessCode();

            if (isNewQuizContentId(quizId)) {
                String[] parsedContentId = parseNewQuizContentId(quizId);
                if (parsedContentId == null) {
                    response.put("success", false);
                    response.put("message", "Invalid New Quiz content ID");
                    return ResponseEntity.badRequest().body(response);
                }

                String effectiveCourseId = resolveCourseId(courseId, parsedContentId[0], quizId);
                String assignmentId = parsedContentId[1];
                ContentSebSetting setting = contentService.getSebSetting(quizId);
                if (setting == null || !setting.isSebRequired()) {
                    response.put("success", false);
                    response.put("message", "SEB is not enabled for this quiz");
                    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
                }

                if (!canvasApiService.setNewQuizAccessCode(effectiveCourseId, assignmentId, accessCode, userId)) {
                    response.put("success", false);
                    response.put("message", "Failed to update Canvas access code");
                    return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(response);
                }

                setting.setAccessCode(accessCode);
                setting.setConfigKey(null);
                contentService.saveSebSetting(setting);
            } else {
                QuizSebSetting setting = quizService.getSebSettingForQuiz(quizId);
                if (setting == null || !setting.isSebRequired()) {
                    response.put("success", false);
                    response.put("message", "SEB is not enabled for this quiz");
                    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
                }

                if (!canvasApiService.setQuizAccessCode(courseId, quizId, accessCode, userId)) {
                    response.put("success", false);
                    response.put("message", "Failed to update Canvas access code");
                    return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(response);
                }

                setting.setAccessCode(accessCode);
                setting.setConfigKey(null);
                quizService.saveSebSetting(setting);
            }

            response.put("success", true);
            response.put("message", "SEB access code regenerated. Students must download a fresh configuration file.");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error regenerating SEB access code for quiz {}: {}", quizId, e.getMessage(), e);
            response.put("success", false);
            response.put("message", "Error regenerating access code: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    /**
     * API endpoint to check SEB configuration status for a quiz.
     */
    @GetMapping("/{courseId}/{quizId}/seb/status")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> getSebStatus(
            @PathVariable String courseId,
            @PathVariable String quizId,
            HttpSession session) {

        Map<String, Object> response = new HashMap<>();

        try {
            // Get user ID from session
            String userId = getUserIdFromSession(session);
            if (userId == null) {
                response.put("authenticated", false);
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
            }

            if (isNewQuizContentId(quizId)) {
                ContentSebSetting sebSetting = contentService.getSebSetting(quizId);
                response.put("authenticated", true);
                response.put("canvasDomain", normalizeCanvasDomain());
                response.put("sebEnabled", sebSetting != null && sebSetting.isSebRequired());
                response.put("hasAccessCode", sebSetting != null && sebSetting.getAccessCode() != null && !sebSetting.getAccessCode().isBlank());
                response.put("configValid", sebSetting != null
                        && sebSetting.isSebRequired()
                        && sebSetting.getAccessCode() != null
                        && !sebSetting.getAccessCode().isBlank());

                if (sebSetting != null) {
                    response.put("ssoDomains", sebSetting.getSsoDomains());
                    response.put("educationalToolDomains", sebSetting.getEducationalToolDomains());
                    response.put("customDomains", sebSetting.getCustomDomains());
                }

                return ResponseEntity.ok(response);
            }

            // Get SEB setting for quiz
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);

            response.put("authenticated", true);
            response.put("sebEnabled", sebSetting != null && sebSetting.isSebRequired());
            response.put("hasAccessCode", sebSetting != null && sebSetting.getAccessCode() != null);
            response.put("configValid", quizService.validateSebConfiguration(quizId));

            if (sebSetting != null) {
                response.put("canvasDomain", sebSetting.getCanvasDomain());
                response.put("ssoDomains", sebSetting.getSsoDomains());
                response.put("educationalToolDomains", sebSetting.getEducationalToolDomains());
                response.put("customDomains", sebSetting.getCustomDomains());

                // Legacy support
                response.put("allowedSites", sebSetting.getAllowedSites());
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Error getting SEB status for quiz {}: {}", quizId, e.getMessage(), e);
            response.put("error", "Error getting SEB status: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    private String resolveStructuredRequestId(StructuredSebConfigRequest request) {
        if (request.getContentId() != null && !request.getContentId().isBlank()) {
            return request.getContentId();
        }
        return request.getQuizId();
    }

    private boolean isNewQuizContentId(String identifier) {
        return identifier != null && identifier.startsWith("newquiz:");
    }

    private String[] parseNewQuizContentId(String contentId) {
        if (!isNewQuizContentId(contentId)) {
            return null;
        }

        String[] parts = contentId.split(":", 3);
        if (parts.length != 3 || parts[1].isBlank() || parts[2].isBlank()) {
            return null;
        }

        return new String[]{parts[1], parts[2]};
    }

    private String resolveCourseId(String pathCourseId, String contentCourseId, String contentId) {
        if (pathCourseId != null && contentCourseId != null && !pathCourseId.equals(contentCourseId)) {
            log.warn("Course mismatch for {}: path={}, contentId={}", contentId, pathCourseId, contentCourseId);
        }
        return pathCourseId != null && !pathCourseId.isBlank() ? pathCourseId : contentCourseId;
    }

    private ContentSebSetting getOrCreateNewQuizSetting(String contentId, String courseId, String assignmentId) {
        ContentSebSetting existingSetting = contentService.getSebSetting(contentId);
        if (existingSetting != null) {
            if (existingSetting.getId() == null || existingSetting.getId().isBlank()) {
                existingSetting.setId(contentId);
            }
            if (existingSetting.getContentId() == null || existingSetting.getContentId().isBlank()) {
                existingSetting.setContentId(contentId);
            }
            if (existingSetting.getCourseId() == null || existingSetting.getCourseId().isBlank()) {
                existingSetting.setCourseId(courseId);
            }
            if (existingSetting.getAssignmentId() == null || existingSetting.getAssignmentId().isBlank()) {
                existingSetting.setAssignmentId(assignmentId);
            }
            if (existingSetting.getCanvasId() == null || existingSetting.getCanvasId().isBlank()) {
                existingSetting.setCanvasId(assignmentId);
            }
            if (existingSetting.getContentType() == null) {
                existingSetting.setContentType(ContentItem.ContentType.NEW_QUIZ);
            }
            if (existingSetting.getHtmlUrl() == null || existingSetting.getHtmlUrl().isBlank()) {
                existingSetting.setHtmlUrl(buildCanvasAssignmentUrl(courseId, assignmentId));
            }
            return existingSetting;
        }

        ContentItem contentItem = contentService.getContentItem(contentId);
        if (contentItem != null) {
            return ContentSebSetting.fromContentItem(contentItem);
        }

        ContentSebSetting setting = new ContentSebSetting();
        setting.setId(contentId);
        setting.setContentId(contentId);
        setting.setCourseId(courseId);
        setting.setCanvasId(assignmentId);
        setting.setAssignmentId(assignmentId);
        setting.setContentType(ContentItem.ContentType.NEW_QUIZ);
        setting.setHtmlUrl(buildCanvasAssignmentUrl(courseId, assignmentId));
        return setting;
    }

    private ContentItem buildNewQuizContentItem(String contentId,
                                                String courseId,
                                                String assignmentId,
                                                ContentSebSetting setting) {
        ContentItem contentItem = contentService.getContentItem(contentId);
        if (contentItem != null) {
            if (contentItem.getCanvasId() == null || contentItem.getCanvasId().isBlank()) {
                contentItem.setCanvasId(assignmentId);
            }
            if (contentItem.getAssignmentId() == null || contentItem.getAssignmentId().isBlank()) {
                contentItem.setAssignmentId(assignmentId);
            }
            if (contentItem.getCourseId() == null || contentItem.getCourseId().isBlank()) {
                contentItem.setCourseId(courseId);
            }
            return contentItem;
        }

        ContentItem fallback = new ContentItem();
        fallback.setId(contentId);
        fallback.setCourseId(courseId);
        fallback.setCanvasId(assignmentId);
        fallback.setAssignmentId(assignmentId);
        fallback.setContentType(ContentItem.ContentType.NEW_QUIZ);
        fallback.setTitle("New Quiz");
        if (setting != null) {
            fallback.setHtmlUrl(setting.getHtmlUrl());
            fallback.setCanvasLaunchUrl(setting.getCanvasLaunchUrl());
            fallback.setExternalToolUrl(setting.getExternalToolUrl());
        }
        return fallback;
    }

    private String buildCanvasAssignmentUrl(String courseId, String assignmentId) {
        try {
            String canvasDomain = canvasApiConfig.getCanvasDomain();
            if (canvasDomain == null || canvasDomain.isBlank()) {
                return null;
            }

            String canvasBaseUrl = canvasDomain.replaceAll("/+$", "");
            if (!canvasBaseUrl.startsWith("http://") && !canvasBaseUrl.startsWith("https://")) {
                canvasBaseUrl = "https://" + canvasBaseUrl;
            }

            return String.format("%s/courses/%s/assignments/%s", canvasBaseUrl, courseId, assignmentId);
        } catch (Exception e) {
            log.warn("Could not build Canvas assignment URL for course {} assignment {}: {}",
                    courseId, assignmentId, e.getMessage());
            return null;
        }
    }

    private String normalizeBlank(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private String normalizeCanvasDomain() {
        String canvasDomain = canvasApiConfig.getCanvasDomain();
        if (canvasDomain == null || canvasDomain.isBlank()) {
            return null;
        }
        return canvasDomain.replace("https://", "").replace("http://", "");
    }

    private String generateSecureAccessCode() {
        SecureRandom random = new SecureRandom();
        StringBuilder accessCode = new StringBuilder();
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        for (int i = 0; i < 16; i++) {
            accessCode.append(chars.charAt(random.nextInt(chars.length())));
        }
        return accessCode.toString();
    }

    private String generateBrowserExamKey() {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String randomStr = "SEB" + java.util.UUID.randomUUID() + System.currentTimeMillis();
            byte[] encodedHash = digest.digest(randomStr.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(encodedHash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("Unable to generate Browser Exam Key", e);
        }
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
}
