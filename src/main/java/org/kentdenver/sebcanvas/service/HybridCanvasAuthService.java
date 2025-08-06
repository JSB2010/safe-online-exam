package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.Quiz;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Hybrid Canvas Authentication Service
 * 
 * This service manages authentication with Canvas using a two-key approach:
 * 1. LTI Client ID (252) - For LTI launches and LTI AGS functionality
 * 2. API Client ID (253) - For Canvas REST API access with full scopes
 * 
 * Authentication Strategy:
 * - LTI AGS: Uses LTI client credentials for assignment/grade services
 * - Canvas API: Uses OAuth with dedicated API client for full REST API access
 * - Fallback: If LTI AGS fails, falls back to Canvas API via OAuth
 * 
 * This hybrid approach provides:
 * - Separation of concerns between LTI and API functionality
 * - Maximum compatibility with Canvas institutional settings
 * - Robust fallback mechanisms
 */
@Service
@Slf4j
public class HybridCanvasAuthService {

    private final LtiAgsService ltiAgsService;
    private final OAuthCanvasService oauthCanvasService;
    private final CanvasApiService canvasApiService;

    @Autowired
    public HybridCanvasAuthService(
            LtiAgsService ltiAgsService,
            OAuthCanvasService oauthCanvasService,
            CanvasApiService canvasApiService) {
        this.ltiAgsService = ltiAgsService;
        this.oauthCanvasService = oauthCanvasService;
        this.canvasApiService = canvasApiService;
    }

    /**
     * Attempts to fetch quizzes using the hybrid authentication strategy.
     * 
     * Strategy:
     * 1. Try LTI AGS first (uses LTI client ID 252)
     * 2. If LTI AGS fails, fall back to OAuth Canvas API (uses API client ID 253)
     * 3. If OAuth fails, prompt for re-authorization
     * 
     * @param courseId The Canvas course ID
     * @param userId The Canvas user ID
     * @return List of quizzes or empty list if none found
     */
    public List<Map<String, Object>> getQuizzes(String courseId, String userId) {
        log.info("Fetching quizzes for course {} using hybrid authentication strategy", courseId);

        // Smart course ID resolution: Try to map known course hashes to numeric IDs
        String resolvedCourseId = resolveCourseIdFromKnownMappings(courseId);
        if (!resolvedCourseId.equals(courseId)) {
            log.info("Resolved course ID {} to numeric ID {}", courseId, resolvedCourseId);
            courseId = resolvedCourseId;
        }

        // Strategy 1: Try LTI AGS first
        // NOTE: LTI AGS only returns quizzes configured for gradebook integration
        log.debug("Attempting LTI AGS approach (LTI Client ID 252) - only returns gradebook-integrated quizzes");
        try {
            List<Quiz> agsQuizzes = ltiAgsService.getQuizzesForCourse(courseId, userId);
            if (agsQuizzes != null && !agsQuizzes.isEmpty()) {
                log.info("LTI AGS retrieved {} gradebook-integrated quizzes", agsQuizzes.size());
                // Don't return here - continue to get ALL quizzes from Canvas API
                log.info("Continuing to Canvas API to get ALL quizzes (including non-gradebook ones)");
            } else {
                log.debug("LTI AGS returned no quizzes");
            }
        } catch (Exception e) {
            log.warn("LTI AGS failed: {}, falling back to Canvas API", e.getMessage());
        }

        // Strategy 2: Try CanvasApiService with New Quizzes support
        log.debug("Attempting CanvasApiService with New Quizzes support");
        try {
            List<Quiz> allQuizzes = canvasApiService.getQuizzesForCourse(courseId, userId);
            if (allQuizzes != null && !allQuizzes.isEmpty()) {
                log.info("Successfully retrieved {} quizzes (Classic + New) using CanvasApiService", allQuizzes.size());
                // Convert Quiz objects to raw Map format for consistency
                List<Map<String, Object>> rawQuizzes = allQuizzes.stream()
                        .map(this::convertQuizToMap)
                        .collect(java.util.stream.Collectors.toList());
                return rawQuizzes;
            }
            log.debug("CanvasApiService returned no quizzes, trying OAuth fallback");
        } catch (Exception e) {
            log.warn("CanvasApiService failed: {}, falling back to OAuth Canvas API", e.getMessage());
        }

        // Strategy 3: Fall back to OAuth Canvas API
        log.debug("Attempting OAuth Canvas API approach (API Client ID 253)");
        try {
            List<Map<String, Object>> oauthQuizzes = oauthCanvasService.getQuizzes(courseId, userId);
            if (oauthQuizzes != null && !oauthQuizzes.isEmpty()) {
                log.info("Successfully retrieved {} quizzes using OAuth Canvas API", oauthQuizzes.size());
                return oauthQuizzes;
            }
            log.debug("OAuth Canvas API returned no quizzes");
        } catch (Exception e) {
            log.warn("OAuth Canvas API failed: {}", e.getMessage());
            
            // If it's an authentication error, clear the token to force re-auth
            if (e.getMessage().contains("401") || e.getMessage().contains("Invalid access token")) {
                log.info("Authentication error detected, clearing OAuth token for user {}", userId);
                canvasApiService.clearAccessToken(userId);
            }
        }

        log.info("No quizzes found using any authentication method for course {}", courseId);
        return List.of();
    }

    /**
     * Checks if the user has valid OAuth credentials for Canvas API access.
     * 
     * @param userId The Canvas user ID
     * @return true if user has valid OAuth access, false otherwise
     */
    public boolean hasOAuthAccess(String userId) {
        return canvasApiService.hasAccessToken(userId);
    }

    /**
     * Clears OAuth credentials for a user to force re-authorization.
     * 
     * @param userId The Canvas user ID
     */
    public void clearOAuthAccess(String userId) {
        log.info("Clearing OAuth access for user {}", userId);
        canvasApiService.clearAccessToken(userId);
    }

    /**
     * Gets the authentication status for a user.
     * 
     * @param userId The Canvas user ID
     * @return Map containing authentication status information
     */
    public Map<String, Object> getAuthenticationStatus(String userId) {
        boolean hasOAuth = hasOAuthAccess(userId);
        
        return Map.of(
            "userId", userId,
            "hasOAuthAccess", hasOAuth,
            "ltiAgsAvailable", true, // LTI AGS is always available through LTI launches
            "authenticationStrategy", "hybrid",
            "primaryMethod", "LTI_AGS",
            "fallbackMethod", "OAUTH_API",
            "requiresReauth", !hasOAuth
        );
    }

    /**
     * Generates the OAuth authorization URL for Canvas API access.
     * 
     * @param courseId The course ID to return to after authorization
     * @param userId The user ID for token association
     * @param redirectUrl Optional redirect URL after authorization
     * @return The OAuth authorization URL
     */
    public String getOAuthAuthorizationUrl(String courseId, String userId, String redirectUrl) {
        // This would typically be handled by the OAuth controller
        // but we can provide a helper method to generate the URL
        String baseUrl = "https://canvas-seb-dev-184075650720.us-central1.run.app";
        return String.format("%s/api/oauth2authorize?course_id=%s&user_id=%s%s",
                baseUrl, courseId, userId,
                redirectUrl != null ? "&redirect_url=" + redirectUrl : "");
    }

    /**
     * Validates that both authentication methods are properly configured.
     * 
     * @return Map containing configuration validation results
     */
    public Map<String, Object> validateConfiguration() {
        log.debug("Validating hybrid authentication configuration");
        
        // This would check that both LTI and OAuth configurations are valid
        // For now, we'll return a basic status
        return Map.of(
            "ltiConfigured", true,
            "oauthConfigured", true,
            "hybridMode", true,
            "status", "ready"
        );
    }

    /**
     * Converts a Quiz object to a raw Map format for consistency with OAuth API responses.
     *
     * @param quiz The Quiz object to convert
     * @return Map representation of the quiz
     */
    private Map<String, Object> convertQuizToMap(Quiz quiz) {
        Map<String, Object> quizMap = new HashMap<>();

        quizMap.put("id", quiz.getCanvasQuizId() != null ? quiz.getCanvasQuizId() : quiz.getId());
        quizMap.put("title", quiz.getTitle());
        quizMap.put("description", quiz.getDescription());
        quizMap.put("html_url", quiz.getHtmlUrl());
        quizMap.put("course_id", quiz.getCourseId());

        return quizMap;
    }

    /**
     * Resolves course ID from known mappings of hashes to numeric IDs.
     * This is a workaround for when LTI custom parameters are not configured properly.
     *
     * @param courseId The course ID (hash or numeric)
     * @return The resolved numeric course ID, or the original if no mapping found
     */
    private String resolveCourseIdFromKnownMappings(String courseId) {
        // First try to extract numeric course ID from LTI AGS endpoint if available
        String numericCourseId = extractCourseIdFromLtiAgs(courseId);
        if (numericCourseId != null) {
            return numericCourseId;
        }

        // Fallback to known course ID mappings (hash -> numeric ID)
        // These can be discovered by testing or by examining Canvas course URLs
        Map<String, String> knownMappings = Map.of(
            "fde3df11ccce4acf053a8da564e180fd7a70377f", "11825"  // Mack's Testing Playground
        );

        return knownMappings.getOrDefault(courseId, courseId);
    }

    /**
     * Attempts to extract numeric course ID from LTI AGS endpoint URL.
     * Canvas provides the numeric course ID in the LTI AGS lineitems URL.
     *
     * @param courseId The course ID hash
     * @return The numeric course ID if found, null otherwise
     */
    private String extractCourseIdFromLtiAgs(String courseId) {
        try {
            // Try to get LTI launch data from current session to extract AGS endpoint
            // This is a bit of a hack, but it works when custom parameters aren't available
            HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getRequest();
            HttpSession session = request.getSession(false);

            if (session != null) {
                Object launchDataObj = session.getAttribute("launchData");
                if (launchDataObj instanceof org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData) {
                    org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData launchData =
                        (org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData) launchDataObj;

                    // Extract from AGS endpoint URL pattern: /api/lti/courses/{courseId}/line_items
                    String agsEndpoint = launchData.getAgsLineitemsUrl();
                    if (agsEndpoint != null && agsEndpoint.contains("/courses/")) {
                        String[] parts = agsEndpoint.split("/courses/");
                        if (parts.length > 1) {
                            String[] courseParts = parts[1].split("/");
                            if (courseParts.length > 0) {
                                String extractedCourseId = courseParts[0];
                                log.info("Extracted numeric course ID {} from LTI AGS endpoint for hash {}", extractedCourseId, courseId);
                                return extractedCourseId;
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Could not extract course ID from LTI AGS endpoint: {}", e.getMessage());
        }

        return null;
    }
}
