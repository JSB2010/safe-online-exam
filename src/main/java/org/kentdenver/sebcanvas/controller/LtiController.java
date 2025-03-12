package org.kentdenver.sebcanvas.controller;

import com.nimbusds.jose.JOSEException;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
 */
@Controller
@RequestMapping("/lti")
@Slf4j
public class LtiController {
    // Static encryption key for state parameter - this should ideally be in a secure configuration
    private static final String STATE_ENCRYPTION_KEY = "SEB-Canvas-Integration-State-Key-2025";
    private static final String ALGORITHM = "AES";

    // Session attribute keys for storing LTI launch state
    private static final String SESSION_NONCE = "oidc_nonce";
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
        session.setAttribute(SESSION_NONCE, nonce);
        log.debug("Generated nonce: {} and stored in session", nonce);

        // Create a state object with all the data we need to preserve
        Map<String, String> stateData = new HashMap<>();
        stateData.put("state", state);
        stateData.put("target_link_uri", targetLinkUri);
        stateData.put("login_hint", loginHint);
        stateData.put("client_id", clientId);
        stateData.put("nonce", nonce); // Include nonce in state data as backup

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

        // Encrypt the state data
        String encryptedState;
        try {
            encryptedState = encryptState(stateData);
            log.debug("Encrypted state parameter (length: {})", encryptedState.length());
        } catch (Exception e) {
            log.error("Error encrypting state data", e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Error creating state parameter");
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
            @RequestParam("state") String encryptedState,
            HttpSession session,
            Model model,
            HttpServletRequest request) {

        log.debug("LTI launch received with ID token via POST, state length: {}", encryptedState.length());

        return handleLaunchCommon(idToken, encryptedState, session, model, request);
    }

    /**
     * Handles the LTI launch request with ID token via GET.
     */
    @GetMapping("/launch")
    public String handleLaunchGet(
            @RequestParam("id_token") String idToken,
            @RequestParam("state") String encryptedState,
            HttpSession session,
            Model model,
            HttpServletRequest request) {

        log.debug("LTI launch received with ID token via GET, state length: {}", encryptedState.length());

        return handleLaunchCommon(idToken, encryptedState, session, model, request);
    }

    /**
     * Common logic for handling launch requests, shared between GET and POST handlers.
     * Decrypts the state parameter to retrieve session data instead of relying on session persistence.
     */
    private String handleLaunchCommon(
            String idToken, String encryptedState, HttpSession session, Model model, HttpServletRequest request) {

        // First try to decrypt the state parameter to get state data
        Map<String, String> stateData;
        try {
            stateData = decryptState(encryptedState);
            if (stateData == null || stateData.isEmpty()) {
                log.error("Failed to decrypt state parameter or empty result: {}", encryptedState);
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid state parameter (decrypt failed)");
            }

            log.debug("Successfully decrypted state data with {} entries", stateData.size());
        } catch (Exception e) {
            log.error("Error decrypting state parameter: {}", e.getMessage(), e);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid state parameter: " + e.getMessage());
        }

        // Get values from state data
        String originalState = stateData.get("state");
        String nonce = stateData.get("nonce");

        if (originalState == null) {
            log.error("State value missing from decrypted state data");
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid state parameter (missing state)");
        }

        log.debug("Retrieved original state: {} and nonce: {} from state data", originalState, nonce);

        try {
            // Try session nonce first, fallback to state data nonce
            String sessionNonce = (String) session.getAttribute(SESSION_NONCE);
            if (sessionNonce == null) {
                log.warn("Nonce not found in session, using nonce from state data: {}", nonce);
                if (nonce == null) {
                    log.error("Nonce not available in session or state data");
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing nonce for token validation");
                }
            } else {
                nonce = sessionNonce;
                log.debug("Using nonce from session: {}", nonce);
            }

            LtiLaunchData launchData = ltiService.validateToken(idToken, nonce);
            log.info("Successfully validated LTI token for user: {}", launchData.getUserId());

            // Add launch data to session and model
            model.addAttribute("launchData", launchData);
            session.setAttribute(SESSION_LAUNCH_DATA, launchData);

            // Restore other session attributes from state data
            restoreSessionAttributes(stateData, session);

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

            byte[] decrypted = cipher.doFinal(Base64.getUrlDecoder().decode(encryptedState));
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

    /**
     * Handles an LTI deep linking request message type.
     */
    private String handleDeepLinkingRequest(LtiLaunchData launchData, Model model) {
        log.debug("Deep linking request received");

        // Only instructors should be able to select content
        if (!launchData.isInstructor()) {
            log.warn("Non-instructor attempted to access deep linking");
            model.addAttribute("error", "Only instructors can select content");
            return "error";
        }

        // Add necessary data for the content selection view
        model.addAttribute("returnUrl", launchData.getDeepLinkReturnUrl());
        model.addAttribute("deploymentId", launchData.getDeploymentId());

        return "contentSelection";
    }

    /**
     * Handles a standard LTI resource link request.
     */
    private String handleResourceLinkRequest(
            LtiLaunchData launchData,
            boolean isUsingSeb,
            Model model,
            HttpServletRequest request) {

        // For instructors, show the teacher view with quiz management
        if (launchData.isInstructor()) {
            log.debug("Instructor launch detected, displaying teacher view");

            // Get all quizzes in the course
            List<Quiz> quizzes = quizService.getQuizzesForCourse(launchData.getCourseId());
            model.addAttribute("quizzes", quizzes);

            // Add SEB settings for each quiz
            Map<String, Boolean> quizSebRequirements = quizService.getQuizSebRequirements(quizzes);
            model.addAttribute("quizSebRequirements", quizSebRequirements);

            return "teacherView";
        }
        // For students, check if SEB is required for the current resource
        else if (launchData.isStudent()) {
            log.debug("Student launch detected, checking SEB requirements");

            String quizId = launchData.getResourceLinkId();
            boolean sebRequired = quizService.isSebRequired(quizId);
            model.addAttribute("sebRequired", sebRequired);
            model.addAttribute("quizId", quizId);

            // If SEB is required but not being used, show the requirement page
            if (sebRequired && !isUsingSeb) {
                log.debug("SEB required but not using SEB, redirecting to SEB download page");
                return "sebRequired";
            }

            // Student is using SEB or SEB not required, show the quiz content
            String quizUrl = quizService.getQuizUrl(quizId);
            model.addAttribute("quizUrl", quizUrl);

            return "studentView";
        }
        // For other roles, show a generic view
        else {
            log.debug("User with undefined role, displaying generic view");
            return "genericView";
        }
    }

    /**
     * Provides the SEB configuration file for a specific quiz.
     */
    @GetMapping("/seb/config/{quizId}")
    public ResponseEntity<byte[]> getSebConfig(@PathVariable String quizId, HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute(SESSION_LAUNCH_DATA);
        if (launchData == null) {
            log.error("No launch data in session when requesting SEB config");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not authenticated");
        }

        try {
            // Get the Canvas quiz URL
            String quizUrl = quizService.getQuizUrl(quizId);

            // Generate SEB config
            byte[] configData = sebService.generateSebConfig(quizId, quizUrl);

            // Set up response headers for file download
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_OCTET_STREAM)
                    .header("Content-Disposition", "attachment; filename=quiz_" + quizId + ".seb")
                    .body(configData);
        } catch (Exception e) {
            log.error("Error generating SEB config", e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Error generating SEB config");
        }
    }

    /**
     * Endpoint that returns capabilities supported by the tool.
     */
    @PostMapping(value = "/capabilities", produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public Map<String, Object> capabilities() {
        Map<String, Object> capabilities = new HashMap<>();
        capabilities.put("supports_dynamic_registration", false);
        capabilities.put("supported_messages", new String[] {
                "lti.get_data",
                "lti.put_data",
                "lti.capabilities",
                "lti.frameResize"
        });
        return capabilities;
    }

    /**
     * Handles errors that occur during the LTI launch process.
     */
    @ExceptionHandler(ResponseStatusException.class)
    public String handleError(ResponseStatusException ex, Model model) {
        model.addAttribute("error", ex.getReason());
        model.addAttribute("status", ex.getStatusCode().value());
        return "error";
    }
}