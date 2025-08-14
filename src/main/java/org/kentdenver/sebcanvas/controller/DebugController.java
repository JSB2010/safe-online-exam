package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.kentdenver.sebcanvas.service.CanvasScopesService;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.JwkService;
import org.kentdenver.sebcanvas.service.ApiSecurityService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.ui.Model;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;

/**
 * Diagnostic controller for Canvas LTI integration issues.
 * Provides endpoints to identify and resolve OAuth scopes and JWT token issues.
 * This controller should be disabled or properly secured in production environments.
 */
@RestController
@RequestMapping({"/api/debug", "/api/diagnostic"})
@Slf4j
public class DebugController {

    private final CanvasScopesService canvasScopesService;
    private final CanvasService canvasService;
    private final CanvasApiService canvasApiService; // Direct reference to API service for specific methods
    private final JwkService jwkService;
    private final LtiConfig ltiConfig;
    private final RestTemplate restTemplate;
    private final ApiSecurityService apiSecurityService;

    @Autowired
    public DebugController(
            CanvasScopesService canvasScopesService,
            @Qualifier("canvasApiService") CanvasService canvasService,
            CanvasApiService canvasApiService,
            JwkService jwkService,
            LtiConfig ltiConfig,
            RestTemplate restTemplate,
            ApiSecurityService apiSecurityService) {
        this.canvasScopesService = canvasScopesService;
        this.canvasService = canvasService;
        this.canvasApiService = canvasApiService;
        this.jwkService = jwkService;
        this.ltiConfig = ltiConfig;
        this.restTemplate = restTemplate;
        this.apiSecurityService = apiSecurityService;

        log.warn("DebugController initialized - THIS SHOULD BE SECURED IN PRODUCTION");
    }

    @GetMapping({"/scopes/search", "/api/scopes/search"})
    public ResponseEntity<List<CanvasScopesService.CanvasScope>> searchScopesMultiPath(
            @RequestParam(required = false) String resource,
            @RequestParam(required = false) String verb) {
        return searchScopes(resource, verb);
    }

    /**
     * Retrieves all available Canvas API scopes.
     * Use this to identify which scopes are actually available in your Canvas instance.
     */
    @GetMapping("/scopes")
    public ResponseEntity<List<CanvasScopesService.CanvasScope>> getAllScopes() {
        try {
            log.info("Fetching all available scopes from Canvas");
            List<CanvasScopesService.CanvasScope> scopes = canvasScopesService.getScopes("self");
            log.info("Retrieved {} scopes from Canvas", scopes.size());
            return ResponseEntity.ok(scopes);
        } catch (Exception e) {
            log.error("Error getting scopes from Canvas", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Collections.emptyList());
        }
    }

    /**
     * Searches for specific scopes based on resource name and HTTP verb.
     * Useful for finding quiz-related or course-related scopes.
     */
    @GetMapping("/scopes/search")
    public ResponseEntity<List<CanvasScopesService.CanvasScope>> searchScopes(
            @RequestParam(required = false) String resource,
            @RequestParam(required = false) String verb) {
        try {
            log.info("Searching for scopes with resource: {}, verb: {}", resource, verb);
            List<CanvasScopesService.CanvasScope> scopes = canvasScopesService.searchScopes(resource, verb, "self");
            log.info("Found {} matching scopes", scopes.size());
            return ResponseEntity.ok(scopes);
        } catch (Exception e) {
            log.error("Error searching scopes", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Collections.emptyList());
        }
    }

    /**
     * Returns the recommended scopes for quiz access based on your Canvas instance.
     * These are the scopes that your application should be using.
     */
    @GetMapping("/scopes/recommended")
    public ResponseEntity<List<String>> getRecommendedScopes() {
        try {
            log.info("Getting recommended scopes for quiz access");
            List<String> scopes = canvasScopesService.getRecommendedQuizScopes();
            log.info("Recommended scopes: {}", scopes);
            return ResponseEntity.ok(scopes);
        } catch (Exception e) {
            log.error("Error getting recommended scopes", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Collections.emptyList());
        }
    }

    /**
     * Clears the scope and token caches to force fetching fresh data.
     * Use this after updating Developer Key settings in Canvas.
     */
    @PostMapping("/scopes/clear-cache")
    public ResponseEntity<Map<String, String>> clearScopeCache() {
        try {
            log.info("Clearing scope cache");
            canvasScopesService.clearCache();
            log.info("Scope cache cleared successfully");

            // Also clear token cache to force new token acquisition
            canvasService.clearCredentials(null);
            log.info("Token cache cleared successfully");

            Map<String, String> response = new HashMap<>();
            response.put("status", "success");
            response.put("message", "Scope and token caches cleared successfully");

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error clearing caches", e);

            Map<String, String> response = new HashMap<>();
            response.put("status", "error");
            response.put("message", "Error clearing caches: " + e.getMessage());

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(response);
        }
    }

    /**
     * Debugs JWT token creation for Canvas authentication.
     * Checks if the issuer URL, client ID, and audience are correct.
     */
    @GetMapping("/jwt")
    public ResponseEntity<Map<String, String>> debugJwt() {
        try {
            log.info("Debugging JWT creation");

            // Get configuration details
            String toolUrl = ltiConfig.getSanitizedToolUrl();
            String tokenUrl = ltiConfig.getTokenUrl();
            String clientId = ltiConfig.getClientId();

            // Log details for debugging
            log.info("JWT Creation Parameters:");
            log.info(" - Client ID: {}", clientId);
            log.info(" - Tool URL (Issuer): {}", toolUrl);
            log.info(" - Token URL (Audience): {}", tokenUrl);

            // Create a signed JWT for testing
            String jwt = jwkService.createSignedJwt(clientId, toolUrl, tokenUrl);

            // Log success
            log.info("Successfully created JWT of length: {}", jwt.length());

            // Return the JWT details
            Map<String, String> result = new HashMap<>();
            result.put("jwt", jwt);
            result.put("clientId", clientId);
            result.put("issuer", toolUrl);
            result.put("audience", tokenUrl);

            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Error creating JWT", e);

            Map<String, String> result = new HashMap<>();
            result.put("error", e.getMessage());
            result.put("stackTrace", Arrays.toString(e.getStackTrace()));

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(result);
        }
    }

    /**
     * Tests token acquisition with all supported scopes.
     * This helps identify which scopes are working with your Developer Key.
     */
    @GetMapping("/test-scopes")
    public ResponseEntity<Map<String, Object>> testAllScopes() {
        try {
            log.info("Testing token acquisition with all supported scopes");

            Map<String, Object> results = new HashMap<>();
            Map<String, Object> scopeResults = new HashMap<>();

            // Get the list of scopes to test
            List<String> scopesToTest = new ArrayList<>();

            // Add recommended scopes
            List<String> recommendedScopes = canvasScopesService.getRecommendedQuizScopes();
            scopesToTest.addAll(recommendedScopes);

            // Add standard scopes from CanvasService
            String[] standardScopes = {
                    "url:GET|/api/v1/courses/:course_id/quizzes",
                    "url:GET|/api/v1/courses/:course_id/modules",
                    "url:GET|/api/v1/courses/:course_id/modules/:module_id/items",
                    "url:PUT|/api/v1/courses/:course_id/modules/:module_id/items/:id",
                    "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
                    "https://purl.imsglobal.org/spec/lti-ags/scope/score",
                    "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly",
                    "https://canvas.instructure.com/lti-ags/scope/lineitem",
                    "https://canvas.instructure.com/lti-ags/scope/score",
                    "https://canvas.instructure.com/lti-nrps/scope/contextmembership.readonly",
                    "url:GET|/api/v1/courses/:course_id",
                    "url:GET|/api/v1/courses",
                    "https://canvas.instructure.com/lti/scopes/api",
                    "https://www.instructure.com/lti/scopes/api"
            };

            // Add any scopes that aren't already in the list
            for (String scope : standardScopes) {
                if (!scopesToTest.contains(scope)) {
                    scopesToTest.add(scope);
                }
            }

            // Test each scope
            for (String scope : scopesToTest) {
                try {
                    log.info("Testing scope: {}", scope);

                    // Get tool URL (issuer) and client ID
                    String toolUrl = ltiConfig.getSanitizedToolUrl();
                    String clientId = ltiConfig.getClientId();

                    // Create a signed JWT
                    String jwt = jwkService.createSignedJwt(clientId, toolUrl, ltiConfig.getTokenUrl());

                    // Try to get a token with this scope
                    Map<String, Object> tokenResult = testScope(jwt, scope);

                    // Store the result
                    scopeResults.put(scope, tokenResult);

                    if (tokenResult.containsKey("access_token")) {
                        log.info("Successfully obtained token with scope: {}", scope);
                    } else {
                        log.warn("Failed to obtain token with scope: {}", scope);
                    }
                } catch (Exception e) {
                    log.error("Error testing scope: {}", scope, e);
                    Map<String, Object> error = new HashMap<>();
                    error.put("error", e.getMessage());
                    scopeResults.put(scope, error);
                }
            }

            results.put("scopeResults", scopeResults);
            results.put("testedScopes", scopesToTest.size());

            // Count successful scopes
            long successfulScopes = scopeResults.values().stream()
                    .filter(result -> result instanceof Map && ((Map<?, ?>) result).containsKey("access_token"))
                    .count();

            results.put("successfulScopes", successfulScopes);

            log.info("Completed scope testing. Successfully obtained tokens for {}/{} scopes",
                    successfulScopes, scopesToTest.size());

            return ResponseEntity.ok(results);
        } catch (Exception e) {
            log.error("Error testing scopes", e);

            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("stackTrace", Arrays.toString(e.getStackTrace()));

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(error);
        }
    }

    /**
     * Tests a single scope by attempting to obtain an access token.
     */
    private Map<String, Object> testScope(String jwt, String scope) {
        try {
            // Create the token request parameters
            Map<String, String> params = new HashMap<>();
            params.put("grant_type", "client_credentials");
            params.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
            params.put("client_assertion", jwt);
            params.put("scope", scope);

            // Make the token request using canvasApiService directly
            Map<String, Object> response = canvasApiService.makeTokenRequest(ltiConfig.getTokenUrl(), params);
            return response;
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            return error;
        }
    }

    /**
     * Displays environment details to help with debugging.
     * Shows key configuration settings and environment variables.
     * SECURITY: Requires valid API key for access.
     */
    @GetMapping("/environment")
    public ResponseEntity<Map<String, Object>> getEnvironmentDetails(HttpServletRequest request) {
        try {
            log.warn("SECURITY: Environment details requested - validating access");

            // SECURITY: Validate admin request
            ApiSecurityService.SecurityValidationResult securityResult =
                    apiSecurityService.validateAdminRequest(request);

            if (!securityResult.isValid()) {
                log.warn("SECURITY: Unauthorized access attempt to environment details: {}", securityResult.getReason());
                Map<String, Object> errorResponse = new HashMap<>();
                errorResponse.put("error", "Access denied");
                errorResponse.put("reason", securityResult.getReason());
                return ResponseEntity.status(securityResult.getHttpStatus()).body(errorResponse);
            }

            log.info("SECURITY PASSED: Getting environment details");

            Map<String, Object> details = new HashMap<>();
            details.put("clientId", maskSensitiveInfo(ltiConfig.getClientId()));
            details.put("issuer", ltiConfig.getIssuer());
            details.put("keySetUrl", ltiConfig.getKeySetUrl());
            details.put("tokenUrl", ltiConfig.getTokenUrl());
            details.put("authUrl", ltiConfig.getAuthUrl());
            details.put("toolUrl", ltiConfig.getToolUrl());
            details.put("sanitizedToolUrl", ltiConfig.getSanitizedToolUrl());
            details.put("canvasServiceImpl", canvasService.getClass().getName());

            // Add any other helpful environment variables
            try {
                details.put("GCP_PROJECT_ID", System.getenv("GCP_PROJECT_ID"));
                details.put("SPRING_PROFILES_ACTIVE", System.getenv("SPRING_PROFILES_ACTIVE"));
                details.put("LTI_CLIENT_ID_ENV", System.getenv("LTI_CLIENT_ID"));
                details.put("TOOL_URL_ENV", System.getenv("TOOL_URL"));
            } catch (Exception e) {
                log.warn("Error getting environment variables", e);
            }

            // Add JWK info
            try {
                details.put("jwkKeyId", jwkService.getKeyId());
                details.put("isJwkInitialized", String.valueOf(jwkService.isInitialized()));
            } catch (Exception e) {
                log.warn("Error getting JWK details", e);
            }

            log.info("Environment details collected successfully");
            return ResponseEntity.ok(details);
        } catch (Exception e) {
            log.error("Error getting environment details", e);

            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(error);
        }
    }

    /**
     * Tests fetching quizzes for a specific course.
     * This helps identify if the OAuth token acquisition is working correctly.
     */
    @GetMapping("/quizzes/{courseId}")
    public ResponseEntity<?> testFetchQuizzes(@PathVariable String courseId) {
        try {
            log.info("Testing quiz fetching for course: {}", courseId);

            // Use the courseId as the userId for caching purposes
            var quizzes = canvasService.getQuizzesForCourse(courseId, courseId);

            log.info("Successfully fetched {} quizzes for course: {}", quizzes.size(), courseId);
            return ResponseEntity.ok(quizzes);
        } catch (Exception e) {
            log.error("Error fetching quizzes for course: {}", courseId, e);

            Map<String, String> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("stackTrace", Arrays.toString(e.getStackTrace()));

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(error);
        }
    }

    /**
     * Tests the direct Canvas API call using a specific scope.
     * This helps diagnose if the token has the right permissions.
     */
    @GetMapping("/test-api/{courseId}")
    public ResponseEntity<?> testDirectApiCall(
            @PathVariable String courseId,
            @RequestParam(required = false, defaultValue = "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem") String scope) {
        try {
            log.info("Testing direct API call for course: {} with scope: {}", courseId, scope);

            // Get an access token with the specified scope - using canvasApiService directly
            String accessToken = canvasApiService.getAccessTokenWithScope(courseId, scope);

            if (accessToken == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .body(Map.of("error", "Failed to obtain access token with scope: " + scope));
            }

            // Build the path for quizzes
            String path = canvasApiService.buildApiPathPublic("/courses/" + courseId + "/quizzes");

            // Make the API request
            Map<String, Object> apiResult = canvasApiService.makeApiRequest(path, accessToken);

            return ResponseEntity.ok(Map.of(
                    "scope", scope,
                    "accessToken", accessToken.substring(0, 20) + "...",
                    "apiPath", path,
                    "result", apiResult
            ));
        } catch (Exception e) {
            log.error("Error testing direct API call", e);

            Map<String, String> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("stackTrace", Arrays.toString(e.getStackTrace()));

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(error);
        }
    }

    /**
     * Tests the OAuth implementation by validating tokens and credentials.
     */
    @GetMapping("/test-oauth/{userId}")
    public ResponseEntity<?> testOAuthImplementation(@PathVariable String userId) {
        try {
            log.info("Testing OAuth implementation for user: {}", userId);

            Map<String, Object> results = new HashMap<>();
            results.put("hasValidCredentials", canvasService.hasValidCredentials(userId));

            if (canvasService.hasValidCredentials(userId)) {
                try {
                    // Test session token generation
                    String testUrl = ltiConfig.getSanitizedToolUrl() + "/test-target";
                    String sessionUrl = canvasService.getSessionToken(userId, testUrl);
                    results.put("sessionToken", sessionUrl != null ? "Generated successfully" : "Failed to generate");
                    results.put("sessionTokenUrl", sessionUrl);
                } catch (Exception e) {
                    results.put("sessionTokenError", e.getMessage());
                }

                try {
                    // Test quiz fetching for a test course (use 1 if unknown)
                    var quizzes = canvasService.getQuizzesForCourse("1", userId);
                    results.put("quizzesFetched", quizzes.size());
                } catch (Exception e) {
                    results.put("quizFetchError", e.getMessage());
                }
            }

            // Add implementation details
            results.put("canvasServiceClass", canvasService.getClass().getName());
            results.put("canvasApiServiceClass", canvasApiService.getClass().getName());

            return ResponseEntity.ok(results);
        } catch (Exception e) {
            log.error("Error testing OAuth implementation", e);

            Map<String, String> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("stackTrace", Arrays.toString(e.getStackTrace()));

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(error);
        }
    }

    /**
     * Fixes the JWT issuer URL issue by ensuring the JwkService has the correct URL.
     * This is a one-time fix that can help resolve issues during runtime.
     */
    @PostMapping("/fix-jwt-issuer")
    public ResponseEntity<Map<String, String>> fixJwtIssuer() {
        try {
            log.info("Attempting to fix JWT issuer URL");

            // Get the correct tool URL
            String toolUrl = ltiConfig.getSanitizedToolUrl();

            // Reinitialize the JwkService with the correct URL
            jwkService.reinitializeWithToolUrl(toolUrl);

            // Test creating a JWT to verify
            String jwt = jwkService.createSignedJwt(
                    ltiConfig.getClientId(),
                    toolUrl,
                    ltiConfig.getTokenUrl());

            Map<String, String> result = new HashMap<>();
            result.put("status", "success");
            result.put("message", "JWT issuer URL fixed to: " + toolUrl);
            result.put("jwtLength", String.valueOf(jwt.length()));

            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Error fixing JWT issuer URL", e);

            Map<String, String> error = new HashMap<>();
            error.put("status", "error");
            error.put("message", "Failed to fix JWT issuer URL: " + e.getMessage());

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(error);
        }
    }

    // Add these methods to your existing DebugController

    /**
     * Tests the LTI login flow by validating the endpoint accepts both GET and POST.
     */
    @GetMapping("/test-lti-login")
    public ResponseEntity<Map<String, Object>> testLtiLogin() {
        Map<String, Object> results = new HashMap<>();

        try {
            // Test GET request to /lti/login
            String getUrl = ltiConfig.getSanitizedToolUrl() + "/lti/login?iss=test&login_hint=test&target_link_uri=test";
            HttpHeaders headers = new HttpHeaders();
            headers.setAccept(Collections.singletonList(MediaType.TEXT_HTML));

            ResponseEntity<String> getResponse = restTemplate.exchange(
                    getUrl,
                    HttpMethod.GET,
                    new HttpEntity<>(headers),
                    String.class);

            results.put("getStatus", getResponse.getStatusCode().toString());
            results.put("getSupported", getResponse.getStatusCode().is3xxRedirection());

        } catch (Exception e) {
            results.put("getError", e.getMessage());
        }

        try {
            // Test POST request to /lti/login
            String postUrl = ltiConfig.getSanitizedToolUrl() + "/lti/login";
            MultiValueMap<String, String> formData = new LinkedMultiValueMap<>();
            formData.add("iss", "test");
            formData.add("login_hint", "test");
            formData.add("target_link_uri", "test");

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            ResponseEntity<String> postResponse = restTemplate.exchange(
                    postUrl,
                    HttpMethod.POST,
                    new HttpEntity<>(formData, headers),
                    String.class);

            results.put("postStatus", postResponse.getStatusCode().toString());
            results.put("postSupported", postResponse.getStatusCode().is3xxRedirection());

        } catch (Exception e) {
            results.put("postError", e.getMessage());
        }

        return ResponseEntity.ok(results);
    }

    /**
     * Verifies the service beans are properly registered and can be injected.
     */
    @GetMapping("/beans")
    public ResponseEntity<Map<String, String>> checkBeans() {
        Map<String, String> beanInfo = new HashMap<>();

        beanInfo.put("canvasServiceClass", canvasService.getClass().getName());
        beanInfo.put("canvasApiServiceClass", canvasApiService.getClass().getName());

        try {
            // Test JWT creation to ensure JwkService is working
            String jwt = jwkService.createSignedJwt("test-client", null, "https://test.com");
            beanInfo.put("jwkServiceWorking", "true");
            beanInfo.put("jwtLength", String.valueOf(jwt.length()));
        } catch (Exception e) {
            beanInfo.put("jwkServiceWorking", "false");
            beanInfo.put("jwkServiceError", e.getMessage());
        }

        return ResponseEntity.ok(beanInfo);
    }

    /**
     * Clears OAuth token for a specific user to force re-authorization.
     * Useful when OAuth configuration changes or tokens become invalid.
     */
    @GetMapping("/clear-oauth-token")
    public String clearOAuthTokenWithRedirect(
            @RequestParam(value = "user_id", required = false) String userId,
            @RequestParam(value = "redirect", required = false) String redirectUrl,
            Model model) {

        try {
            if (userId == null || userId.isEmpty()) {
                userId = "f2bbc1e1-ad05-4ae8-a8b6-d49fa4fb9760"; // Default to your user ID
            }

            // Clear OAuth token from both services
            canvasService.clearCredentials(userId);

            log.info("OAuth token cleared for user: {}", userId);

            // If redirect URL is provided, redirect there
            if (redirectUrl != null && !redirectUrl.isEmpty()) {
                return "redirect:" + redirectUrl;
            }

            // Otherwise show success page
            model.addAttribute("message", "OAuth token cleared successfully for user: " + userId);
            model.addAttribute("userId", userId);
            model.addAttribute("status", "success");

            return "debug/oauth-cleared";
        } catch (Exception e) {
            log.error("Error clearing OAuth token", e);

            model.addAttribute("message", "Error clearing OAuth token: " + e.getMessage());
            model.addAttribute("status", "error");

            return "debug/oauth-cleared";
        }
    }

    /**
     * API endpoint version that returns JSON response
     */
    @PostMapping("/clear-oauth-token")
    public ResponseEntity<Map<String, Object>> clearOAuthTokenApi(
            @RequestParam(value = "user_id", required = false) String userId) {
        Map<String, Object> response = new HashMap<>();

        try {
            if (userId == null || userId.isEmpty()) {
                userId = "f2bbc1e1-ad05-4ae8-a8b6-d49fa4fb9760"; // Default to your user ID
            }

            // Clear OAuth token from both services
            canvasService.clearCredentials(userId);

            response.put("status", "success");
            response.put("message", "OAuth token cleared for user: " + userId);
            response.put("userId", userId);
            response.put("timestamp", System.currentTimeMillis());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            response.put("status", "error");
            response.put("message", "Error clearing OAuth token: " + e.getMessage());
            response.put("timestamp", System.currentTimeMillis());

            return ResponseEntity.status(500).body(response);
        }
    }

    // ===== SEB DEBUG ENDPOINTS =====

    /**
     * Simple test endpoint to verify SEB debug endpoints are working.
     */
    @GetMapping("/seb-test")
    public ResponseEntity<Map<String, Object>> testSebEndpoint() {
        Map<String, Object> response = new HashMap<>();
        response.put("status", "success");
        response.put("message", "SEB debug endpoints are working");
        response.put("timestamp", System.currentTimeMillis());
        return ResponseEntity.ok(response);
    }

    /**
     * Masks sensitive information for logging/display purposes
     */
    private String maskSensitiveInfo(String value) {
        if (value == null || value.length() <= 8) {
            return "***";
        }
        return value.substring(0, 4) + "***" + value.substring(value.length() - 4);
    }

    /**
     * Test endpoint to check New Quizzes API URL construction
     */
    @GetMapping("/test-new-quiz-url")
    public ResponseEntity<Map<String, Object>> testNewQuizUrl() {
        Map<String, Object> response = new HashMap<>();

        try {
            // Test URL construction for New Quizzes API
            String testCourseId = "11825";
            String baseUrl = "https://kentdenver.instructure.com/api/v1";
            String correctedBaseUrl = baseUrl.replace("/api/v1", "");
            String newQuizUrl = correctedBaseUrl + "/api/quiz/v1/courses/" + testCourseId + "/quizzes";

            response.put("status", "ok");
            response.put("original_base_url", baseUrl);
            response.put("corrected_base_url", correctedBaseUrl);
            response.put("new_quiz_url", newQuizUrl);
            response.put("expected_url", "https://kentdenver.instructure.com/api/quiz/v1/courses/11825/quizzes");
            response.put("url_correct", newQuizUrl.equals("https://kentdenver.instructure.com/api/quiz/v1/courses/11825/quizzes"));

            log.info("New Quizzes URL test: {}", newQuizUrl);

        } catch (Exception e) {
            log.error("Error testing New Quizzes URL construction", e);
            response.put("status", "error");
            response.put("error", e.getMessage());
        }

        return ResponseEntity.ok(response);
    }

}