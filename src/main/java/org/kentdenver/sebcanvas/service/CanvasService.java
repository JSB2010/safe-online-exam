package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for interacting with the Canvas API.
 * Handles communication with Canvas to fetch quizzes and other course resources.
 * Implements token management and caching for efficiency.
 */
@Service
@Slf4j
public class CanvasService {

    private final RestTemplate restTemplate;
    private final LtiConfig ltiConfig;
    private final ObjectMapper objectMapper;
    private final JwkService jwkService;
    private final String apiBaseUrl;

    // Cache for tokens to avoid repeated OAuth exchanges
    private final Map<String, TokenInfo> tokenCache = new ConcurrentHashMap<>();

    /**
     * Inner class to store token information with expiration
     */
    private static class TokenInfo {
        String token;
        long expiresAt; // milliseconds since epoch

        public TokenInfo(String token, long expiresInSeconds) {
            this.token = token;
            this.expiresAt = System.currentTimeMillis() + (expiresInSeconds * 1000);
        }

        public boolean isValid() {
            // Consider token expired 5 minutes before actual expiration
            return System.currentTimeMillis() < (expiresAt - (5 * 60 * 1000));
        }
    }

    /**
     * Constructor for the Canvas service with all required dependencies.
     */
    @Autowired
    public CanvasService(RestTemplate restTemplate,
                         LtiConfig ltiConfig,
                         ObjectMapper objectMapper,
                         JwkService jwkService,
                         @Value("${canvas.api.baseUrl}") String apiBaseUrl) {
        this.restTemplate = restTemplate;
        this.ltiConfig = ltiConfig;
        this.objectMapper = objectMapper;
        this.jwkService = jwkService;
        this.apiBaseUrl = apiBaseUrl;

        log.debug("Initialized CanvasService with API Base URL: {}", apiBaseUrl);
    }

    /**
     * Gets a list of quizzes for a specific course from Canvas.
     * Uses the LTI user context to authorize the request.
     *
     * @param courseId The Canvas course ID
     * @param userId The Canvas user ID (used for token caching)
     * @return List of quizzes in the course
     */
    public List<Quiz> getQuizzesForCourse(String courseId, String userId) {
        log.debug("Fetching quizzes for course: {} for user: {}", courseId, userId);

        try {
            // Get a valid token (either from cache or through OAuth)
            // Pass the courseId to the getAccessToken method
            String accessToken = getAccessToken(userId, courseId);

            // Prepare the request URL - use Canvas API standard endpoint for quizzes
            String url = UriComponentsBuilder
                    .fromHttpUrl(apiBaseUrl)
                    .path("/courses/" + courseId + "/quizzes")
                    .queryParam("per_page", 100) // Request up to 100 quizzes at once
                    .toUriString();

            // Set up headers with authorization
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));

            // Create the HTTP request
            HttpEntity<String> entity = new HttpEntity<>(headers);
            log.debug("Sending request to Canvas API: {}", url);

            // Execute the request
            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            // Parse the response to a list of Quiz objects
            List<Quiz> quizzes = parseQuizList(response.getBody(), courseId);
            log.info("Successfully fetched {} quizzes from Canvas for course: {}", quizzes.size(), courseId);

            return quizzes;
        } catch (HttpClientErrorException e) {
            log.error("Error fetching quizzes from Canvas: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
            // Return empty list on error to avoid breaking the UI flow
            return new ArrayList<>();
        } catch (Exception e) {
            log.error("Error fetching quizzes from Canvas", e);
            return new ArrayList<>();
        }
    }

    /**
     * Gets a valid access token for Canvas API calls.
     * First checks the cache, and if not found or expired, gets a new token via client credentials flow.
     *
     * @param userId The user ID for token caching
     * @param courseId The course ID for which we need access
     * @return A valid access token
     * @throws Exception If token acquisition fails
     */
    private String getAccessToken(String userId, String courseId) throws Exception {
        // Check cache first - use a composite key of userId_courseId for the cache
        String cacheKey = userId + "_" + courseId;
        TokenInfo cachedToken = tokenCache.get(cacheKey);
        if (cachedToken != null && cachedToken.isValid()) {
            log.debug("Using cached token for user: {} and course: {}", userId, courseId);
            return cachedToken.token;
        }

        log.debug("No valid cached token found for user: {} and course: {}, obtaining new token", userId, courseId);

        try {
            // Create a signed JWT for client credentials request
            String signedJwt = jwkService.createSignedJwt(ltiConfig.getClientId(),
                    ltiConfig.getToolUrl(),
                    ltiConfig.getTokenUrl());

            log.debug("JWT token length: {}", signedJwt.length());
            log.debug("Using client_id: {}", ltiConfig.getClientId());
            log.debug("Using issuer (tool URL): {}", ltiConfig.getToolUrl());
            log.debug("Using audience (token URL): {}", ltiConfig.getTokenUrl());

            // Prepare token request
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            MultiValueMap<String, String> formData = new LinkedMultiValueMap<>();
            formData.add("grant_type", "client_credentials");
            formData.add("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
            formData.add("client_assertion", signedJwt);

            // Use the specific granular scope with the actual course ID
            formData.add("scope", "url:GET|/api/v1/courses/" + courseId + "/quizzes");

            HttpEntity<MultiValueMap<String, String>> requestEntity = new HttpEntity<>(formData, headers);

            log.debug("Making token request to: {}", ltiConfig.getTokenUrl());
            log.debug("Requesting scope for course ID: {}", courseId);

            // Make the token request
            ResponseEntity<String> response = restTemplate.exchange(
                    ltiConfig.getTokenUrl(),
                    HttpMethod.POST,
                    requestEntity,
                    String.class
            );

            // Parse the response
            Map<String, Object> tokenResponse = objectMapper.readValue(
                    response.getBody(),
                    new TypeReference<Map<String, Object>>() {}
            );

            String accessToken = (String) tokenResponse.get("access_token");
            long expiresIn = ((Number) tokenResponse.getOrDefault("expires_in", 3600)).longValue();

            log.debug("Successfully obtained access token, expires in {} seconds", expiresIn);
            log.debug("Access token first 20 chars: {}", accessToken.substring(0, Math.min(accessToken.length(), 20)) + "...");

            // Store in cache using the composite key
            tokenCache.put(cacheKey, new TokenInfo(accessToken, expiresIn));

            return accessToken;
        } catch (Exception e) {
            log.error("Failed to obtain access token: {}", e.getMessage());

            // Log more details about the error
            if (e instanceof HttpClientErrorException) {
                HttpClientErrorException httpEx = (HttpClientErrorException) e;
                log.error("HTTP Status: {}, Response body: {}", httpEx.getStatusCode(), httpEx.getResponseBodyAsString());
            }

            // As a fallback during development, return a manually configured token if available
            String fallbackToken = System.getenv("CANVAS_API_TOKEN");
            if (fallbackToken != null && !fallbackToken.isEmpty()) {
                log.warn("Using fallback Canvas API token from environment variables");
                return fallbackToken;
            }

            // If all else fails, throw the exception
            throw e;
        }
    }

    /**
     * Parses the JSON response from Canvas into Quiz objects.
     *
     * @param jsonResponse The JSON response from Canvas API
     * @param courseId The course ID to associate with the quizzes
     * @return List of Quiz objects
     * @throws JsonProcessingException If parsing fails
     */
    private List<Quiz> parseQuizList(String jsonResponse, String courseId) throws JsonProcessingException {
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
    }
}