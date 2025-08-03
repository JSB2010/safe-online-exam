package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.OAuthToken;
import org.kentdenver.sebcanvas.repository.FirestoreOAuthTokenRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Primary;
import org.springframework.http.*;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Primary implementation of CanvasService using OAuth2 credentials.
 * This is the preferred way to access Canvas API using proper OAuth2 authentication
 * with the Canvas API Developer Key.
 */
@Service("oauthCanvasService")
@Primary // Marks this as the primary implementation to be injected when no qualifier is specified
@Slf4j
public class OAuthCanvasService implements CanvasService {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final CanvasApiConfig canvasApiConfig;
    private final OAuth2AuthorizedClientService clientService;
    private final FirestoreOAuthTokenRepository tokenRepository;

    // Cache for tokens keyed by userId (for performance, backed by Firestore)
    private final Map<String, String> tokenCache = new ConcurrentHashMap<>();

    @Autowired
    public OAuthCanvasService(
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

        log.info("Initialized OAuthCanvasService with API Base URL: {}", canvasApiConfig.getApiBaseUrl());
    }

    @Override
    public List<Quiz> getQuizzesForCourse(String courseId, String userId) {
        log.debug("Fetching quizzes for course: {} for user: {}", courseId, userId);

        try {
            // Get access token for this user
            String accessToken = getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user: {}. OAuth flow required.", userId);
                return new ArrayList<>();
            }

            // First, try to resolve the course ID to a numeric ID if it's a hash
            String numericCourseId = resolveNumericCourseId(courseId, accessToken, userId);
            if (numericCourseId == null) {
                log.error("Could not resolve course ID {} to numeric ID", courseId);
                return new ArrayList<>();
            }

            // Build the API URL
            String apiPath = "/courses/" + numericCourseId + "/quizzes";
            String url = UriComponentsBuilder
                    .fromHttpUrl(canvasApiConfig.getApiBaseUrl())
                    .path(apiPath)
                    .queryParam("per_page", 100)
                    .toUriString();

            log.info("Making Canvas API request: {}", url);

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

            log.debug("Canvas API Response Status: {}", response.getStatusCode());

            // Parse the response to a list of Quiz objects
            List<Quiz> quizzes = parseQuizList(response.getBody(), courseId);
            log.info("Successfully fetched {} quizzes from Canvas for course: {}", quizzes.size(), courseId);

            return quizzes;
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
     * Resolves a course ID (which might be a hash) to a numeric course ID.
     * If the courseId is already numeric, returns it as-is.
     * If it's a hash, tries to resolve it using Canvas API.
     *
     * @param courseId The course ID (numeric or hash)
     * @param accessToken The OAuth access token
     * @param userId The user ID for token cache management
     * @return The numeric course ID, or null if resolution fails
     */
    private String resolveNumericCourseId(String courseId, String accessToken, String userId) {
        // Check if it's already numeric
        if (courseId.matches("\\d+")) {
            log.debug("Course ID {} is already numeric", courseId);
            return courseId;
        }

        log.info("Course ID {} appears to be a hash, attempting to resolve to numeric ID", courseId);

        try {
            // Try to get course information using the hash as course ID
            // Canvas sometimes accepts context hashes in certain endpoints
            String apiPath = "/courses/" + courseId;
            String url = UriComponentsBuilder
                    .fromHttpUrl(canvasApiConfig.getApiBaseUrl())
                    .path(apiPath)
                    .toUriString();

            log.debug("Attempting to resolve course ID using: {}", url);

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));

            HttpEntity<String> entity = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            // Parse the response to extract the numeric ID
            String responseBody = response.getBody();
            if (responseBody != null) {
                // Parse JSON to extract the numeric ID
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                com.fasterxml.jackson.databind.JsonNode courseNode = mapper.readTree(responseBody);

                if (courseNode.has("id")) {
                    String numericId = courseNode.get("id").asText();
                    log.info("Successfully resolved course hash {} to numeric ID: {}", courseId, numericId);
                    return numericId;
                }
            }

        } catch (HttpClientErrorException e) {
            log.warn("Failed to resolve course ID {} using direct course API: {} - {}",
                    courseId, e.getStatusCode(), e.getResponseBodyAsString());

            // If it's an authentication error, clear the token cache
            if (e.getStatusCode() == HttpStatus.UNAUTHORIZED || e.getStatusCode() == HttpStatus.FORBIDDEN) {
                log.warn("Authentication error during course ID resolution - clearing token cache for user");
                tokenCache.remove(userId);
            }
        } catch (Exception e) {
            log.warn("Error resolving course ID {}: {}", courseId, e.getMessage());
        }

        // If direct resolution fails, try listing user's courses to find a match
        return resolveFromUserCourses(courseId, accessToken, userId);
    }

    /**
     * Attempts to resolve course ID by listing user's courses and finding a match.
     */
    private String resolveFromUserCourses(String courseId, String accessToken, String userId) {
        try {
            log.debug("Attempting to resolve course ID {} by listing user courses", courseId);

            String url = UriComponentsBuilder
                    .fromHttpUrl(canvasApiConfig.getApiBaseUrl())
                    .path("/courses")
                    .queryParam("enrollment_state", "active")
                    .queryParam("per_page", 100)
                    .toUriString();

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));

            HttpEntity<String> entity = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            String responseBody = response.getBody();
            if (responseBody != null) {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                com.fasterxml.jackson.databind.JsonNode coursesArray = mapper.readTree(responseBody);

                if (coursesArray.isArray()) {
                    for (com.fasterxml.jackson.databind.JsonNode course : coursesArray) {
                        // Check if this course matches our target course somehow
                        // This is a fallback - we might need to match by name or other criteria
                        if (course.has("id")) {
                            String numericId = course.get("id").asText();
                            String courseName = course.has("name") ? course.get("name").asText() : "Unknown";
                            log.debug("Found course: {} (ID: {})", courseName, numericId);

                            // For now, we can't easily match the hash to a specific course
                            // This would require additional context or a different approach
                        }
                    }
                }
            }

        } catch (HttpClientErrorException e) {
            log.warn("Error listing user courses to resolve course ID {}: {} - {}",
                    courseId, e.getStatusCode(), e.getResponseBodyAsString());

            // If it's an authentication error, clear the token cache
            if (e.getStatusCode() == HttpStatus.UNAUTHORIZED || e.getStatusCode() == HttpStatus.FORBIDDEN) {
                log.warn("Authentication error during user courses listing - clearing token cache for user");
                tokenCache.remove(userId);
            }
        } catch (Exception e) {
            log.warn("Error listing user courses to resolve course ID {}: {}", courseId, e.getMessage());
        }

        log.error("Could not resolve course ID {} to numeric ID using any method", courseId);
        return null;
    }

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
     * Gets the access token for a user.
     * This method checks the cache first.
     *
     * @param userId The user ID
     * @return The access token or null if not found
     */
    private String getAccessToken(String userId) {
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
     * Parses the JSON response from Canvas into Quiz objects.
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
}