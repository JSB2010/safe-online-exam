package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.CanvasScopesService;
import org.kentdenver.sebcanvas.service.JwkService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Legacy implementation of CanvasService using LTI credentials.
 * This implementation uses client_credentials grant with JWT assertion based on the LTI key.
 * NOTE: This is not the preferred way to access Canvas API and should be considered deprecated.
 */
@Deprecated(since = "1.0", forRemoval = true)
@Service("ltiCanvasService")
@Slf4j
public class LtiCanvasService implements CanvasService {

    private final RestTemplate restTemplate;
    private final LtiConfig ltiConfig;
    private final ObjectMapper objectMapper;
    private final JwkService jwkService;
    private final String apiBaseUrl;
    private final CanvasScopesService canvasScopesService;

    // Cache for tokens to avoid repeated OAuth exchanges
    private final Map<String, TokenInfo> tokenCache = new ConcurrentHashMap<>();

    // Prioritized array of scopes to try, from most specific to most general
    private static final String[] PRIORITIZED_SCOPES = new String[] {
            // Scopes in exact format from Canvas documentation
            "url:GET|/api/v1/courses/:course_id/quizzes",

            // Module scopes (CRITICAL for SEB enforcement)
            "url:GET|/api/v1/courses/:course_id/modules",
            "url:GET|/api/v1/courses/:course_id/modules/:module_id/items",
            "url:PUT|/api/v1/courses/:course_id/modules/:module_id/items/:id",

            // More general URL-format scopes (less specific endpoints)
            "url:GET|/api/v1/courses/:course_id",
            "url:GET|/api/v1/courses",

            // Legacy/fallback scopes
            "https://canvas.instructure.com/lti/scopes/api",
            "https://www.instructure.com/lti/scopes/api"
    };

    /**
     * Inner class to store token information with expiration
     */
    private static class TokenInfo {
        String token;
        long expiresAt; // milliseconds since epoch
        String scope;   // The scope that was successfully used to get this token

        public TokenInfo(String token, long expiresInSeconds, String scope) {
            this.token = token;
            this.expiresAt = System.currentTimeMillis() + (expiresInSeconds * 1000);
            this.scope = scope;
        }

        public boolean isValid() {
            // Consider token expired 5 minutes before actual expiration
            return System.currentTimeMillis() < (expiresAt - (5 * 60 * 1000));
        }
    }

    /**
     * Constructor for the LTI Canvas service with all required dependencies.
     */
    @Autowired
    public LtiCanvasService(RestTemplate restTemplate,
                            LtiConfig ltiConfig,
                            ObjectMapper objectMapper,
                            JwkService jwkService,
                            CanvasScopesService canvasScopesService,
                            @Value("${canvas.api.baseUrl}") String apiBaseUrl) {
        this.restTemplate = restTemplate;
        this.ltiConfig = ltiConfig;
        this.objectMapper = objectMapper;
        this.jwkService = jwkService;
        this.canvasScopesService = canvasScopesService;

        // Sanitize the API base URL
        if (apiBaseUrl.endsWith("/")) {
            apiBaseUrl = apiBaseUrl.substring(0, apiBaseUrl.length() - 1);
        }
        this.apiBaseUrl = apiBaseUrl;

        log.debug("Initialized LtiCanvasService with API Base URL: {}", this.apiBaseUrl);
        log.warn("This service uses LTI credentials for API access which is not recommended for production use.");
    }

    @Override
    public List<Quiz> getQuizzesForCourse(String courseId, String userId) {
        log.debug("Getting quizzes for course: {} for user: {}", courseId, userId);

        try {
            // Get access token
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("Could not obtain access token for user: {}", userId);
                return new ArrayList<>();
            }

            // Build the API URL
            String apiPath = String.format("/api/v1/courses/%s/quizzes", courseId);
            String url = UriComponentsBuilder
                    .fromHttpUrl(apiBaseUrl)
                    .path(buildApiPath(apiPath))
                    .queryParam("per_page", 100)
                    .toUriString();

            log.debug("Making API request to: {}", url);

            // Set up headers with authorization
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));

            // Create the HTTP request
            HttpEntity<String> entity = new HttpEntity<>(headers);

            // Execute the request
            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            log.debug("API Response Status: {}", response.getStatusCode());

            // Parse the response
            List<Quiz> quizzes = parseQuizList(response.getBody(), courseId);
            log.info("Successfully retrieved {} quizzes from Canvas API", quizzes.size());

            return quizzes;
        } catch (Exception e) {
            log.error("Error getting quizzes from Canvas", e);
            return new ArrayList<>();
        }
    }

    @Override
    public String getSessionToken(String userId, String targetUrl) {
        log.debug("Getting session token for user: {} to access: {}", userId, targetUrl);

        try {
            // Get access token
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("Could not obtain access token for user: {}", userId);
                return null;
            }

            // Build the API URL for session token
            String apiPath = "/api/v1/login/session_token";
            String url = UriComponentsBuilder
                    .fromHttpUrl(apiBaseUrl)
                    .path(buildApiPath(apiPath))
                    .queryParam("return_to", targetUrl)
                    .toUriString();

            log.debug("Making session token request to: {}", url);

            // Set up headers with authorization
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));

            // Create the HTTP request
            HttpEntity<String> entity = new HttpEntity<>(headers);

            // Execute the request
            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            log.debug("Session token response status: {}", response.getStatusCode());

            // Parse the response
            Map<String, String> responseMap = objectMapper.readValue(
                    response.getBody(),
                    new TypeReference<Map<String, String>>() {}
            );

            String sessionUrl = responseMap.get("session_url");
            if (sessionUrl == null) {
                log.error("No session_url found in response");
                return null;
            }

            log.info("Successfully obtained session token URL for user: {}", userId);
            return sessionUrl;
        } catch (Exception e) {
            log.error("Error getting session token from Canvas", e);
            return null;
        }
    }

    @Override
    public boolean hasValidCredentials(String userId) {
        // Check if we have a valid token in the cache
        TokenInfo cachedToken = tokenCache.get(userId);
        return cachedToken != null && cachedToken.isValid();
    }

    @Override
    public void clearCredentials(String userId) {
        tokenCache.remove(userId);
        log.info("Cleared credentials for user: {}", userId);
    }

    // Helper methods from the existing CanvasService implementation

    private String buildApiPath(String path) {
        // If apiBaseUrl already contains /api/v1, adjust the path to not duplicate it
        if (apiBaseUrl.contains("/api/v1")) {
            // If path also starts with /api/v1, remove it to avoid duplication
            if (path.startsWith("/api/v1")) {
                log.debug("Removing duplicate /api/v1 from path");
                return path.substring(7); // Remove /api/v1
            }
            // Otherwise, return path as is
            return path;
        }

        // If apiBaseUrl does not contain /api/v1, we need to add it to path
        if (!path.startsWith("/api/v1")) {
            path = "/api/v1" + path;
            log.debug("Added /api/v1 to path: {}", path);
        }

        return path;
    }

    private String getAccessToken(String userId) throws Exception {
        // Check cache first
        TokenInfo cachedToken = tokenCache.get(userId);
        if (cachedToken != null && cachedToken.isValid()) {
            log.debug("Using cached token for user: {}, obtained with scope: {}", userId, cachedToken.scope);
            return cachedToken.token;
        }

        log.debug("No valid cached token found for user: {}, obtaining new token", userId);

        // First, try to get recommended scopes from CanvasScopesService
        List<String> scopesToTry = new ArrayList<>();

        try {
            List<String> recommendedScopes = canvasScopesService.getRecommendedQuizScopes();
            if (recommendedScopes != null && !recommendedScopes.isEmpty()) {
                log.info("Using {} recommended scopes from CanvasScopesService", recommendedScopes.size());
                scopesToTry.addAll(recommendedScopes);
            }
        } catch (Exception e) {
            log.warn("Failed to get recommended scopes from CanvasScopesService: {}", e.getMessage());
            // Continue with fallback scopes
        }

        // Add all our prioritized scopes as fallbacks
        for (String scope : PRIORITIZED_SCOPES) {
            if (!scopesToTry.contains(scope)) {
                scopesToTry.add(scope);
            }
        }

        log.info("Will try {} scopes in order to obtain an access token", scopesToTry.size());

        // Try each scope in order
        Exception lastException = null;
        for (String scope : scopesToTry) {
            try {
                log.info("Attempting to obtain token with scope: {}", scope);
                String token = getAccessTokenWithScope(userId, scope);
                if (token != null) {
                    log.info("Successfully obtained access token with scope: {}", scope);
                    return token;
                }
            } catch (Exception e) {
                log.warn("Failed to obtain token with scope '{}': {}", scope, e.getMessage());
                lastException = e;
                // Continue to next scope
            }
        }

        // If we get here, all scopes failed
        if (lastException != null) {
            throw lastException;
        } else {
            throw new Exception("Failed to obtain access token with any of the attempted scopes");
        }
    }

    /**
     * Gets an access token using a specific scope.
     * This method is exposed for debugging purposes.
     *
     * @param userId The user ID for token caching
     * @param scope The scope to request
     * @return The access token, or null if not obtained
     * @throws Exception If token acquisition fails
     */
    @Override
    public String getAccessTokenWithScope(String userId, String scope) {
        log.debug("Getting access token for scope: {}", scope);

        // Check cache first
        TokenInfo cachedToken = tokenCache.get(userId);
        if (cachedToken != null && cachedToken.isValid() && scope.equals(cachedToken.scope)) {
            log.debug("Using cached token for user: {}, obtained with scope: {}", userId, cachedToken.scope);
            return cachedToken.token;
        }

        log.debug("No valid cached token found for user: {}, obtaining new token with scope: {}", userId, scope);

        try {
            // Get the sanitized tool URL
            String toolUrl = ltiConfig.getSanitizedToolUrl();

            // Create a signed JWT for client credentials request
            String signedJwt = jwkService.createSignedJwt(
                    ltiConfig.getClientId(),
                    toolUrl,
                    ltiConfig.getTokenUrl());

            log.debug("JWT token length: {}", signedJwt.length());
            log.debug("Using client_id: {}", ltiConfig.getClientId());
            log.debug("Using issuer (tool URL): {}", toolUrl);
            log.debug("Using audience (token URL): {}", ltiConfig.getTokenUrl());
            log.debug("Requesting scope: {}", scope);

            // Prepare token request
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            MultiValueMap<String, String> formData = new LinkedMultiValueMap<>();
            formData.add("grant_type", "client_credentials");
            formData.add("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
            formData.add("client_assertion", signedJwt);
            formData.add("scope", scope);

            HttpEntity<MultiValueMap<String, String>> requestEntity = new HttpEntity<>(formData, headers);

            log.debug("Making token request to: {}", ltiConfig.getTokenUrl());

            // Make the token request
            ResponseEntity<String> response = restTemplate.exchange(
                    ltiConfig.getTokenUrl(),
                    HttpMethod.POST,
                    requestEntity,
                    String.class
            );

            log.debug("Token response status: {}", response.getStatusCode());

            // Parse the response
            Map<String, Object> tokenResponse = objectMapper.readValue(
                    response.getBody(),
                    new TypeReference<Map<String, Object>>() {}
            );

            // Check for error in response
            if (tokenResponse.containsKey("error")) {
                String error = (String) tokenResponse.get("error");
                String errorDescription = (String) tokenResponse.getOrDefault("error_description", "No description");
                log.error("Error in token response: {} - {}", error, errorDescription);
                return null;
            }

            String accessToken = (String) tokenResponse.get("access_token");
            if (accessToken == null || accessToken.isEmpty()) {
                log.error("Token response did not contain an access_token field");
                return null;
            }

            long expiresIn = ((Number) tokenResponse.getOrDefault("expires_in", 3600)).longValue();

            log.debug("Successfully obtained access token, expires in {} seconds", expiresIn);

            // Mask the token in logs for security
            String maskedToken = accessToken.substring(0, Math.min(accessToken.length(), 20)) + "...";
            log.debug("Access token first 20 chars: {}", maskedToken);

            // Store in cache
            tokenCache.put(userId, new TokenInfo(accessToken, expiresIn, scope));

            return accessToken;
        } catch (Exception e) {
            log.error("Error obtaining access token with scope '{}': {}", scope, e.getMessage());
            return null;
        }
    }

    private List<Quiz> parseQuizList(String jsonResponse, String courseId) {
        if (jsonResponse == null || jsonResponse.isEmpty()) {
            log.warn("Empty JSON response from Canvas API");
            return new ArrayList<>();
        }

        try {
            // Parse the response into a list of maps
            List<Map<String, Object>> rawQuizzes = objectMapper.readValue(
                    jsonResponse,
                    new TypeReference<List<Map<String, Object>>>() {}
            );

            List<Quiz> quizzes = new ArrayList<>();

            // Convert each raw quiz to our Quiz model
            for (Map<String, Object> rawQuiz : rawQuizzes) {
                Quiz quiz = new Quiz();
                quiz.setId(rawQuiz.get("id").toString());
                quiz.setTitle((String) rawQuiz.get("title"));
                quiz.setDescription((String) rawQuiz.getOrDefault("description", ""));
                quiz.setHtmlUrl((String) rawQuiz.get("html_url"));
                quiz.setCourseId(courseId);

                quizzes.add(quiz);
            }

            return quizzes;
        } catch (Exception e) {
            log.error("Error parsing quiz list from Canvas API", e);
            return new ArrayList<>();
        }
    }
}