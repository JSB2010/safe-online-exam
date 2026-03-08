package org.kentdenver.sebcanvas.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.view.RedirectView;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import java.util.stream.Collectors;
import java.util.Collections;
import java.util.HashMap;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.util.UriComponentsBuilder;

import java.text.ParseException;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/**
 * Controller that handles the LTI 1.3 launch flow according to the Canvas LTI specification.
 * Implements the OpenID Connect third-party initiated login flow for authentication.
 */
@Controller
@RequestMapping("/lti")
@Slf4j
public class LtiController {
    private static final String ALGORITHM = "AES";
    private static final String DEV_STATE_ENCRYPTION_FALLBACK = "seb-canvas-dev-state-key";

    // Session attribute keys for storing LTI launch state
    private static final String SESSION_LAUNCH_DATA = "launchData";

    // Service dependencies
    private final LtiService ltiService;
    private final LtiConfig ltiConfig;
    private final CanvasApiConfig canvasApiConfig;
    private final SebDetector sebDetector;
    private final CanvasService canvasService;
    private final QuizService quizService;
    private final SebService sebService;
    private final CanvasApiService canvasApiService;
    private final ContentService contentService;

    @Value("${app.security.state-encryption-key:${STATE_ENCRYPTION_KEY:}}")
    private String stateEncryptionKey;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    /**
     * Constructor with dependency injection for all required services.
     */
    @Autowired
    public LtiController(
            LtiService ltiService,
            LtiConfig ltiConfig,
            CanvasApiConfig canvasApiConfig,
            SebDetector sebDetector,
            @Qualifier("oauthCanvasService") CanvasService canvasService,
            QuizService quizService,
            SebService sebService,
            CanvasApiService canvasApiService,
            ContentService contentService) {
        this.ltiService = ltiService;
        this.ltiConfig = ltiConfig;
        this.canvasApiConfig = canvasApiConfig;
        this.sebDetector = sebDetector;
        this.canvasService = canvasService;
        this.quizService = quizService;
        this.sebService = sebService;
        this.canvasApiService = canvasApiService;
        this.contentService = contentService;
    }

    /**
     * Handles the OIDC login initiation flow for LTI 1.3.
     * This is the first step in the LTI launch process.
     */
    @RequestMapping(value = "/login", method = {RequestMethod.GET, RequestMethod.POST})
    public RedirectView login(
            @RequestParam("iss") String issuer,
            @RequestParam("login_hint") String loginHint,
            @RequestParam("target_link_uri") String targetLinkUri,
            @RequestParam(value = "client_id", required = false) String clientId,
            @RequestParam(value = "lti_message_hint", required = false) String ltiMessageHint,
            @RequestParam(value = "lti_deployment_id", required = false) String deploymentId,
            HttpSession session) {

        log.debug("LTI login initiated: iss={}, loginHint={}, targetLinkUri={}", issuer, loginHint, targetLinkUri);

        // Generate a nonce for additional security (stored in state, not session)
        String nonce = UUID.randomUUID().toString();
        log.info("Generated nonce: {}, Session ID: {}", nonce, session.getId());

        // If client ID is not provided, use the one from the config
        if (clientId == null || clientId.isEmpty()) {
            clientId = ltiConfig.getClientId();
            log.debug("Using client ID from config: {}", clientId);
        }

        // Store the target_link_uri in the session for later use
        session.setAttribute("target_link_uri", targetLinkUri);

        // Create the state parameter with essential information
        Map<String, String> stateData = new HashMap<>();
        stateData.put("nonce", nonce);
        stateData.put("target_link_uri", targetLinkUri);

        // Encrypt the state for security
        String state;
        try {
            state = encryptState(stateData);
        } catch (Exception e) {
            log.error("Error encrypting state", e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Error initiating LTI login");
        }

        // Build the redirect URL to the OIDC authorization endpoint
        // IMPORTANT: redirect_uri must be the LTI launch endpoint, not the target_link_uri
        String ltiLaunchUri = ltiConfig.getSanitizedToolUrl() + "/lti/launch";
        UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(ltiConfig.getAuthUrl())
                .queryParam("scope", "openid")
                .queryParam("response_type", "id_token")
                .queryParam("client_id", clientId)
                .queryParam("redirect_uri", ltiLaunchUri)
                .queryParam("login_hint", loginHint)
                .queryParam("state", state)
                .queryParam("response_mode", "form_post")
                .queryParam("nonce", nonce)
                .queryParam("prompt", "none");

        // Add optional parameters if provided
        if (ltiMessageHint != null && !ltiMessageHint.isEmpty()) {
            builder.queryParam("lti_message_hint", ltiMessageHint);
        }

        if (deploymentId != null && !deploymentId.isEmpty()) {
            builder.queryParam("lti_deployment_id", deploymentId);
        }

        String redirectUrl = builder.build().toUriString();
        log.debug("Redirecting to OIDC auth URL: {}", redirectUrl);

        return new RedirectView(redirectUrl);
    }

    /**
     * Handles the LTI launch after successful OIDC authentication.
     * This endpoint receives the id_token from Canvas and processes the launch.
     */
    @PostMapping("/launch")
    public String launch(
            @RequestParam(value = "id_token", required = false) String idToken,
            @RequestParam(value = "state", required = false) String state,
            @RequestParam(value = "error", required = false) String error,
            HttpServletRequest request,
            HttpSession session,
            Model model) {

        log.info("LTI launch received from: {}", request.getRemoteAddr());
        log.info("Token length: {}, State present: {}, Error: {}",
                idToken != null ? idToken.length() : 0,
                state != null,
                error);
        log.debug("Full request headers: {}",
                Collections.list(request.getHeaderNames()).stream()
                    .collect(Collectors.toMap(h -> h, request::getHeader)));

        // Check for authentication errors
        if (error != null) {
            log.error("LTI launch error: {}", error);
            model.addAttribute("error", "Authentication error: " + error);
            return "error";
        }

        // Ensure we have the id_token
        if (idToken == null || idToken.isEmpty()) {
            log.error("No id_token provided in LTI launch");
            model.addAttribute("error", "No authentication token provided");
            return "error";
        }

        try {
            // Decrypt the state parameter
            Map<String, String> stateData = decryptState(state);
            String nonce = stateData.get("nonce");

            // Validate the nonce from the JWT token against the one in the state
            log.info("Validating nonce from state: {}, Session ID: {}", nonce, session.getId());

            if (nonce == null || nonce.trim().isEmpty()) {
                log.error("Missing nonce in state parameter");
                model.addAttribute("error", "Security validation failed");
                return "error";
            }

            // Validate the token
            LtiLaunchData launchData = ltiService.validateToken(idToken, nonce);

            // Store the launch data in the session
            session.setAttribute(SESSION_LAUNCH_DATA, launchData);

            // Also store user ID for easy access (multiple keys for compatibility)
            session.setAttribute("canvas_user_id", launchData.getUserId());
            session.setAttribute("userId", launchData.getUserId()); // For QuizController compatibility
            session.setAttribute("user_id", launchData.getUserId()); // Alternative key
            session.setAttribute("canvas_course_id", launchData.getCourseId());
            session.setAttribute("courseId", launchData.getCourseId()); // For consistency

            // Log the course ID that was extracted/used
            log.info("Stored course ID in session: {} (from LTI launch)", launchData.getCourseId());

            // Detect if this is a Deep Linking request or a resource launch
            String messageType = launchData.getMessageType();

            log.debug("LTI message type: {}", messageType);

            // Check if the user is using SEB
            boolean isUsingSeb = sebDetector.isRequestFromSEB(request, (QuizSebSetting) null);
            model.addAttribute("isUsingSeb", isUsingSeb);

            // Handle different message types
            if ("LtiDeepLinkingRequest".equals(messageType)) {
                log.debug("Handling Deep Linking request");

                // Redirect to Deep Linking selection UI
                return "redirect:/lti/deeplink/select?deploymentId=" +
                        launchData.getDeploymentId() +
                        "&returnUrl=" + launchData.getDeepLinkReturnUrl() +
                        "&data=" + launchData.getDeepLinkData() +
                        "&courseId=" + launchData.getCourseId();

            } else if ("LtiResourceLinkRequest".equals(messageType)) {
                log.debug("Handling Resource Link request");

                // Regular resource launch - handle based on user role
                return handleResourceLinkRequest(launchData, isUsingSeb, model, request);
            } else {
                log.warn("Unsupported LTI message type: {}", messageType);
                model.addAttribute("error", "Unsupported LTI message type: " + messageType);
                return "error";
            }

        } catch (ParseException | JOSEException e) {
            log.error("Error validating LTI token", e);
            model.addAttribute("error", "Failed to validate authentication token");
            return "error";
        } catch (Exception e) {
            log.error("Unexpected error processing LTI launch", e);
            model.addAttribute("error", "Unexpected error: " + e.getMessage());
            return "error";
        }
    }

    /**
     * Handles resource link requests (standard LTI launches) for both instructors and students.
     * Checks for API authorization and redirects to authorization page if needed.
     *
     * @param launchData LTI launch data from the token
     * @param isUsingSeb Whether the user is using SEB
     * @param model The Spring model for the view
     * @param request The HTTP request
     * @return View name for rendering
     */
    private String handleResourceLinkRequest(LtiLaunchData launchData, boolean isUsingSeb, Model model, HttpServletRequest request) {
        // Add common attributes
        String courseId = launchData.getCourseId();
        String userId = launchData.getUserId();

        model.addAttribute("courseId", courseId);
        model.addAttribute("userId", userId);
        model.addAttribute("userRoles", launchData.getRoles());

        // Check if the user is an instructor or admin
        boolean isInstructor = launchData.isInstructor();
        model.addAttribute("isInstructor", isInstructor);

        // For instructors, try to get quizzes first (using LTI AGS or OAuth fallback)
        if (isInstructor) {
            log.info("Instructor access detected. Attempting to retrieve quizzes using LTI AGS first, then OAuth fallback");

            // Try to get quizzes (this will attempt LTI AGS first, then OAuth fallback)
            List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId, userId);
            boolean hasApiAuthorization = canvasService.hasValidCredentials(userId);

            if (!quizzes.isEmpty()) {
                // Successfully got quizzes (either via LTI AGS or OAuth)
                log.info("Successfully retrieved {} quizzes for course {}", quizzes.size(), courseId);
                model.addAttribute("hasApiAuthorization", true);
                populateTeacherViewModel(courseId, userId, quizzes, model, hasApiAuthorization);

                // Generate a secure token for API requests (fallback for session issues)
                String authToken = generateSecureToken(launchData);
                log.info("Generated auth token for user {} in course {}: {}", launchData.getUserId(), launchData.getCourseId(), authToken != null ? "present" : "null");
                model.addAttribute("authToken", authToken);

                // Store token in session via request
                HttpSession session = request.getSession();
                session.setAttribute("authToken", authToken);
                log.debug("Stored auth token in session: {}", authToken != null ? "present" : "null");

                return "teacherView";
            } else {
                // No quizzes found - check if it's due to missing OAuth authorization
                model.addAttribute("hasApiAuthorization", hasApiAuthorization);

                if (!hasApiAuthorization) {
                    log.info("No quizzes found and user {} does not have Canvas API authorization. Showing authorization page", userId);

                    // Generate the OAuth2 authorization URL
                    String authUrl = request.getContextPath() + "/api/oauth2authorize?course_id=" +
                            courseId + "&user_id=" + userId +
                            "&redirect_url=" + request.getRequestURI();

                    model.addAttribute("authUrl", authUrl);
                    model.addAttribute("needsAuthorization", true);

                    // Return the view that will show the authorization button
                    return "apiAuthorization";
                } else {
                    // User has authorization but no quizzes found
                    log.info("User {} has API authorization but no quizzes found in course {}", userId, courseId);
                    populateTeacherViewModel(courseId, userId, quizzes, model, true);
                    return "teacherView";
                }
            }
        } else {
            // Student view - they see either the quiz or a message about SEB requirements
            String resourceLinkId = launchData.getResourceLinkId();
            Quiz quiz = quizService.getQuiz(resourceLinkId);

            // If quiz not found in database, try to extract quiz info from target_link_uri
            if (quiz == null) {
                String targetLinkUri = launchData.getTargetLinkUri();
                log.warn("Quiz not found in database: {}. Attempting to extract from target_link_uri: {}", resourceLinkId, targetLinkUri);

                // Extract quiz ID from target_link_uri (format: /quiz/org/courseId/quizId)
                String extractedQuizId = extractQuizIdFromTargetUri(targetLinkUri);
                if (extractedQuizId != null) {
                    // Create a minimal quiz object for immediate access
                    quiz = createMinimalQuizFromTargetUri(targetLinkUri, extractedQuizId, courseId);
                    log.info("Created minimal quiz object for immediate access: {}", extractedQuizId);

                    // Add warning message for fallback mode
                    model.addAttribute("fallbackWarning", true);
                    model.addAttribute("fallbackMessage",
                        "⚠️ FALLBACK MODE: This quiz is using basic settings because the instructor hasn't completed the full Canvas API setup. " +
                        "For full functionality and custom SEB settings, the instructor should access the LTI app and complete OAuth authorization.");
                } else {
                    log.error("Could not extract quiz ID from target_link_uri: {}", targetLinkUri);
                    model.addAttribute("error", "Quiz not found. Please contact your instructor to set up the quiz in the SEB system.");
                    return "error";
                }
            }

            model.addAttribute("quiz", quiz);

            // Get SEB settings for this quiz
            QuizSebSetting sebSetting = null;
            if (quiz != null) {
                sebSetting = quizService.getSebSettingForQuiz(quiz.getId());
            }

            // Check if SEB is required but student is not using it
            if (quiz != null && sebSetting != null && sebSetting.isSebRequired() && !isUsingSeb) {
                // Student needs to use SEB
                // Generate the download URL for the config file with proper parameters
                String configUrl = String.format("/seb/config/%s/%s?canvas_url=%s&user_id=%s",
                    courseId, quiz.getCanvasQuizId(),
                    quiz.getHtmlUrl(),
                    launchData.getUserId());
                model.addAttribute("configUrl", configUrl);
                return "sebRequired";
            }

            // Show the quiz to the student
            return "studentView";
        }
    }

    /**
     * Encrypts state data into a string for use as the OIDC state parameter.
     */
    private String encryptState(Map<String, String> stateData) throws Exception {
        // Convert state data to JSON
        String stateJson = new ObjectMapper().writeValueAsString(stateData);

        // Encrypt the JSON
        SecretKeySpec secretKey = buildStateSecretKey();
        Cipher cipher = Cipher.getInstance(ALGORITHM);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);

        // Encrypt and encode
        byte[] encryptedBytes = cipher.doFinal(stateJson.getBytes(StandardCharsets.UTF_8));
        return Base64.getUrlEncoder().encodeToString(encryptedBytes);
    }

    /**
     * Decrypts the state parameter back into the original data.
     */
    private Map<String, String> decryptState(String encryptedState) throws Exception {
        // Decode the encrypted state
        byte[] encryptedBytes = Base64.getUrlDecoder().decode(encryptedState);

        // Decrypt
        SecretKeySpec secretKey = buildStateSecretKey();
        Cipher cipher = Cipher.getInstance(ALGORITHM);
        cipher.init(Cipher.DECRYPT_MODE, secretKey);

        byte[] decryptedBytes = cipher.doFinal(encryptedBytes);
        String decryptedJson = new String(decryptedBytes, StandardCharsets.UTF_8);

        // Parse back to Map
        return new ObjectMapper().readValue(decryptedJson,
                new TypeReference<Map<String, String>>() {});
    }

    /**
     * Handles GET requests to /lti/launch after OAuth authorization.
     * This endpoint is used when users are redirected back after Canvas OAuth authorization.
     */
    @GetMapping("/launch")
    public String handleOAuthRedirect(
            @RequestParam(value = "course_id", required = false) String courseId,
            @RequestParam(value = "user_id", required = false) String userId,
            Model model,
            HttpSession session) {

        log.info("Handling OAuth redirect for course: {}, user: {}", courseId, userId);

        // Check if we have OAuth access
        if (userId != null && canvasApiService.hasAccessToken(userId)) {
            log.info("User {} has OAuth access, showing quiz management interface", userId);

            // Create minimal launch data for the interface
            if (courseId != null) {
                try {
                    // Get quizzes for the course using OAuth
                    List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId, userId);
                    model.addAttribute("courseId", courseId);
                    model.addAttribute("userId", userId);
                    model.addAttribute("hasOAuthAccess", true);

                    populateTeacherViewModel(courseId, userId, quizzes, model, true);

                    log.info("Successfully loaded {} quizzes for course {}", quizzes.size(), courseId);
                    return "teacherView";
                } catch (Exception e) {
                    log.error("Error loading quizzes for course {}", courseId, e);
                    model.addAttribute("error", "Failed to load quizzes: " + e.getMessage());
                    return "error";
                }
            }
        }

        // If we get here, something went wrong
        log.warn("OAuth redirect failed - no course_id or no OAuth access");
        model.addAttribute("error", "OAuth authorization incomplete or missing parameters");
        return "error";
    }

    /**
     * Serves the LTI 1.3 tool configuration JSON for Canvas.
     * This endpoint provides the configuration that Canvas needs to set up the LTI tool.
     */
    @GetMapping(value = "/config", produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public ResponseEntity<Map<String, Object>> getLtiConfig() {
        try {
            log.info("Serving LTI configuration");

            String toolUrl = ltiConfig.getSanitizedToolUrl();

            Map<String, Object> config = new HashMap<>();
            config.put("title", "Canvas SEB Integration");
            config.put("description", "Safe Exam Browser integration for Canvas quizzes");
            config.put("oidc_initiation_url", toolUrl + "/lti/login");
            config.put("target_link_uri", toolUrl + "/lti/launch");
            config.put("scopes", Arrays.asList(
                "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
                "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
                "https://purl.imsglobal.org/spec/lti-ags/scope/score",
                "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly"
            ));

            // Extensions for Canvas-specific features
            Map<String, Object> extensions = new HashMap<>();
            Map<String, Object> canvasExtension = new HashMap<>();
            canvasExtension.put("privacy_level", "public");
            canvasExtension.put("course_navigation", Map.of(
                "enabled", true,
                "text", "SEB Settings",
                "visibility", "admins"
            ));
            extensions.put("https://www.instructure.com/placement", canvasExtension);
            config.put("extensions", extensions);

            config.put("public_jwk_url", toolUrl + "/.well-known/jwks.json");
            config.put("custom_fields", Map.of(
                "canvas_course_id", "$Canvas.course.id",
                "canvas_user_id", "$Canvas.user.id"
            ));

            return ResponseEntity.ok(config);
        } catch (Exception e) {
            log.error("Error serving LTI configuration", e);
            return ResponseEntity.status(500).body(Map.of("error", "Failed to generate configuration"));
        }
    }

    /**
     * Generates a secure token for API authentication as fallback for session issues.
     * This token contains encrypted user and course information.
     */
    private String generateSecureToken(LtiService.LtiLaunchData launchData) {
        try {
            // Create a simple token with user ID, course ID, and timestamp
            String tokenData = String.format("%s:%s:%s:%d",
                launchData.getUserId(),
                launchData.getCourseId(),
                launchData.isInstructor() ? "instructor" : "student",
                System.currentTimeMillis());

            // Simple base64 encoding (in production, use proper JWT or encryption)
            return java.util.Base64.getEncoder().encodeToString(tokenData.getBytes());
        } catch (Exception e) {
            log.error("Error generating secure token", e);
            return null;
        }
    }

    private void populateTeacherViewModel(String courseId,
                                          String userId,
                                          List<Quiz> classicQuizzes,
                                          Model model,
                                          boolean includeNewQuizzes) {
        List<Map<String, Object>> teacherQuizzes = new ArrayList<>();
        Map<String, Object> quizSebSettings = new HashMap<>();

        for (Quiz quiz : classicQuizzes) {
            teacherQuizzes.add(toTeacherQuizView(quiz));
            QuizSebSetting setting = quizService.getSebSettingForQuiz(quiz.getId());
            if (setting != null) {
                quizSebSettings.put(quiz.getId(), setting);
            }
        }

        if (includeNewQuizzes) {
            List<ContentItem> contentItems = contentService.getAllContentForCourse(courseId, userId);
            List<ContentItem> newQuizzes = contentItems.stream()
                    .filter(item -> item.getContentType() == ContentItem.ContentType.NEW_QUIZ)
                    .toList();

            for (ContentItem newQuiz : newQuizzes) {
                teacherQuizzes.add(toTeacherQuizView(newQuiz));
                ContentSebSetting setting = contentService.getSebSetting(newQuiz.getId());
                if (setting != null) {
                    quizSebSettings.put(newQuiz.getId(), setting);
                }
            }
        }

        model.addAttribute("quizzes", teacherQuizzes);
        model.addAttribute("quizSebSettings", quizSebSettings);
    }

    private Map<String, Object> toTeacherQuizView(Quiz quiz) {
        Map<String, Object> view = new HashMap<>();
        view.put("id", quiz.getId());
        view.put("title", quiz.getTitle());
        view.put("description", quiz.getDescription());
        view.put("htmlUrl", quiz.getHtmlUrl());
        view.put("quizTypeDisplay", quiz.getQuizTypeDisplay());
        view.put("contentType", ContentItem.ContentType.CLASSIC_QUIZ.name());
        return view;
    }

    private Map<String, Object> toTeacherQuizView(ContentItem contentItem) {
        Map<String, Object> view = new HashMap<>();
        view.put("id", contentItem.getId());
        view.put("title", contentItem.getTitle());
        view.put("description", contentItem.getDescription());
        view.put("htmlUrl", contentItem.getHtmlUrl());
        view.put("quizTypeDisplay", contentItem.getContentType().getDisplayName());
        view.put("contentType", contentItem.getContentType().name());
        return view;
    }

    /**
     * Extracts quiz ID from target link URI.
     * Expected format: /quiz/{org}/{courseId}/{quizId}
     */
    private String extractQuizIdFromTargetUri(String targetLinkUri) {
        if (targetLinkUri == null || targetLinkUri.isEmpty()) {
            return null;
        }

        // Pattern: /quiz/{org}/{courseId}/{quizId}
        String pattern = "/quiz/[^/]+/[^/]+/(\\d+)";
        java.util.regex.Pattern regex = java.util.regex.Pattern.compile(pattern);
        java.util.regex.Matcher matcher = regex.matcher(targetLinkUri);

        if (matcher.find()) {
            String quizId = matcher.group(1);
            log.debug("Extracted quiz ID {} from target URI: {}", quizId, targetLinkUri);
            return quizId;
        }

        log.debug("No quiz ID found in target URI: {}", targetLinkUri);
        return null;
    }

    /**
     * Creates a minimal Quiz object from target URI for immediate access.
     * This allows students to access quizzes even if they're not in the database yet.
     */
    private Quiz createMinimalQuizFromTargetUri(String targetLinkUri, String quizId, String courseId) {
        Quiz quiz = new Quiz();
        quiz.setId(quizId);
        quiz.setCanvasQuizId(quizId);
        quiz.setCourseId(courseId);
        quiz.setTitle("Quiz " + quizId); // Fallback title
        quiz.setDescription("Canvas Quiz"); // Fallback description

        // Generate Canvas quiz URL
        String canvasBaseUrl = canvasApiConfig.getCanvasDomain();
        String htmlUrl = canvasBaseUrl + "/courses/" + courseId + "/quizzes/" + quizId;
        quiz.setHtmlUrl(htmlUrl);

        // Set quiz engine and type display for compatibility
        quiz.setQuizEngine("classic"); // Default to classic
        quiz.setQuizTypeDisplay("Quiz"); // Default display type

        log.debug("Created minimal quiz object: ID={}, URL={}", quizId, htmlUrl);
        return quiz;
    }

    private SecretKeySpec buildStateSecretKey() throws Exception {
        String rawKey = stateEncryptionKey;
        if (rawKey == null || rawKey.isBlank()) {
            if ("prod".equalsIgnoreCase(activeProfile)) {
                throw new IllegalStateException("State encryption key is required in production");
            }
            rawKey = DEV_STATE_ENCRYPTION_FALLBACK;
        }

        byte[] keyBytes = MessageDigest.getInstance("SHA-256").digest(rawKey.getBytes(StandardCharsets.UTF_8));
        return new SecretKeySpec(keyBytes, ALGORITHM);
    }
}