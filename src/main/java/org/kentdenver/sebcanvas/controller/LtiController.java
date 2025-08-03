package org.kentdenver.sebcanvas.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
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
    // Static encryption key for state parameter - this should ideally be in a secure configuration
    // Key must be exactly 32 bytes for AES-256
    private static final String STATE_ENCRYPTION_KEY = "SEB-Canvas-Integration-State-32B";
    private static final String ALGORITHM = "AES";

    // Session attribute keys for storing LTI launch state
    private static final String SESSION_LAUNCH_DATA = "launchData";

    // Service dependencies
    private final LtiService ltiService;
    private final LtiConfig ltiConfig;
    private final SebDetector sebDetector;
    private final CanvasService canvasService;
    private final QuizService quizService;
    private final SebService sebService;
    private final CanvasApiService canvasApiService;

    /**
     * Constructor with dependency injection for all required services.
     */
    @Autowired
    public LtiController(
            LtiService ltiService,
            LtiConfig ltiConfig,
            SebDetector sebDetector,
            @Qualifier("oauthCanvasService") CanvasService canvasService,
            QuizService quizService,
            SebService sebService,
            CanvasApiService canvasApiService) {
        this.ltiService = ltiService;
        this.ltiConfig = ltiConfig;
        this.sebDetector = sebDetector;
        this.canvasService = canvasService;
        this.quizService = quizService;
        this.sebService = sebService;
        this.canvasApiService = canvasApiService;
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
        UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(ltiConfig.getAuthUrl())
                .queryParam("scope", "openid")
                .queryParam("response_type", "id_token")
                .queryParam("client_id", clientId)
                .queryParam("redirect_uri", targetLinkUri)
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

            // Also store user ID for easy access
            session.setAttribute("canvas_user_id", launchData.getUserId());
            session.setAttribute("canvas_course_id", launchData.getCourseId());

            // Detect if this is a Deep Linking request or a resource launch
            String messageType = launchData.getMessageType();

            log.debug("LTI message type: {}", messageType);

            // Check if the user is using SEB
            boolean isUsingSeb = sebDetector.isRequestFromSEB(request, null);
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

        // Check if the user has authorized the Canvas API
        boolean hasApiAuthorization = canvasService.hasValidCredentials(userId);
        model.addAttribute("hasApiAuthorization", hasApiAuthorization);

        // If the user hasn't authorized the API, show the authorization page
        if (!hasApiAuthorization) {
            log.info("User {} does not have Canvas API authorization. Redirecting to authorization page", userId);

            // Generate the OAuth2 authorization URL
            String authUrl = request.getContextPath() + "/api/oauth2authorize?course_id=" +
                    courseId + "&user_id=" + userId +
                    "&redirect_url=" + request.getRequestURI();

            model.addAttribute("authUrl", authUrl);
            model.addAttribute("needsAuthorization", true);

            // Return the view that will show the authorization button
            return "apiAuthorization";
        }

        // User has API access, proceed with normal flow
        if (isInstructor) {
            // Instructor view - they can manage SEB settings for quizzes
            List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId, userId);
            model.addAttribute("quizzes", quizzes);
            return "teacherView";
        } else {
            // Student view - they see either the quiz or a message about SEB requirements
            String resourceLinkId = launchData.getResourceLinkId();
            Quiz quiz = quizService.getQuiz(resourceLinkId);
            model.addAttribute("quiz", quiz);

            // Get SEB settings for this quiz
            QuizSebSetting sebSetting = null;
            if (quiz != null) {
                sebSetting = quizService.getSebSettingForQuiz(quiz.getId());
            }

            // Check if SEB is required but student is not using it
            if (quiz != null && sebSetting != null && sebSetting.isSebRequired() && !isUsingSeb) {
                // Student needs to use SEB
                // Generate the download URL for the config file
                String configUrl = "/seb/config/" + quiz.getId();
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
        SecretKeySpec secretKey = new SecretKeySpec(
                STATE_ENCRYPTION_KEY.getBytes(StandardCharsets.UTF_8), ALGORITHM);
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
        SecretKeySpec secretKey = new SecretKeySpec(
                STATE_ENCRYPTION_KEY.getBytes(StandardCharsets.UTF_8), ALGORITHM);
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
                    model.addAttribute("quizzes", quizzes);
                    model.addAttribute("courseId", courseId);
                    model.addAttribute("userId", userId);
                    model.addAttribute("hasOAuthAccess", true);

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
}