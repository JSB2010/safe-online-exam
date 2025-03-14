package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import javax.annotation.PostConstruct;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for interacting with the Canvas API Scopes endpoint.
 * This helps to determine available scopes and correctly format scope requests
 * for OAuth token acquisition.
 *
 * The service discovers which scopes are available in the Canvas instance and
 * recommends the appropriate scopes for quiz-related API access.
 */
@Service
@Slf4j
public class CanvasScopesService {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final LtiConfig ltiConfig;
    private final String apiBaseUrl;
    private final JwkService jwkService;

    // Optional default account ID to use if none is provided
    private static final String DEFAULT_ACCOUNT_ID = "self";

    // Cache for retrieved scopes to avoid repeated API calls
    private List<CanvasScope> cachedScopes = null;

    // Prioritized order of scope formats to try, from most preferred to least
    private static final String[] PREFERRED_SCOPE_FORMATS = {
            // Direct format from Canvas documentation for quiz access
            "url:GET|/api/v1/courses/:course_id/quizzes",

            // LTI Advantage standard scopes
            "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
            "https://purl.imsglobal.org/spec/lti-ags/scope/score",
            "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly",

            // Canvas-specific scopes
            "https://canvas.instructure.com/lti-ags/scope/lineitem",
            "https://canvas.instructure.com/lti-ags/scope/score",
            "https://canvas.instructure.com/lti-nrps/scope/contextmembership.readonly",

            // More general Canvas API scopes
            "url:GET|/api/v1/courses",

            // Legacy/fallback scopes
            "https://canvas.instructure.com/lti/scopes/api",
            "https://www.instructure.com/lti/scopes/api"
    };

    /**
     * Data class representing a Canvas API Scope.
     * Maps to the JSON structure returned by the Canvas API.
     */
    @Data
    public static class CanvasScope {
        private String resource;
        private String resourceName;
        private String controller;
        private String action;
        private String verb;
        private String scope;

        /**
         * Returns a nicely formatted representation of this scope.
         */
        @Override
        public String toString() {
            return String.format("Scope{resource='%s', resourceName='%s', verb='%s', scope='%s'}",
                    resource, resourceName, verb, scope);
        }
    }

    /**
     * Constructor for the Canvas Scopes Service.
     * Injects all required dependencies.
     *
     * @param restTemplate For making HTTP requests to Canvas API
     * @param objectMapper For JSON parsing
     * @param ltiConfig LTI configuration settings
     * @param jwkService Service for JWT operations
     * @param apiBaseUrl Base URL for Canvas API
     */
    @Autowired
    public CanvasScopesService(RestTemplate restTemplate,
                               ObjectMapper objectMapper,
                               LtiConfig ltiConfig,
                               JwkService jwkService,
                               @Value("${canvas.api.baseUrl:https://canvas.instructure.com/api/v1}") String apiBaseUrl) {
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.ltiConfig = ltiConfig;
        this.jwkService = jwkService;

        // Ensure API base URL doesn't end with a slash
        this.apiBaseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl.substring(0, apiBaseUrl.length() - 1) : apiBaseUrl;

        log.debug("Initialized CanvasScopesService with API Base URL: {}", this.apiBaseUrl);
    }

    /**
     * Initialize the service and attempt to load scopes on startup
     * for debugging purposes. This helps identify available scopes early.
     */
    @PostConstruct
    public void init() {
        try {
            log.info("Attempting to fetch available Canvas API scopes on startup...");
            List<CanvasScope> scopes = getScopes("self");
            if (scopes != null && !scopes.isEmpty()) {
                log.info("Successfully retrieved {} Canvas API scopes", scopes.size());

                // Log all quiz-related scopes to help with troubleshooting
                List<CanvasScope> quizScopes = scopes.stream()
                        .filter(s -> s.getResource() != null && s.getResource().toLowerCase().contains("quiz") ||
                                s.getResourceName() != null && s.getResourceName().toLowerCase().contains("quiz") ||
                                (s.getScope() != null && s.getScope().toLowerCase().contains("quiz")))
                        .collect(Collectors.toList());

                log.info("Found {} quiz-related scopes:", quizScopes.size());
                for (CanvasScope scope : quizScopes) {
                    log.info(" - {}", scope);
                }

                // Log all course-related scopes too
                List<CanvasScope> courseScopes = scopes.stream()
                        .filter(s -> (s.getResource() != null && s.getResource().toLowerCase().contains("course")) ||
                                (s.getResourceName() != null && s.getResourceName().toLowerCase().contains("course")) ||
                                (s.getScope() != null && s.getScope().toLowerCase().contains("course")))
                        .filter(s -> s.getVerb() != null && s.getVerb().equals("GET"))  // Only GET scopes
                        .collect(Collectors.toList());

                log.info("Found {} course-related GET scopes:", courseScopes.size());
                for (CanvasScope scope : courseScopes) {
                    log.info(" - {}", scope);
                }

                // Recommend specific scopes to use
                log.info("==== RECOMMENDED SCOPES FOR THIS APPLICATION ====");
                List<String> recommendedScopes = new ArrayList<>();

                // Find the scopes specifically for quizzes
                scopes.stream()
                        .filter(s -> s.getScope() != null &&
                                s.getScope().contains("/api/v1/courses/:course_id/quizzes") &&
                                s.getVerb() != null && s.getVerb().equals("GET"))
                        .forEach(s -> recommendedScopes.add(s.getScope()));

                // If we found specific scopes, recommend those
                if (!recommendedScopes.isEmpty()) {
                    log.info("Based on available scopes, recommend using the following in CanvasService:");
                    for (String scope : recommendedScopes) {
                        log.info("formData.add(\"scope\", \"{}\");", scope);
                    }
                } else {
                    log.info("No specific quiz scopes found. Consider using a broader scope:");
                    log.info("formData.add(\"scope\", \"url:GET|/api/v1/courses\");");
                }
                log.info("=================================================");
            } else {
                log.warn("No Canvas API scopes retrieved. Check API access and permissions.");
                log.info("Will continue with application startup and use fallback scopes.");
            }
        } catch (Exception e) {
            log.error("Failed to retrieve Canvas API scopes on startup: {}", e.getMessage());
            log.info("Will continue with application startup and use fallback scopes.");
        }
    }

    /**
     * Gets a list of available scopes from the Canvas API.
     * Uses a cached result if available to avoid repeated API calls.
     *
     * @param accountId The Canvas account ID to retrieve scopes for (use "self" for current account)
     * @return List of Canvas API scopes or empty list if retrieval fails
     */
    public List<CanvasScope> getScopes(String accountId) {
        if (cachedScopes != null) {
            log.debug("Returning cached scopes (size: {})", cachedScopes.size());
            return cachedScopes;
        }

        if (accountId == null || accountId.isEmpty()) {
            accountId = DEFAULT_ACCOUNT_ID;
        }

        log.debug("Fetching available API scopes for account: {}", accountId);

        try {
            // First try with LTI scopes directly
            // This is more reliable than using OAuth client credentials
            String accessToken = null;
            Exception lastException = null;

            for (String scopeFormat : PREFERRED_SCOPE_FORMATS) {
                try {
                    log.info("Attempting to obtain token for scopes API with scope: {}", scopeFormat);
                    accessToken = getAccessToken(scopeFormat);
                    if (accessToken != null) {
                        log.info("Successfully obtained token with scope: {}", scopeFormat);
                        break;
                    }
                } catch (Exception e) {
                    lastException = e;
                    log.warn("Failed to obtain token with scope format '{}': {}",
                            scopeFormat, e.getMessage());
                }
            }

            if (accessToken == null) {
                if (lastException != null) {
                    log.error("All scope formats failed, using last error:", lastException);
                } else {
                    log.error("Failed to obtain access token for scopes API call with any format");
                }
                return new ArrayList<>();
            }

            // Build the URL for the scopes endpoint
            String url = UriComponentsBuilder
                    .fromHttpUrl(apiBaseUrl)
                    .pathSegment("accounts", accountId, "scopes")
                    .build()
                    .toUriString();

            log.debug("Fetching scopes from URL: {}", url);

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

            log.debug("Scopes API Response Status: {}", response.getStatusCode());

            if (response.getBody() != null) {
                String responsePreview = response.getBody().substring(0, Math.min(response.getBody().length(), 100)) + "...";
                log.debug("Scopes API Response Body (first 100 chars): {}", responsePreview);
            } else {
                log.warn("Scopes API Response Body is null");
                return new ArrayList<>();
            }

            // Parse the response to a list of CanvasScope objects
            List<CanvasScope> scopes = parseScopesList(response.getBody());

            // Log the total number of scopes retrieved
            log.info("Retrieved {} scopes from Canvas API", scopes.size());

            // Cache the result
            this.cachedScopes = scopes;

            return scopes;
        } catch (HttpClientErrorException e) {
            log.error("Error fetching scopes from Canvas: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
            return new ArrayList<>();
        } catch (Exception e) {
            log.error("Error fetching scopes from Canvas: {}", e.getMessage());
            return new ArrayList<>();
        }
    }

    /**
     * Gets an access token for the Canvas API using OAuth client credentials flow.
     * This method is specifically optimized for the scopes API call.
     *
     * @param requestedScope The scope to request in the token
     * @return Access token or null if acquisition fails
     */
    private String getAccessToken(String requestedScope) {
        try {
            log.debug("Obtaining access token for scopes API call with scope: {}", requestedScope);

            // Get the sanitized tool URL
            String toolUrl = ltiConfig.getSanitizedToolUrl();

            // Create a signed JWT for client credentials request
            String signedJwt = jwkService.createSignedJwt(
                    ltiConfig.getClientId(),
                    toolUrl,
                    ltiConfig.getTokenUrl());

            log.debug("JWT token created, length: {}", signedJwt.length());
            log.debug("Using client_id: {}", ltiConfig.getClientId());
            log.debug("Using issuer (tool URL): {}", toolUrl);
            log.debug("Using audience (token URL): {}", ltiConfig.getTokenUrl());

            // Prepare token request
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            MultiValueMap<String, String> formData = new LinkedMultiValueMap<>();
            formData.add("grant_type", "client_credentials");
            formData.add("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
            formData.add("client_assertion", signedJwt);
            formData.add("scope", requestedScope);

            HttpEntity<MultiValueMap<String, String>> requestEntity = new HttpEntity<>(formData, headers);

            log.debug("Making token request to: {}", ltiConfig.getTokenUrl());

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

            // Check for error in response
            if (tokenResponse.containsKey("error")) {
                String error = (String) tokenResponse.get("error");
                String errorDescription = (String) tokenResponse.getOrDefault("error_description", "No description");
                log.error("Error in token response: {} - {}", error, errorDescription);
                return null;
            }

            String accessToken = (String) tokenResponse.get("access_token");
            if (accessToken == null) {
                log.error("Token response did not contain an access_token field");
                return null;
            }

            // Log success and granted scope if available
            String grantedScope = (String) tokenResponse.get("scope");
            if (grantedScope != null) {
                log.info("Successfully obtained access token with granted scope: {}", grantedScope);
            } else {
                log.info("Successfully obtained access token, but no scope information returned");
            }

            return accessToken;
        } catch (Exception e) {
            log.error("Failed to obtain access token for scopes API with scope '{}': {}",
                    requestedScope, e.getMessage());
            throw new RuntimeException("Failed to obtain access token for scope: " + requestedScope, e);
        }
    }

    /**
     * Parses the JSON response from Canvas into CanvasScope objects.
     *
     * @param jsonResponse The JSON response from Canvas API
     * @return List of CanvasScope objects
     * @throws JsonProcessingException If parsing fails
     */
    private List<CanvasScope> parseScopesList(String jsonResponse) throws JsonProcessingException {
        if (jsonResponse == null || jsonResponse.isEmpty()) {
            return new ArrayList<>();
        }

        // Parse the response into a list of maps
        List<Map<String, Object>> rawScopes = objectMapper.readValue(
                jsonResponse,
                new TypeReference<List<Map<String, Object>>>() {}
        );

        List<CanvasScope> scopes = new ArrayList<>();

        // Convert each raw scope to our CanvasScope model
        for (Map<String, Object> rawScope : rawScopes) {
            CanvasScope scope = new CanvasScope();
            scope.setResource((String) rawScope.get("resource"));
            scope.setResourceName((String) rawScope.get("resource_name"));
            scope.setController((String) rawScope.get("controller"));
            scope.setAction((String) rawScope.get("action"));
            scope.setVerb((String) rawScope.get("verb"));
            scope.setScope((String) rawScope.get("scope"));

            scopes.add(scope);
        }

        return scopes;
    }

    /**
     * Retrieves a filtered list of scopes based on search criteria.
     * Useful for finding scopes related to specific resources or HTTP methods.
     *
     * @param resource Optional resource filter (e.g., "quizzes")
     * @param verb Optional HTTP verb filter (e.g., "GET")
     * @param accountId Optional account ID
     * @return Filtered list of Canvas scopes
     */
    public List<CanvasScope> searchScopes(String resource, String verb, String accountId) {
        List<CanvasScope> allScopes = getScopes(accountId);

        return allScopes.stream()
                .filter(s -> resource == null ||
                        (s.getResource() != null && s.getResource().toLowerCase().contains(resource.toLowerCase())) ||
                        (s.getResourceName() != null && s.getResourceName().toLowerCase().contains(resource.toLowerCase())))
                .filter(s -> verb == null || (s.getVerb() != null && s.getVerb().equalsIgnoreCase(verb)))
                .collect(Collectors.toList());
    }

    /**
     * Gets a list of recommended scopes for quiz-related API access.
     * This method intelligently determines the best scopes based on actual Canvas instance configuration.
     * If no specific quiz scopes are found, it falls back to more general scopes.
     *
     * @return List of recommended scope strings
     */
    public List<String> getRecommendedQuizScopes() {
        List<CanvasScope> allScopes = getScopes(DEFAULT_ACCOUNT_ID);
        List<String> recommendedScopes = new ArrayList<>();

        if (allScopes.isEmpty()) {
            log.warn("No scopes retrieved from Canvas API, falling back to predefined scope list");
            // Add our exact scope from Canvas documentation first
            recommendedScopes.add("url:GET|/api/v1/courses/:course_id/quizzes");

            // Add other fallback scopes
            recommendedScopes.add("https://canvas.instructure.com/lti/scopes/api");
            recommendedScopes.add("url:GET|/api/v1/courses");
            return recommendedScopes;
        }

        // Try to find quiz-specific scopes first (most specific)
        List<String> quizSpecificScopes = allScopes.stream()
                .filter(s -> s.getScope() != null && s.getVerb() != null && s.getVerb().equals("GET"))
                .filter(s -> s.getScope().contains("/api/v1/courses/:course_id/quizzes") ||
                        (s.getResource() != null && s.getResource().toLowerCase().contains("quiz")))
                .map(CanvasScope::getScope)
                .collect(Collectors.toList());

        if (!quizSpecificScopes.isEmpty()) {
            log.info("Found {} quiz-specific scopes", quizSpecificScopes.size());
            recommendedScopes.addAll(quizSpecificScopes);
        }

        // If no quiz-specific scopes found, try course-level scopes
        if (recommendedScopes.isEmpty()) {
            List<String> courseScopes = allScopes.stream()
                    .filter(s -> s.getScope() != null && s.getVerb() != null && s.getVerb().equals("GET"))
                    .filter(s -> s.getScope().contains("/api/v1/courses"))
                    .map(CanvasScope::getScope)
                    .collect(Collectors.toList());

            if (!courseScopes.isEmpty()) {
                log.info("No quiz-specific scopes found, using course-level scopes");
                recommendedScopes.addAll(courseScopes);
            }
        }

        // If still no recommended scopes, add our fallback scope from Canvas documentation
        if (recommendedScopes.isEmpty()) {
            log.info("No specific API scopes found in Canvas instance, using documented scope");
            recommendedScopes.add("url:GET|/api/v1/courses/:course_id/quizzes");
        }

        // If that didn't work, add the general Canvas API scope
        if (recommendedScopes.isEmpty()) {
            log.info("No specific API scopes found, using general Canvas API scope");
            recommendedScopes.add("https://canvas.instructure.com/lti/scopes/api");
        }

        // Always include the LTI Advantage scopes which help with core LTI functionality
        if (!recommendedScopes.contains("https://purl.imsglobal.org/spec/lti-ags/scope/lineitem")) {
            recommendedScopes.add("https://purl.imsglobal.org/spec/lti-ags/scope/lineitem");
        }

        if (!recommendedScopes.contains("https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly")) {
            recommendedScopes.add("https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly");
        }

        // Log the recommended scopes for debugging
        log.info("Recommended scopes for quiz access: {}", recommendedScopes);
        return recommendedScopes;
    }

    /**
     * Clears the scope cache to force a refresh from the API.
     * Useful for testing or when scopes have been updated.
     */
    public void clearCache() {
        cachedScopes = null;
        log.info("Canvas scopes cache cleared");
    }
}