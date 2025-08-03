package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import jakarta.servlet.http.HttpSession;
import org.kentdenver.sebcanvas.model.Quiz;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.*;
import java.util.Arrays;

/**
 * Service for accessing Canvas data through LTI Assignment and Grade Services (AGS).
 * This provides a standardized way to access assignment data (including quizzes)
 * without requiring separate OAuth configuration.
 */
@Service
@Slf4j
public class LtiAgsService {

    private final LtiConfig ltiConfig;
    private final CanvasApiConfig canvasApiConfig;
    private final LtiService ltiService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Autowired
    public LtiAgsService(LtiConfig ltiConfig, CanvasApiConfig canvasApiConfig, LtiService ltiService, RestTemplate restTemplate, ObjectMapper objectMapper) {
        this.ltiConfig = ltiConfig;
        this.canvasApiConfig = canvasApiConfig;
        this.ltiService = ltiService;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        
        log.info("Initialized LtiAgsService for LTI Assignment and Grade Services");
    }

    /**
     * Gets quizzes for a course using LTI Assignment and Grade Services.
     * Quizzes in Canvas are assignments, so we can access them through AGS line items.
     *
     * @param courseId The Canvas course ID (LTI context ID hash)
     * @param userId The user ID (for token context)
     * @return List of quizzes found through AGS
     */
    public List<Quiz> getQuizzesForCourse(String courseId, String userId) {
        log.debug("Getting quizzes for course: {} using LTI AGS", courseId);

        try {
            // Get access token with AGS scope
            String accessToken = getAgsAccessToken();
            if (accessToken == null) {
                log.warn("Could not obtain AGS access token");
                return new ArrayList<>();
            }

            // Get the numeric Canvas course ID from LTI custom parameters
            String numericCourseId = getNumericCourseIdFromSession();
            if (numericCourseId != null) {
                log.info("Found numeric Canvas course ID: {} for LTI context: {}", numericCourseId, courseId);

                // Try AGS endpoints with the numeric course ID
                List<Quiz> quizzes = tryAgsWithNumericCourseId(accessToken, numericCourseId, courseId);
                if (!quizzes.isEmpty()) {
                    log.info("Successfully retrieved {} quizzes from LTI AGS using numeric course ID", quizzes.size());
                    return quizzes;
                }
            } else {
                log.warn("No numeric Canvas course ID found in LTI custom parameters");
            }

            // Fallback: Try multiple AGS endpoint variations with the LTI context ID
            log.info("Falling back to trying AGS endpoints with LTI context ID: {}", courseId);
            List<Quiz> quizzes = tryMultipleAgsEndpoints(accessToken, courseId);

            if (!quizzes.isEmpty()) {
                log.info("Successfully retrieved {} quizzes from LTI AGS", quizzes.size());
                return quizzes;
            } else {
                log.info("No quizzes found using any LTI AGS endpoint variation");
                return new ArrayList<>();
            }

        } catch (Exception e) {
            log.error("Error getting quizzes from LTI AGS for course: {}", courseId, e);
            return new ArrayList<>();
        }
    }

    /**
     * Tries multiple AGS endpoint variations to find the correct one for this Canvas instance.
     *
     * @param accessToken The AGS access token
     * @param courseId The course ID from LTI launch
     * @return List of quizzes found
     */
    private List<Quiz> tryMultipleAgsEndpoints(String accessToken, String courseId) {
        // List of endpoint patterns to try
        List<String> endpointPatterns = Arrays.asList(
            "/api/lti/courses/{courseId}/line_items",           // Standard LTI AGS
            "/api/lti/courses/{courseId}/assignments",          // Alternative assignments endpoint
            "/api/lti/contexts/{courseId}/line_items",          // Context-based endpoint
            "/api/v1/courses/{courseId}/line_items",            // Canvas API style
            "/api/lti/line_items?course_id={courseId}"          // Query parameter style
        );

        // Set up headers with authorization
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));
        HttpEntity<String> entity = new HttpEntity<>(headers);

        // Try each endpoint pattern
        for (String pattern : endpointPatterns) {
            try {
                String lineItemsUrl = buildLineItemsUrlWithPattern(courseId, pattern);
                log.info("Trying AGS endpoint: {}", lineItemsUrl);

                ResponseEntity<String> response = restTemplate.exchange(
                        lineItemsUrl,
                        HttpMethod.GET,
                        entity,
                        String.class
                );

                log.debug("AGS response status for {}: {}", pattern, response.getStatusCode());

                if (response.getStatusCode() == HttpStatus.OK) {
                    // Parse the line items response
                    List<Quiz> quizzes = parseLineItemsToQuizzes(response.getBody(), courseId);
                    if (!quizzes.isEmpty()) {
                        log.info("Successfully found {} quizzes using endpoint pattern: {}", quizzes.size(), pattern);
                        return quizzes;
                    } else {
                        log.debug("Endpoint {} returned empty result", pattern);
                    }
                } else {
                    log.debug("Endpoint {} returned status: {}", pattern, response.getStatusCode());
                }

            } catch (Exception e) {
                log.debug("Endpoint {} failed: {}", pattern, e.getMessage());
                // Continue to next endpoint
            }
        }

        return new ArrayList<>();
    }

    /**
     * Gets the numeric Canvas course ID from the current HTTP session's LTI launch data.
     *
     * @return The numeric Canvas course ID or null if not found
     */
    private String getNumericCourseIdFromSession() {
        try {
            ServletRequestAttributes attr = (ServletRequestAttributes) RequestContextHolder.currentRequestAttributes();
            HttpSession session = attr.getRequest().getSession(false);

            if (session != null) {
                LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
                if (launchData != null) {
                    log.debug("Found LTI launch data in session");

                    // Log all available LTI launch data for debugging
                    log.info("LTI Launch Data Debug:");
                    log.info("  Course ID (context): {}", launchData.getCourseId());
                    log.info("  Course Name: {}", launchData.getCourseName());
                    log.info("  Platform GUID: {}", launchData.getPlatformGuid());
                    log.info("  Platform Name: {}", launchData.getPlatformName());
                    log.info("  Deployment ID: {}", launchData.getDeploymentId());
                    log.info("  Resource Link ID: {}", launchData.getResourceLinkId());

                    // Check session attributes that might contain numeric course ID
                    String sessionCourseId = (String) session.getAttribute("canvas_course_id");
                    log.info("  Session canvas_course_id: {}", sessionCourseId);

                    if (launchData.getCustomParameters() != null) {
                        log.debug("Custom parameters found: {}", launchData.getCustomParameters());
                        String canvasCourseId = launchData.getCustomParameters().get("canvas_course_id");
                        if (canvasCourseId != null && !canvasCourseId.isEmpty()) {
                            log.info("Found Canvas course ID in custom parameters: {}", canvasCourseId);
                            return canvasCourseId;
                        } else {
                            log.warn("No canvas_course_id found in custom parameters. Available keys: {}",
                                    launchData.getCustomParameters().keySet());
                        }
                    } else {
                        log.warn("LTI launch data found but no custom parameters available");
                    }

                    // Try to extract numeric course ID from the LTI context ID if it contains a pattern
                    String contextCourseId = launchData.getCourseId();
                    if (contextCourseId != null) {
                        log.info("Attempting to extract numeric course ID from context ID: {}", contextCourseId);
                        // Some Canvas instances might embed the numeric ID in the context ID
                        // This is a fallback attempt - not guaranteed to work
                        String numericId = tryExtractNumericIdFromContextId(contextCourseId);
                        if (numericId != null) {
                            log.info("Extracted potential numeric course ID: {}", numericId);
                            return numericId;
                        }
                    }
                } else {
                    log.warn("No LTI launch data found in session");
                }
            } else {
                log.warn("No HTTP session available");
            }
        } catch (Exception e) {
            log.warn("Error getting numeric course ID from session: {}", e.getMessage());
        }

        return null;
    }

    /**
     * Attempts to extract a numeric course ID from the LTI context ID.
     * This is a fallback method that tries various patterns that Canvas might use.
     *
     * @param contextId The LTI context ID
     * @return The numeric course ID if found, null otherwise
     */
    private String tryExtractNumericIdFromContextId(String contextId) {
        if (contextId == null || contextId.isEmpty()) {
            return null;
        }

        // Try to find numeric patterns in the context ID
        // Some Canvas instances might use patterns like:
        // - course_12345
        // - 12345_hash
        // - course-12345-hash

        // Pattern 1: Look for "course_" followed by digits
        if (contextId.startsWith("course_")) {
            String afterPrefix = contextId.substring(7); // Remove "course_"
            String[] parts = afterPrefix.split("_");
            if (parts.length > 0 && parts[0].matches("\\d+")) {
                return parts[0];
            }
        }

        // Pattern 2: Look for digits at the beginning
        if (contextId.matches("^\\d+.*")) {
            String[] parts = contextId.split("[_-]");
            if (parts.length > 0 && parts[0].matches("\\d+")) {
                return parts[0];
            }
        }

        // Pattern 3: Look for digits anywhere in the string
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("\\d+");
        java.util.regex.Matcher matcher = pattern.matcher(contextId);
        if (matcher.find()) {
            String numericPart = matcher.group();
            // Only return if it's a reasonable course ID length (typically 4-10 digits)
            if (numericPart.length() >= 4 && numericPart.length() <= 10) {
                log.debug("Found potential numeric course ID '{}' in context ID '{}'", numericPart, contextId);
                return numericPart;
            }
        }

        log.debug("Could not extract numeric course ID from context ID: {}", contextId);
        return null;
    }

    /**
     * Tries AGS endpoints specifically with the numeric Canvas course ID.
     *
     * @param accessToken The AGS access token
     * @param numericCourseId The numeric Canvas course ID
     * @param originalCourseId The original LTI context course ID (for fallback)
     * @return List of quizzes found
     */
    private List<Quiz> tryAgsWithNumericCourseId(String accessToken, String numericCourseId, String originalCourseId) {
        // Set up headers with authorization
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));
        HttpEntity<String> entity = new HttpEntity<>(headers);

        // Try the standard Canvas LTI AGS endpoint with numeric course ID
        try {
            String lineItemsUrl = canvasApiConfig.getCanvasDomain() + "/api/lti/courses/" + numericCourseId + "/line_items?limit=100";
            log.info("Trying AGS endpoint with numeric course ID: {}", lineItemsUrl);

            ResponseEntity<String> response = restTemplate.exchange(
                    lineItemsUrl,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            log.debug("AGS response status for numeric course ID: {}", response.getStatusCode());

            if (response.getStatusCode() == HttpStatus.OK) {
                // Parse the line items response
                List<Quiz> quizzes = parseLineItemsToQuizzes(response.getBody(), originalCourseId);
                if (!quizzes.isEmpty()) {
                    log.info("Successfully found {} quizzes using numeric course ID: {}", quizzes.size(), numericCourseId);
                    return quizzes;
                } else {
                    log.debug("Numeric course ID endpoint returned empty result");
                }
            } else {
                log.debug("Numeric course ID endpoint returned status: {}", response.getStatusCode());
            }

        } catch (Exception e) {
            log.debug("Numeric course ID endpoint failed: {}", e.getMessage());
        }

        return new ArrayList<>();
    }

    /**
     * Gets an access token with AGS scope for making line items requests.
     *
     * @return Access token or null if failed
     */
    private String getAgsAccessToken() {
        try {
            log.debug("Requesting AGS access token");

            // Create signed JWT for client credentials
            String signedJwt = ltiService.createSignedJwt(ltiConfig.getTokenUrl());

            // Prepare token request with AGS scope
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            Map<String, String> formData = new HashMap<>();
            formData.put("grant_type", "client_credentials");
            formData.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
            formData.put("client_assertion", signedJwt);
            formData.put("scope", "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem");

            // Convert to form data
            StringBuilder formBody = new StringBuilder();
            for (Map.Entry<String, String> entry : formData.entrySet()) {
                if (formBody.length() > 0) {
                    formBody.append("&");
                }
                formBody.append(entry.getKey()).append("=").append(entry.getValue());
            }

            HttpEntity<String> requestEntity = new HttpEntity<>(formBody.toString(), headers);

            log.debug("Making AGS token request to: {}", ltiConfig.getTokenUrl());

            // Make the token request
            ResponseEntity<String> response = restTemplate.exchange(
                    ltiConfig.getTokenUrl(),
                    HttpMethod.POST,
                    requestEntity,
                    String.class
            );

            log.debug("AGS token response status: {}", response.getStatusCode());

            if (response.getStatusCode() == HttpStatus.OK) {
                // Parse the response
                Map<String, Object> tokenResponse = objectMapper.readValue(
                        response.getBody(),
                        new TypeReference<Map<String, Object>>() {}
                );

                String accessToken = (String) tokenResponse.get("access_token");
                if (accessToken != null) {
                    log.debug("Successfully obtained AGS access token");
                    return accessToken;
                } else {
                    log.warn("No access token in AGS response");
                    return null;
                }
            } else {
                log.warn("AGS token request failed with status: {}", response.getStatusCode());
                return null;
            }

        } catch (Exception e) {
            log.error("Error obtaining AGS access token", e);
            return null;
        }
    }

    /**
     * Builds the LTI AGS line items URL for a course using a specific pattern.
     *
     * @param courseId The Canvas course ID
     * @param pattern The URL pattern to use
     * @return The line items URL
     */
    private String buildLineItemsUrlWithPattern(String courseId, String pattern) {
        String baseUrl = canvasApiConfig.getCanvasDomain();

        if (pattern.contains("?")) {
            // Handle patterns that already have query parameters
            String expandedPattern = pattern.replace("{courseId}", courseId);
            return baseUrl + expandedPattern + "&limit=100";
        } else {
            // Handle path-based patterns
            return UriComponentsBuilder
                    .fromHttpUrl(baseUrl)
                    .path(pattern)
                    .queryParam("limit", 100)
                    .buildAndExpand(courseId)
                    .toUriString();
        }
    }

    /**
     * Builds the LTI AGS line items URL for a course (legacy method).
     *
     * @param courseId The Canvas course ID
     * @return The line items URL
     */
    private String buildLineItemsUrl(String courseId) {
        return buildLineItemsUrlWithPattern(courseId, "/api/lti/courses/{courseId}/line_items");
    }

    /**
     * Parses AGS line items response into Quiz objects.
     * Filters for quiz assignments and converts them to our Quiz model.
     *
     * @param jsonResponse The JSON response from AGS
     * @param courseId The course ID
     * @return List of Quiz objects
     */
    private List<Quiz> parseLineItemsToQuizzes(String jsonResponse, String courseId) {
        try {
            log.debug("Parsing AGS line items response");

            // Parse the response into a list of line items
            List<Map<String, Object>> lineItems = objectMapper.readValue(
                    jsonResponse,
                    new TypeReference<List<Map<String, Object>>>() {}
            );

            List<Quiz> quizzes = new ArrayList<>();

            // Convert line items to quizzes
            for (Map<String, Object> lineItem : lineItems) {
                // Check if this line item represents a quiz
                if (isQuizLineItem(lineItem)) {
                    Quiz quiz = convertLineItemToQuiz(lineItem, courseId);
                    if (quiz != null) {
                        quizzes.add(quiz);
                    }
                }
            }

            log.debug("Converted {} line items to {} quizzes", lineItems.size(), quizzes.size());
            return quizzes;

        } catch (Exception e) {
            log.error("Error parsing AGS line items response", e);
            return new ArrayList<>();
        }
    }

    /**
     * Determines if a line item represents a quiz assignment.
     *
     * @param lineItem The line item data
     * @return true if this is a quiz
     */
    private boolean isQuizLineItem(Map<String, Object> lineItem) {
        // Check if the line item has quiz-related indicators
        String label = (String) lineItem.get("label");
        String tag = (String) lineItem.get("tag");

        // Canvas typically includes quiz information in the line item
        // We can identify quizzes by checking for quiz-related tags or URLs
        if (tag != null && tag.contains("quiz")) {
            return true;
        }

        // Check if the label contains quiz indicators
        if (label != null && label.toLowerCase().contains("quiz")) {
            return true;
        }

        // Check if the resource link URL contains quiz indicators
        Object resourceLinkId = lineItem.get("resourceLinkId");
        if (resourceLinkId != null && resourceLinkId.toString().contains("quiz")) {
            return true;
        }

        // For now, include all line items as potential quizzes
        // We can refine this logic based on actual Canvas AGS responses
        return true;
    }

    /**
     * Converts an AGS line item to a Quiz object.
     *
     * @param lineItem The line item data
     * @param courseId The course ID
     * @return Quiz object or null if conversion failed
     */
    private Quiz convertLineItemToQuiz(Map<String, Object> lineItem, String courseId) {
        try {
            Quiz quiz = new Quiz();
            
            // Extract basic information
            quiz.setId(lineItem.get("id").toString());
            quiz.setTitle((String) lineItem.get("label"));
            quiz.setCourseId(courseId);
            
            // Set description if available
            String tag = (String) lineItem.get("tag");
            quiz.setDescription(tag != null ? tag : "");
            
            // Try to construct HTML URL
            String resourceLinkId = (String) lineItem.get("resourceLinkId");
            if (resourceLinkId != null) {
                String htmlUrl = canvasApiConfig.getCanvasDomain() + "/courses/" + courseId + "/assignments/" + resourceLinkId;
                quiz.setHtmlUrl(htmlUrl);
            }
            
            log.debug("Converted line item to quiz: {} - {}", quiz.getId(), quiz.getTitle());
            return quiz;
            
        } catch (Exception e) {
            log.error("Error converting line item to quiz", e);
            return null;
        }
    }
}
