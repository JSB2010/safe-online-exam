package org.kentdenver.sebcanvas.controller;

import com.nimbusds.jose.JOSEException;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.view.RedirectView;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
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
 *
 * This controller has been modified to work in a stateless environment (Cloud Run) by:
 * 1. Encrypting the nonce in the state parameter passed to/from Canvas
 * 2. Using the encrypted state to retrieve the nonce during launch
 * 3. Supporting both GET and POST methods for login and launch endpoints
 */
@Controller
@RequestMapping("/lti")
@Slf4j
public class LtiController {
    // Static encryption key for state parameter - this should ideally be in a secure configuration
    private static final String STATE_ENCRYPTION_KEY = "SEB-Canvas-Integration-State-Key-2025";
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

    /**
     * Constructor with dependency injection for all required services.
     */
    @Autowired
    public LtiController(
            LtiService ltiService,
            LtiConfig ltiConfig,
            SebDetector sebDetector,
            CanvasService canvasService,
            QuizService quizService,
            SebService sebService) {
        this.ltiService = ltiService;
        this.ltiConfig = ltiConfig;
        this.sebDetector = sebDetector;
        this.canvasService = canvasService;
        this.quizService = quizService;
        this.sebService = sebService;
    }

    /**
     * Handles the OIDC Login Initiation request from Canvas via GET.
     */
    @GetMapping("/login")
    public RedirectView handleLoginGet(
            @RequestParam("iss") String iss,
            @RequestParam("login_hint") String loginHint,
            @RequestParam("target_link_uri") String targetLinkUri,
            @RequestParam("client_id") String clientId,
            @RequestParam(value = "lti_message_hint", required = false) String ltiMessageHint,
            @RequestParam(value = "lti_deployment_id", required = false) String deploymentId,
            @RequestParam(value = "canvas_region", required = false) String canvasRegion,
            @RequestParam(value = "canvas_environment", required = false) String canvasEnvironment,
            @RequestParam(value = "lti_storage_target", required = false) String ltiStorageTarget,
            HttpSession session) {

        log.debug("LTI GET login initiation received: iss={}, clientId={}, region={}, env={}",
                iss, clientId, canvasRegion, canvasEnvironment);

        return handleLoginCommon(iss, loginHint, targetLinkUri, clientId, ltiMessageHint,
                deploymentId, canvasRegion, canvasEnvironment, ltiStorageTarget, session);
    }

    /**
     * Handles the OIDC Login Initiation request from Canvas via POST.
     */
    @PostMapping("/login")
    public RedirectView handleLoginPost(
            @RequestParam("iss") String iss,
            @RequestParam("login_hint") String loginHint,
            @RequestParam("target_link_uri") String targetLinkUri,
            @RequestParam("client_id") String clientId,
            @RequestParam(value = "lti_message_hint", required = false) String ltiMessageHint,
            @RequestParam(value = "lti_deployment_id", required = false) String deploymentId,
            @RequestParam(value = "canvas_region", required = false) String canvasRegion,
            @RequestParam(value = "canvas_environment", required = false) String canvasEnvironment,
            @RequestParam(value = "lti_storage_target", required = false) String ltiStorageTarget,
            HttpSession session) {

        log.debug("LTI POST login initiation received: iss={}, clientId={}, region={}, env={}",
                iss, clientId, canvasRegion, canvasEnvironment);

        return handleLoginCommon(iss, loginHint, targetLinkUri, clientId, ltiMessageHint,
                deploymentId, canvasRegion, canvasEnvironment, ltiStorageTarget, session);
    }

    /**
     * Common logic for handling login requests, shared between GET and POST handlers.
     * Uses encrypted state parameter that includes all session data to be more resilient.
     */
    private RedirectView handleLoginCommon(
            String iss, String loginHint, String targetLinkUri, String clientId,
            String ltiMessageHint, String deploymentId, String canvasRegion,
            String canvasEnvironment, String ltiStorageTarget, HttpSession session) {

        // Validate the issuer - This must match the configured issuer from Canvas
        if (!ltiConfig.getIssuer().equals(iss)) {
            log.error("Invalid issuer: {}", iss);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid issuer");
        }

        // Generate a state parameter for CSRF protection
        String state = UUID.randomUUID().toString();
        log.debug("Generated state: {}", state);

        // Generate a nonce for replay protection
        String nonce = UUID.randomUUID().toString();
        log.debug("Generated nonce: {}", nonce);

        // Create a state object with all the data we need to preserve between requests
        Map<String, String> stateData = new HashMap<>();
        stateData.put("state", state);
        stateData.put("nonce", nonce); // Include nonce in state data

        // Also include all other parameters that might be needed later
        stateData.put("target_link_uri", targetLinkUri);
        stateData.put("login_hint", loginHint);
        stateData.put("client_id", clientId);

        if (ltiMessageHint != null) {
            stateData.put("lti_message_hint", ltiMessageHint);
        }
        if (deploymentId != null) {
            stateData.put("lti_deployment_id", deploymentId);
        }
        if (canvasRegion != null) {
            stateData.put("canvas_region", canvasRegion);
        }
        if (canvasEnvironment != null) {
            stateData.put("canvas_environment", canvasEnvironment);
        }
        if (ltiStorageTarget != null) {
            stateData.put("lti_storage_target", ltiStorageTarget);
        }

        // Encrypt the state data to pass through Canvas
        String encryptedState = "";
        try {
            encryptedState = state; // Default to just using the UUID if encryption fails
            encryptedState = encryptState(stateData);
            log.debug("Created encrypted state parameter with nonce");
        } catch (Exception e) {
            log.error("Error encrypting state data", e);
            // Continue with unencrypted state as fallback
            log.warn("Using unencrypted state as fallback");
        }

        // Construct the authentication request URL to Canvas
        StringBuilder authUrlBuilder = new StringBuilder(ltiConfig.getAuthUrl())
                .append("?client_id=").append(clientId)
                .append("&login_hint=").append(loginHint)
                .append("&redirect_uri=").append(ltiConfig.getToolUrl()).append("/lti/launch")
                .append("&response_type=id_token")
                .append("&scope=openid")
                .append("&state=").append(encryptedState)
                .append("&response_mode=form_post")
                .append("&nonce=").append(nonce)
                .append("&prompt=none");

        // Include lti_message_hint if available
        if (ltiMessageHint != null) {
            authUrlBuilder.append("&lti_message_hint=").append(ltiMessageHint);
        }

        // Include deployment_id if available
        if (deploymentId != null) {
            authUrlBuilder.append("&lti_deployment_id=").append(deploymentId);
        }

        String authUrl = authUrlBuilder.toString();
        log.debug("Redirecting to Canvas authorization URL: {}", authUrl);

        // Redirect the user's browser to Canvas for authentication
        return new RedirectView(authUrl);
    }

    /**
     * Handles the LTI launch request with ID token via POST.
     */
    @PostMapping("/launch")
    public String handleLaunchPost(
            @RequestParam("id_token") String idToken,
            @RequestParam("state") String state,
            HttpSession session,
            Model model,
            HttpServletRequest request) {

        log.debug("LTI launch received with ID token via POST");

        return handleLaunchCommon(idToken, state, session, model, request);
    }

    /**
     * Handles the LTI launch request with ID token via GET.
     */
    @GetMapping("/launch")
    public String handleLaunchGet(
            @RequestParam("id_token") String idToken,
            @RequestParam("state") String state,
            HttpSession session,
            Model model,
            HttpServletRequest request) {

        log.debug("LTI launch received with ID token via GET");

        return handleLaunchCommon(idToken, state, session, model, request);
    }

    /**
     * Common logic for handling launch requests, shared between GET and POST handlers.
     * Decrypts the state parameter to retrieve session data instead of relying on session persistence.
     */
    private String handleLaunchCommon(
            String idToken, String state, HttpSession session, Model model, HttpServletRequest request) {

        log.debug("LTI launch received with ID token and state: {}", state);

        // Extract the nonce from the state parameter
        String nonce = null;

        try {
            // First try to decrypt the state parameter as a JSON object
            Map<String, String> stateData = decryptState(state);
            if (stateData != null && !stateData.isEmpty()) {
                nonce = stateData.get("nonce");
                log.debug("Successfully retrieved nonce from encrypted state: {}", nonce);

                // Restore any other session attributes from state data
                restoreSessionAttributes(stateData, session);
            }
        } catch (Exception e) {
            log.warn("Could not decrypt state parameter: {}", e.getMessage());
            // Continue with null nonce, we'll handle this below
        }

        // If we couldn't get the nonce from the encrypted state, generate a new one
        // This is a fallback and will likely fail token validation, but we might get lucky
        if (nonce == null) {
            log.warn("Nonce not found in state data, validation will likely fail");
            nonce = UUID.randomUUID().toString();
        }

        try {
            // Validate the token with the nonce
            LtiLaunchData launchData = ltiService.validateToken(idToken, nonce);
            log.info("Successfully validated LTI token for user: {}", launchData.getUserId());

            // Add launch data to session and model
            model.addAttribute("launchData", launchData);
            session.setAttribute(SESSION_LAUNCH_DATA, launchData);

            // Check if using SEB by examining request headers
            boolean isUsingSeb = sebDetector.isSebBrowser(request);
            model.addAttribute("isUsingSeb", isUsingSeb);

            log.info("LTI launch successful for user: {}, course: {}, resource: {}, using SEB: {}",
                    launchData.getUserId(), launchData.getCourseId(), launchData.getResourceLinkId(), isUsingSeb);

            // Handle different message types (LtiResourceLinkRequest vs LtiDeepLinkingRequest)
            if ("LtiDeepLinkingRequest".equals(launchData.getMessageType())) {
                return handleDeepLinkingRequest(launchData, model);
            }

            // Standard resource link request - determine view based on user role
            return handleResourceLinkRequest(launchData, isUsingSeb, model, request);
        } catch (ParseException | JOSEException e) {
            log.error("Error validating LTI token: {}", e.getMessage(), e);
            model.addAttribute("error", "Failed to validate LTI launch. Please contact your instructor.");
            model.addAttribute("exception", e.toString());
            return "error";
        }
    }

    /**
     * Encrypt state data map to a secure string for URL parameter
     */
    private String encryptState(Map<String, String> stateData) throws Exception {
        // Convert map to a simple string representation
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> entry : stateData.entrySet()) {
            sb.append(entry.getKey())
                    .append("=")
                    .append(entry.getValue())
                    .append("&");
        }
        // Remove the trailing &
        if (sb.length() > 0) {
            sb.setLength(sb.length() - 1);
        }

        String stateStr = sb.toString();

        // Generate a key from our encryption key
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        byte[] key = sha.digest(STATE_ENCRYPTION_KEY.getBytes(StandardCharsets.UTF_8));
        key = Arrays.copyOf(key, 16); // use only first 128 bit for AES

        SecretKeySpec secretKey = new SecretKeySpec(key, ALGORITHM);
        Cipher cipher = Cipher.getInstance(ALGORITHM);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);

        byte[] encrypted = cipher.doFinal(stateStr.getBytes(StandardCharsets.UTF_8));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(encrypted);
    }

    /**
     * Decrypt state parameter string to a map of values
     */
    private Map<String, String> decryptState(String encryptedState) throws Exception {
        try {
            // Generate key from our encryption key
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] key = sha.digest(STATE_ENCRYPTION_KEY.getBytes(StandardCharsets.UTF_8));
            key = Arrays.copyOf(key, 16); // use only first 128 bit for AES

            SecretKeySpec secretKey = new SecretKeySpec(key, ALGORITHM);
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secretKey);

            byte[] decodedBytes = Base64.getUrlDecoder().decode(encryptedState);
            byte[] decrypted = cipher.doFinal(decodedBytes);
            String stateStr = new String(decrypted, StandardCharsets.UTF_8);

            // Parse the string back to a map
            Map<String, String> stateData = new HashMap<>();
            for (String pair : stateStr.split("&")) {
                String[] keyValue = pair.split("=", 2);
                if (keyValue.length == 2) {
                    stateData.put(keyValue[0], keyValue[1]);
                }
            }

            return stateData;
        } catch (Exception e) {
            log.error("Error decrypting state: {}", e.getMessage(), e);
            throw e;
        }
    }

    /**
     * Restore session attributes from state data
     */
    private void restoreSessionAttributes(Map<String, String> stateData, HttpSession session) {
        // These are the keys we stored in the state data that should be restored to session
        String[] keys = {
                "target_link_uri", "login_hint", "client_id", "lti_message_hint",
                "lti_deployment_id", "canvas_region", "canvas_environment", "lti_storage_target"
        };

        for (String key : keys) {
            String value = stateData.get(key);
            if (value != null) {
                session.setAttribute(key, value);
                log.debug("Restored session attribute: {} = {}", key, value);
            }
        }
    }

    // Inside LtiController.java, update the handleResourceLinkRequest method:

    private String handleResourceLinkRequest(LtiLaunchData launchData, boolean isUsingSeb, Model model, HttpServletRequest request) {
        // Add common attributes
        model.addAttribute("courseId", launchData.getCourseId());
        model.addAttribute("userId", launchData.getUserId());
        model.addAttribute("userRoles", launchData.getRoles());

        // Check if the user is an instructor or admin
        boolean isInstructor = launchData.isInstructor();
        model.addAttribute("isInstructor", isInstructor);

        if (isInstructor) {
            // Instructor view - they can manage SEB settings for quizzes
            List<Quiz> quizzes = quizService.getQuizzesForCourse(launchData.getCourseId());
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
     * Handle a deep linking request (used for content item selection).
     */
    private String handleDeepLinkingRequest(LtiLaunchData launchData, Model model) {
        model.addAttribute("deepLinking", true);
        model.addAttribute("returnUrl", launchData.getDeepLinkReturnUrl());

        // Simplified implementation - would need additional logic to handle content selection
        return "deepLinking";
    }

    /**
     * Error handler for the LTI controller.
     */
    @ExceptionHandler(ResponseStatusException.class)
    public String handleError(ResponseStatusException ex, Model model) {
        model.addAttribute("error", ex.getReason());
        model.addAttribute("status", ex.getStatusCode().value());
        return "error";
    }
}