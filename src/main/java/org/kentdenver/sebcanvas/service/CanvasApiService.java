package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.OAuthToken;
import org.kentdenver.sebcanvas.repository.FirestoreOAuthTokenRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for interacting with the Canvas API using OAuth2 credentials.
 * This service implements the CanvasService interface and provides API access
 * using Canvas API Developer Keys and OAuth2 authentication.
 *
 * The OAuth flow must be completed before this service can access Canvas API.
 * This is the primary implementation of the CanvasService interface and should
 * be used for all Canvas API interactions.
 */
@Service
@Slf4j
public class CanvasApiService implements CanvasService {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final CanvasApiConfig canvasApiConfig;
    private final OAuth2AuthorizedClientService clientService;
    private final FirestoreOAuthTokenRepository tokenRepository;

    // Cache for tokens keyed by userId (for performance, backed by Firestore)
    private final Map<String, String> tokenCache = new ConcurrentHashMap<>();

    /**
     * Constructor for the CanvasApiService with all required dependencies.
     *
     * @param restTemplate For making HTTP requests to the Canvas API
     * @param objectMapper For JSON serialization/deserialization
     * @param canvasApiConfig Configuration for Canvas API access
     * @param clientService Service for OAuth2 authorized clients
     */
    @Autowired
    public CanvasApiService(
            RestTemplate restTemplate,
            ObjectMapper objectMapper,
            CanvasApiConfig canvasApiConfig,
            OAuth2AuthorizedClientService clientService,
            FirestoreOAuthTokenRepository tokenRepository) {
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.canvasApiConfig = canvasApiConfig;
        this.clientService = clientService;
        this.tokenRepository = tokenRepository;

        log.info("Initialized CanvasApiService with API Base URL: {}", canvasApiConfig.getApiBaseUrl());
    }

    /**
     * Gets the Canvas API base URL.
     * @return The base URL for Canvas API calls
     */
    public String getCanvasApiBaseUrl() {
        return canvasApiConfig.getApiBaseUrl();
    }

    /**
     * Gets a list of quizzes for a specific course from Canvas.
     * This method fetches both Classic Quizzes and New Quizzes.
     * This method uses the OAuth2 access token to authorize the request.
     *
     * @param courseId The Canvas course ID
     * @param userId The Canvas user ID (used for token lookup)
     * @return List of quizzes in the course (both classic and new), or empty list if no token or error
     */
    @Override
    public List<Quiz> getQuizzesForCourse(String courseId, String userId) {
        log.debug("Fetching quizzes for course: {} for user: {}", courseId, userId);

        List<Quiz> allQuizzes = new ArrayList<>();

        try {
            // Get access token for this user
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user: {}. OAuth flow required.", userId);
                return allQuizzes;
            }

            // Get Classic Quizzes
            log.debug("Attempting to fetch classic quizzes for course: {}", courseId);
            List<Quiz> classicQuizzes = getClassicQuizzes(courseId, accessToken);
            allQuizzes.addAll(classicQuizzes);
            log.info("Retrieved {} classic quizzes for course: {}", classicQuizzes.size(), courseId);

            // Get New Quizzes
            log.debug("Attempting to fetch new quizzes for course: {}", courseId);
            List<Quiz> newQuizzes = getNewQuizzes(courseId, accessToken);
            allQuizzes.addAll(newQuizzes);
            log.info("Retrieved {} new quizzes for course: {}", newQuizzes.size(), courseId);

            log.info("Successfully fetched {} total quizzes from Canvas for course: {}", allQuizzes.size(), courseId);
            return allQuizzes;
        } catch (HttpClientErrorException e) {
            log.error("Error fetching quizzes from Canvas: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
            // Check if it's an authentication error
            if (e.getStatusCode() == HttpStatus.UNAUTHORIZED || e.getStatusCode() == HttpStatus.FORBIDDEN) {
                // Remove the token from cache to force re-authentication
                tokenCache.remove(userId);
                log.warn("Authentication error - token removed from cache for user: {}", userId);
            }
            return new ArrayList<>();
        } catch (Exception e) {
            log.error("Error fetching quizzes from Canvas", e);
            return new ArrayList<>();
        }
    }

    /**
     * Gets a temporary session token URL for direct access to Canvas.
     * This is used to generate secure, time-limited URLs for quiz access,
     * particularly for redirecting SEB browsers to quizzes.
     *
     * @param userId The Canvas user ID for authentication context
     * @param targetUrl The URL to access with the session token
     * @return A session token URL that redirects to the target URL, or null if not available
     */
    @Override
    public String getSessionToken(String userId, String targetUrl) {
        log.debug("Getting session token for user: {} to access: {}", userId, targetUrl);

        try {
            // Get access token
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user: {}. OAuth flow required.", userId);
                return null;
            }

            // Build the API URL for session token
            String apiPath = "/login/session_token";
            String url = UriComponentsBuilder
                    .fromHttpUrl(canvasApiConfig.getApiBaseUrl())
                    .path(apiPath)
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

    /**
     * Checks if this service has valid credentials for the user.
     * This determines if the OAuth flow needs to be initiated.
     *
     * @param userId The Canvas user ID to check
     * @return true if the service can make API calls for this user
     */
    @Override
    public boolean hasValidCredentials(String userId) {
        // Check cache first for performance
        if (tokenCache.containsKey(userId)) {
            return true;
        }

        // Check Firestore for persistent storage
        boolean hasToken = tokenRepository.existsByUserId(userId);
        if (hasToken) {
            // Load token into cache for future requests
            tokenRepository.findByUserId(userId).ifPresent(token ->
                tokenCache.put(userId, token.getAccessToken())
            );
        }

        return hasToken;
    }

    /**
     * Legacy method for backward compatibility.
     * Checks if a user has a valid access token.
     *
     * @param userId The user ID to check
     * @return true if the user has a valid token
     */
    public boolean hasAccessToken(String userId) {
        return hasValidCredentials(userId);
    }

    /**
     * Clear any cached credentials for a user or all users.
     * This is useful for forcing re-authentication or during logout.
     *
     * @param userId The Canvas user ID, or null to clear all credentials
     */
    @Override
    public void clearCredentials(String userId) {
        if (userId == null) {
            // Clear all credentials - only clear cache (Firestore cleanup would be too expensive)
            log.info("Clearing all credentials from token cache");
            tokenCache.clear();
        } else {
            // Clear specific user credentials from both cache and Firestore
            tokenCache.remove(userId);
            try {
                boolean deleted = tokenRepository.deleteByUserId(userId);
                if (deleted) {
                    log.info("Cleared credentials for user: {} from cache and Firestore", userId);
                } else {
                    log.info("Cleared credentials for user: {} from cache (no Firestore token found)", userId);
                }
            } catch (Exception e) {
                log.error("Failed to clear credentials from Firestore for user: {}", userId, e);
                log.info("Cleared credentials for user: {} from cache only", userId);
            }
        }
    }

    /**
     * Legacy method for backward compatibility.
     * Clears the token cache.
     */
    public void clearTokenCache() {
        log.info("Clearing token cache (legacy method)");
        clearCredentials(null);
    }

    /**
     * Clears the access token for a specific user.
     * This is useful when the existing token has insufficient scopes.
     *
     * @param userId The user ID whose token should be cleared
     */
    public void clearAccessToken(String userId) {
        log.info("Clearing access token for user: {}", userId);
        clearCredentials(userId);
    }

    /**
     * Gets the access token for a user.
     * This method checks the cache first and returns the cached token if available.
     *
     * @param userId The user ID
     * @return The access token or null if not found
     */
    public String getAccessToken(String userId) {
        // Check cache first for performance
        if (tokenCache.containsKey(userId)) {
            log.debug("Using cached access token for user: {}", userId);
            return tokenCache.get(userId);
        }

        // Check Firestore for persistent storage
        Optional<OAuthToken> tokenOpt = tokenRepository.findByUserId(userId);
        if (tokenOpt.isPresent()) {
            String accessToken = tokenOpt.get().getAccessToken();
            // Cache the token for future requests
            tokenCache.put(userId, accessToken);
            log.debug("Loaded access token from Firestore for user: {}", userId);
            return accessToken;
        }

        log.debug("No access token found for user: {}. OAuth flow required.", userId);
        return null;
    }

    /**
     * Gets Classic Quizzes for a course.
     */
    private List<Quiz> getClassicQuizzes(String courseId, String accessToken) {
        try {
            // Build the API URL for classic quizzes
            String apiPath = "/courses/" + courseId + "/quizzes";
            String url = UriComponentsBuilder
                    .fromHttpUrl(canvasApiConfig.getApiBaseUrl())
                    .path(apiPath)
                    .queryParam("per_page", 100)
                    .toUriString();

            log.info("Making Canvas API request for classic quizzes to: {}", url);

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

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Canvas API response for classic quizzes: {}", response.getBody());

                // Parse the response to a list of Quiz objects
                List<Quiz> quizzes = parseQuizList(response.getBody(), courseId);

                log.info("Parsed {} classic quizzes from Canvas API response", quizzes.size());

                // Mark these as classic quizzes
                quizzes.forEach(quiz -> {
                    quiz.setQuizEngine("classic");
                    quiz.setQuizTypeDisplay("Classic Quiz");
                    log.info("Classic Quiz found: ID={}, Title={}", quiz.getId(), quiz.getTitle());
                });

                return quizzes;
            } else {
                log.warn("Canvas API returned non-success status for classic quizzes: {}", response.getStatusCode());
                return new ArrayList<>();
            }

        } catch (Exception e) {
            log.error("Error getting classic quizzes from Canvas API", e);
            return new ArrayList<>();
        }
    }

    /**
     * Gets New Quizzes for a course.
     */
    public List<Quiz> getNewQuizzes(String courseId, String accessToken) {
        try {
            // Build the API URL for new quizzes - New Quizzes use a different API path
            // Note: New Quizzes API uses /api/quiz/v1/ instead of /api/v1/
            String baseUrl = canvasApiConfig.getApiBaseUrl().replace("/api/v1", "");
            String url = UriComponentsBuilder
                    .fromHttpUrl(baseUrl)
                    .path("/api/quiz/v1/courses/" + courseId + "/quizzes")
                    .queryParam("per_page", 100)
                    .toUriString();

            log.debug("Making Canvas API request for new quizzes to: {}", url);

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

            log.debug("New Quizzes API response status: {}", response.getStatusCode());

            if (response.getStatusCode().is2xxSuccessful()) {
                log.debug("New Quizzes API response body: {}", response.getBody());

                // Parse the response to a list of Quiz objects
                List<Quiz> quizzes = parseNewQuizList(response.getBody(), courseId);

                // Mark these as new quizzes
                quizzes.forEach(quiz -> {
                    quiz.setQuizEngine("new");
                    quiz.setQuizTypeDisplay("New Quiz");
                });

                log.debug("Parsed {} new quizzes from API response", quizzes.size());
                return quizzes;
            } else {
                log.warn("Canvas API returned non-success status for new quizzes: {} - {}", response.getStatusCode(), response.getBody());
                return new ArrayList<>();
            }

        } catch (Exception e) {
            log.error("Error getting new quizzes from Canvas API", e);
            return new ArrayList<>();
        }
    }

    /**
     * Parses the JSON response from Canvas into Quiz objects.
     * This handles the mapping from Canvas API format to our internal model.
     *
     * @param jsonResponse The JSON response from Canvas API
     * @param courseId The course ID to associate with the quizzes
     * @return List of Quiz objects
     */
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
                quiz.setCanvasQuizId(rawQuiz.get("id").toString());

                quizzes.add(quiz);
            }

            return quizzes;
        } catch (Exception e) {
            log.error("Error parsing quiz list from Canvas API", e);
            return new ArrayList<>();
        }
    }

    /**
     * Parses the JSON response from Canvas New Quizzes API into Quiz objects.
     * New Quizzes have a different structure than Classic Quizzes.
     *
     * @param jsonResponse The JSON response from Canvas New Quizzes API
     * @param courseId The course ID to associate with the quizzes
     * @return List of Quiz objects
     */
    private List<Quiz> parseNewQuizList(String jsonResponse, String courseId) {
        if (jsonResponse == null || jsonResponse.isEmpty()) {
            log.warn("Empty JSON response from Canvas New Quizzes API");
            return new ArrayList<>();
        }

        try {
            // Parse the response into a list of maps
            ObjectMapper mapper = new ObjectMapper();
            List<Map<String, Object>> rawQuizzes = mapper.readValue(jsonResponse, List.class);

            List<Quiz> quizzes = new ArrayList<>();
            for (Map<String, Object> rawQuiz : rawQuizzes) {
                Quiz quiz = new Quiz();
                quiz.setId(rawQuiz.get("id").toString());

                // New Quizzes might use "name" instead of "title"
                String title = (String) rawQuiz.get("title");
                if (title == null) {
                    title = (String) rawQuiz.get("name");
                }
                quiz.setTitle(title);

                quiz.setDescription((String) rawQuiz.get("description"));

                // New Quizzes might use "url" instead of "html_url"
                String htmlUrl = (String) rawQuiz.get("html_url");
                if (htmlUrl == null) {
                    htmlUrl = (String) rawQuiz.get("url");
                }
                quiz.setHtmlUrl(htmlUrl);

                quiz.setCourseId(courseId);
                quiz.setCanvasQuizId(rawQuiz.get("id").toString());

                quizzes.add(quiz);
            }

            return quizzes;
        } catch (Exception e) {
            log.error("Error parsing new quiz list from Canvas API", e);
            return new ArrayList<>();
        }
    }

    /**
     * Stores an access token for a user.
     * This method is called after successful OAuth2 authentication.
     *
     * @param userId The user ID
     * @param accessToken The access token
     */
    public void storeAccessToken(String userId, String accessToken) {
        // Store in cache for immediate use
        tokenCache.put(userId, accessToken);

        // Store in Firestore for persistence
        try {
            OAuthToken token = new OAuthToken(userId, accessToken, "url:GET|/api/v1/courses");
            tokenRepository.save(token);
            log.info("Stored access token for user: {} in cache and Firestore", userId);
        } catch (Exception e) {
            log.error("Failed to store access token in Firestore for user: {}", userId, e);
            // Token is still in cache, so the current session will work
        }
    }

    /**
     * Stores a token from an OAuth2 authentication.
     * This method extracts the token from the OAuth2 authentication and stores it.
     *
     * @param userId The user ID to associate with the token
     * @param authentication The OAuth2 authentication token
     */
    public void storeTokenFromAuthentication(String userId, OAuth2AuthenticationToken authentication) {
        OAuth2AuthorizedClient client = clientService.loadAuthorizedClient(
                authentication.getAuthorizedClientRegistrationId(),
                authentication.getName());

        if (client != null && client.getAccessToken() != null) {
            String token = client.getAccessToken().getTokenValue();
            storeAccessToken(userId, token);
            log.info("Stored OAuth2 access token for user: {}", userId);
        } else {
            log.warn("No access token found in OAuth2 authentication for user: {}", userId);
        }
    }

    /**
     * Makes a direct API request to the Canvas API.
     * This is a utility method for debugging API access.
     *
     * @param path The API path to request
     * @param accessToken The access token to use
     * @return The response as a map
     */
    public Map<String, Object> makeApiRequest(String path, String accessToken) {
        try {
            // Prepare the request URL
            String url = UriComponentsBuilder
                    .fromHttpUrl(canvasApiConfig.getApiBaseUrl())
                    .path(path)
                    .queryParam("per_page", 100)
                    .toUriString();

            log.info("Making API request to: {}", url);

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
            Map<String, Object> responseMap;
            if (response.getBody() != null) {
                try {
                    responseMap = objectMapper.readValue(
                            response.getBody(),
                            new TypeReference<Map<String, Object>>() {}
                    );
                } catch (Exception e) {
                    // If it's not a map, try parsing as a list
                    List<?> responseList = objectMapper.readValue(
                            response.getBody(),
                            new TypeReference<List<?>>() {}
                    );
                    responseMap = new HashMap<>();
                    responseMap.put("results", responseList);
                    responseMap.put("count", responseList.size());
                }
            } else {
                responseMap = new HashMap<>();
                responseMap.put("message", "Empty response body");
            }

            return responseMap;
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("errorType", e.getClass().getName());
            return error;
        }
    }

    /**
     * Makes a token request to the specified URL with the given parameters.
     * This is a utility method for debugging token acquisition.
     *
     * @param tokenUrl The token URL to request from
     * @param params The parameters to include in the request
     * @return The response as a map
     */
    public Map<String, Object> makeTokenRequest(String tokenUrl, Map<String, String> params) {
        try {
            log.debug("Making token request to: {}", tokenUrl);
            log.debug("Request parameters: {}", params);

            // Prepare the request
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            MultiValueMap<String, String> formData = new LinkedMultiValueMap<>();
            for (Map.Entry<String, String> entry : params.entrySet()) {
                formData.add(entry.getKey(), entry.getValue());
            }

            HttpEntity<MultiValueMap<String, String>> requestEntity = new HttpEntity<>(formData, headers);

            // Make the request
            ResponseEntity<String> response = restTemplate.exchange(
                    tokenUrl,
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

            return tokenResponse;
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("errorType", e.getClass().getName());
            return error;
        }
    }

    /**
     * Builds a properly formatted API path with /api/v1 prefix if needed.
     * This is a public utility method for debug controllers.
     *
     * @param path The API path to format
     * @return The formatted API path
     */
    public String buildApiPathPublic(String path) {
        String apiPath = path;

        // If path doesn't start with /api/v1, add it
        if (!apiPath.startsWith("/api/v1")) {
            apiPath = "/api/v1" + apiPath;
        }

        return apiPath;
    }

    /**
     * Gets an access token using a specific scope.
     * This method is exposed for debugging purposes.
     *
     * @param userId The user ID for token caching
     * @param scope The scope to request
     * @return The access token, or null if not obtained
     */
    public String getAccessTokenWithScope(String userId, String scope) {
        log.warn("getAccessTokenWithScope called in CanvasApiService. This method is not implemented in this service and only exists for compatibility.");
        return null;
    }

    /**
     * Updates a Canvas assignment to use external tool submission type.
     * This redirects students to our SEB enforcement service.
     *
     * @param courseId Canvas course ID
     * @param assignmentId Canvas assignment ID
     * @param quizId Canvas quiz ID
     * @param externalToolUrl The external tool URL to redirect to
     * @param userId User ID for authentication
     * @return true if update was successful
     */
    @SuppressWarnings("unchecked")
    public boolean updateAssignmentToExternalTool(String courseId, String assignmentId, String quizId, String externalToolUrl, String userId) {
        log.info("Updating Canvas assignment {} to use external tool for SEB enforcement", assignmentId);

        try {
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user {}", userId);
                return false;
            }

            // Prepare the API request
            String url = String.format("%s/courses/%s/assignments/%s", canvasApiConfig.getApiBaseUrl(), courseId, assignmentId);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(accessToken);

            // Create the assignment update payload
            Map<String, Object> assignmentData = new HashMap<>();
            assignmentData.put("submission_types", new String[]{"external_tool"});

            // External tool configuration
            Map<String, Object> externalToolConfig = new HashMap<>();
            externalToolConfig.put("url", externalToolUrl);
            externalToolConfig.put("new_tab", false);
            assignmentData.put("external_tool_tag_attributes", externalToolConfig);

            Map<String, Object> payload = new HashMap<>();
            payload.put("assignment", assignmentData);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);

            // Make the API call
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.PUT, request, Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully updated Canvas assignment {} to use external tool", assignmentId);
                return true;
            } else {
                log.error("Failed to update Canvas assignment {}. Status: {}", assignmentId, response.getStatusCode());
                return false;
            }

        } catch (Exception e) {
            log.error("Error updating Canvas assignment {} to external tool: {}", assignmentId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * Reverts a Canvas assignment back to normal quiz submission type.
     *
     * @param courseId Canvas course ID
     * @param assignmentId Canvas assignment ID
     * @param userId User ID for authentication
     * @return true if revert was successful
     */
    public boolean revertAssignmentFromExternalTool(String courseId, String assignmentId, String userId) {
        log.info("Reverting Canvas assignment {} from external tool back to normal quiz", assignmentId);

        try {
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user {}", userId);
                return false;
            }

            String url = String.format("%s/courses/%s/assignments/%s", canvasApiConfig.getApiBaseUrl(), courseId, assignmentId);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(accessToken);

            // Create the assignment update payload to revert to quiz
            Map<String, Object> assignmentData = new HashMap<>();
            assignmentData.put("submission_types", new String[]{"online_quiz"});

            // Remove external tool configuration
            assignmentData.put("external_tool_tag_attributes", null);

            Map<String, Object> payload = new HashMap<>();
            payload.put("assignment", assignmentData);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);

            // Make the API call
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.PUT, request, Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully reverted Canvas assignment {} from external tool", assignmentId);
                return true;
            } else {
                log.error("Failed to revert Canvas assignment {}. Status: {}", assignmentId, response.getStatusCode());
                return false;
            }

        } catch (Exception e) {
            log.error("Error reverting Canvas assignment {} from external tool: {}", assignmentId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * Finds the assignment ID for a given quiz ID.
     * In Canvas, quizzes can be associated with assignments.
     *
     * @param courseId Canvas course ID
     * @param quizId Canvas quiz ID
     * @param userId User ID for authentication
     * @return Assignment ID or null if not found
     */
    public String findAssignmentIdForQuiz(String courseId, String quizId, String userId) {
        log.debug("Finding assignment ID for quiz {} in course {}", quizId, courseId);

        try {
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user {}", userId);
                return null;
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            HttpEntity<String> request = new HttpEntity<>(headers);

            // First, try to get the Classic Quiz details to see if it has an assignment_id
            try {
                String quizUrl = String.format("%s/courses/%s/quizzes/%s", canvasApiConfig.getApiBaseUrl(), courseId, quizId);
                log.debug("Attempting to access Classic Quiz URL: {}", quizUrl);

                ResponseEntity<Map> response = restTemplate.exchange(quizUrl, HttpMethod.GET, request, Map.class);

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    Map<String, Object> quiz = response.getBody();
                    Object assignmentId = quiz.get("assignment_id");
                    if (assignmentId != null) {
                        log.debug("Found assignment ID {} for Classic Quiz {}", assignmentId, quizId);
                        return assignmentId.toString();
                    }
                }
            } catch (Exception e) {
                log.debug("Classic Quiz API failed for quiz {}, trying New Quizzes API: {}", quizId, e.getMessage());
            }

            // If Classic Quiz failed, try New Quizzes API
            try {
                String newQuizUrl = String.format("%s/quiz/v1/courses/%s/quizzes/%s", canvasApiConfig.getApiBaseUrl(), courseId, quizId);
                log.debug("Attempting to access New Quiz URL: {}", newQuizUrl);

                ResponseEntity<Map> response = restTemplate.exchange(newQuizUrl, HttpMethod.GET, request, Map.class);

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    Map<String, Object> quiz = response.getBody();
                    Object assignmentId = quiz.get("assignment_id");
                    if (assignmentId != null) {
                        log.debug("Found assignment ID {} for New Quiz {}", assignmentId, quizId);
                        return assignmentId.toString();
                    }
                }
            } catch (Exception e) {
                log.debug("New Quiz API also failed for quiz {}: {}", quizId, e.getMessage());
            }

            log.warn("No assignment found for quiz {} in course {} (tried both Classic and New Quiz APIs)", quizId, courseId);
            return null;

        } catch (Exception e) {
            log.error("Error finding assignment ID for quiz {}: {}", quizId, e.getMessage(), e);
            return null;
        }
    }

    /**
     * Creates a Canvas assignment for a quiz that doesn't have one, configured as an external tool.
     * This is needed for quizzes that were created as practice/survey quizzes without assignments.
     *
     * @param courseId The course ID
     * @param quizId The quiz ID
     * @param externalToolUrl The external tool URL to configure
     * @param userId The user ID for authentication
     * @return The created assignment ID, or null if creation failed
     */
    public String createAssignmentForQuiz(String courseId, String quizId, String externalToolUrl, String userId) {
        log.info("Creating Canvas assignment for quiz {} in course {}", quizId, courseId);

        try {
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user {}", userId);
                return null;
            }

            // First, get the quiz details to use for the assignment
            String quizUrl = String.format("%s/courses/%s/quizzes/%s", canvasApiConfig.getApiBaseUrl(), courseId, quizId);
            HttpHeaders quizHeaders = new HttpHeaders();
            quizHeaders.setBearerAuth(accessToken);
            HttpEntity<Void> quizRequest = new HttpEntity<>(quizHeaders);

            ResponseEntity<Map> quizResponse = restTemplate.exchange(quizUrl, HttpMethod.GET, quizRequest, Map.class);
            if (!quizResponse.getStatusCode().is2xxSuccessful() || quizResponse.getBody() == null) {
                log.error("Failed to fetch quiz details for quiz {}", quizId);
                return null;
            }

            Map<String, Object> quiz = quizResponse.getBody();
            String quizTitle = (String) quiz.get("title");
            String quizDescription = (String) quiz.get("description");

            // Create the assignment
            String assignmentUrl = String.format("%s/courses/%s/assignments", canvasApiConfig.getApiBaseUrl(), courseId);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(accessToken);

            // Create the assignment payload
            Map<String, Object> assignmentData = new HashMap<>();
            assignmentData.put("name", quizTitle + " (SEB Required)");
            assignmentData.put("description", quizDescription != null ? quizDescription : "This quiz requires Safe Exam Browser");
            assignmentData.put("submission_types", new String[]{"external_tool"});
            assignmentData.put("points_possible", quiz.get("points_possible"));
            assignmentData.put("due_at", quiz.get("due_at"));
            assignmentData.put("published", true);

            // External tool configuration
            Map<String, Object> externalToolConfig = new HashMap<>();
            externalToolConfig.put("url", externalToolUrl);
            externalToolConfig.put("new_tab", false);
            assignmentData.put("external_tool_tag_attributes", externalToolConfig);

            Map<String, Object> payload = new HashMap<>();
            payload.put("assignment", assignmentData);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);

            // Make the API call to create the assignment
            ResponseEntity<Map> response = restTemplate.exchange(assignmentUrl, HttpMethod.POST, request, Map.class);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                Map<String, Object> createdAssignment = response.getBody();
                String assignmentId = createdAssignment.get("id").toString();
                log.info("Successfully created Canvas assignment {} for quiz {}", assignmentId, quizId);
                return assignmentId;
            } else {
                log.error("Failed to create Canvas assignment for quiz {}. Status: {}", quizId, response.getStatusCode());
                return null;
            }

        } catch (Exception e) {
            log.error("Error creating Canvas assignment for quiz {}: {}", quizId, e.getMessage(), e);
            return null;
        }
    }

    /**
     * Updates a quiz's settings in Canvas.
     */
    public boolean updateQuizSettings(String courseId, String quizId, Map<String, Object> settings, String userId) {
        try {
            String url = String.format("https://kentdenver.instructure.com/api/v1/courses/%s/quizzes/%s", courseId, quizId);

            log.info("Updating quiz settings for quiz {} in course {} with settings: {}", quizId, courseId, settings);

            String accessToken = getAccessToken(userId);
            if (accessToken == null || accessToken.isEmpty()) {
                log.error("No access token available for user {}", userId);
                return false;
            }

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + accessToken);
            headers.set("Content-Type", "application/json");

            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("quiz", settings);

            log.debug("Request URL: {}", url);
            log.debug("Request headers: {}", headers);
            log.debug("Request body: {}", requestBody);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.PUT, entity, String.class);

            log.info("Canvas API response for quiz update: Status={}, Body={}",
                response.getStatusCode(), response.getBody());

            boolean success = response.getStatusCode().is2xxSuccessful();
            if (!success) {
                log.error("Canvas API returned non-success status: {} for quiz {}", response.getStatusCode(), quizId);
            }

            return success;

        } catch (Exception e) {
            log.error("Error updating quiz settings for quiz {} in course {}: {}", quizId, courseId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * Sets an access code for a Canvas quiz to enforce SEB requirements.
     */
    public boolean setQuizAccessCode(String courseId, String quizId, String accessCode, String userId) {
        log.info("Setting access code for quiz {} in course {}", quizId, courseId);

        // Check if we have an access token first
        String accessToken = getAccessToken(userId);
        if (accessToken == null || accessToken.isEmpty()) {
            log.warn("No access token available for user {} - cannot set access code on Canvas", userId);
            return false;
        }

        Map<String, Object> settings = new HashMap<>();
        settings.put("access_code", accessCode);

        return updateQuizSettings(courseId, quizId, settings, userId);
    }

    /**
     * Removes the access code from a Canvas quiz.
     */
    public boolean removeQuizAccessCode(String courseId, String quizId, String userId) {
        log.info("Removing access code for quiz {} in course {}", quizId, courseId);

        // Check if we have an access token first
        String accessToken = getAccessToken(userId);
        if (accessToken == null || accessToken.isEmpty()) {
            log.warn("No access token available for user {} - cannot remove access code from Canvas", userId);
            return false;
        }

        Map<String, Object> settings = new HashMap<>();
        settings.put("access_code", ""); // Empty string removes the access code

        return updateQuizSettings(courseId, quizId, settings, userId);
    }

    /**
     * Sets an access code for a Canvas New Quiz to enforce SEB requirements.
     * New Quizzes use a different API structure with nested quiz_settings.
     */
    public boolean setNewQuizAccessCode(String courseId, String assignmentId, String accessCode, String userId) {
        log.info("Setting access code for New Quiz {} in course {}", assignmentId, courseId);

        // Check if we have an access token first
        String accessToken = getAccessToken(userId);
        if (accessToken == null || accessToken.isEmpty()) {
            log.warn("No access token available for user {} - cannot set access code on New Quiz", userId);
            return false;
        }

        return updateNewQuizSettings(courseId, assignmentId, accessCode, true, userId);
    }

    /**
     * Removes the access code from a Canvas New Quiz.
     * New Quizzes use a different API structure with nested quiz_settings.
     */
    public boolean removeNewQuizAccessCode(String courseId, String assignmentId, String userId) {
        log.info("Removing access code for New Quiz {} in course {}", assignmentId, courseId);

        // Check if we have an access token first
        String accessToken = getAccessToken(userId);
        if (accessToken == null || accessToken.isEmpty()) {
            log.warn("No access token available for user {} - cannot remove access code from New Quiz", userId);
            return false;
        }

        return updateNewQuizSettings(courseId, assignmentId, null, false, userId);
    }

    /**
     * Updates New Quiz settings using the Canvas New Quizzes API.
     * New Quizzes use a different API structure with nested quiz_settings.
     */
    private boolean updateNewQuizSettings(String courseId, String assignmentId, String accessCode,
                                        boolean requireAccessCode, String userId) {
        try {
            log.info("Updating New Quiz settings for assignment {} in course {}", assignmentId, courseId);

            String accessToken = getAccessToken(userId);
            if (accessToken == null || accessToken.isEmpty()) {
                log.warn("No access token available for user {} - cannot update New Quiz settings", userId);
                return false;
            }

            // Build the API URL for New Quizzes
            // Note: New Quizzes API uses /api/quiz/v1/ instead of /api/v1/
            String baseUrl = canvasApiConfig.getApiBaseUrl().replace("/api/v1", "");
            String url = UriComponentsBuilder
                    .fromHttpUrl(baseUrl)
                    .path("/api/quiz/v1/courses/" + courseId + "/quizzes/" + assignmentId)
                    .toUriString();

            // First, test if the New Quizzes API endpoint exists by trying to GET the quiz
            log.debug("Testing New Quizzes API availability by attempting to GET quiz: {}", url);
            HttpHeaders testHeaders = new HttpHeaders();
            testHeaders.setBearerAuth(accessToken);
            HttpEntity<Void> testEntity = new HttpEntity<>(testHeaders);

            try {
                ResponseEntity<String> testResponse = restTemplate.exchange(
                        url,
                        HttpMethod.GET,
                        testEntity,
                        String.class
                );
                log.debug("New Quizzes API GET test successful. Status: {}", testResponse.getStatusCode());
            } catch (HttpClientErrorException.NotFound e) {
                log.warn("New Quizzes API endpoint not found (404) for assignment {} in course {}. " +
                        "This Canvas instance may not have the New Quizzes API enabled. " +
                        "New Quizzes cannot be automatically configured for SEB.", assignmentId, courseId);
                return false;
            } catch (Exception e) {
                log.warn("New Quizzes API test failed for assignment {} in course {}: {}. " +
                        "Proceeding with update attempt anyway.", assignmentId, courseId, e.getMessage());
            }

            // Create the request body with nested quiz_settings structure
            Map<String, Object> requestBody = new HashMap<>();
            Map<String, Object> quizSettings = new HashMap<>();

            quizSettings.put("require_student_access_code", requireAccessCode);
            if (requireAccessCode && accessCode != null) {
                quizSettings.put("student_access_code", accessCode);
            } else if (!requireAccessCode) {
                quizSettings.put("student_access_code", null);
            }

            Map<String, Object> quiz = new HashMap<>();
            quiz.put("quiz_settings", quizSettings);
            requestBody.put("quiz", quiz);

            // Set up headers
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(accessToken);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

            log.debug("Making PUT request to New Quizzes API: {}", url);
            log.debug("Request body: {}", requestBody);

            // Make the PUT request (New Quizzes API uses PUT instead of PATCH)
            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.PUT,
                    entity,
                    String.class
            );

            log.debug("New Quizzes API response status: {}", response.getStatusCode());
            log.debug("New Quizzes API response body: {}", response.getBody());

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully updated New Quiz settings for assignment {} in course {}", assignmentId, courseId);
                return true;
            } else {
                log.error("Failed to update New Quiz settings. Status: {}, Body: {}",
                         response.getStatusCode(), response.getBody());
                return false;
            }

        } catch (HttpClientErrorException.NotFound e) {
            log.warn("New Quizzes API endpoint not found (404) for assignment {} in course {}. " +
                    "This Canvas instance may not have the New Quizzes API enabled. " +
                    "New Quizzes cannot be automatically configured for SEB.", assignmentId, courseId);
            return false;
        } catch (Exception e) {
            log.error("Error updating New Quiz settings for assignment {} in course {}: {}",
                     assignmentId, courseId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * Gets detailed quiz information including current access code.
     */
    public JsonNode getQuizDetails(String courseId, String quizId, String userId) {
        try {
            String url = String.format("https://kentdenver.instructure.com/api/v1/courses/%s/quizzes/%s", courseId, quizId);

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + getAccessToken(userId));

            HttpEntity<String> entity = new HttpEntity<>(headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                return objectMapper.readTree(response.getBody());
            }

        } catch (Exception e) {
            log.error("Error getting quiz details for quiz {}: {}", quizId, e.getMessage(), e);
        }

        return null;
    }
}