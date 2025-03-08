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
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.text.ParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Controller that handles the LTI 1.3 launch flow according to the Canvas LTI specification.
 * Implements the OpenID Connect third-party initiated login flow for authentication.
 *
 * This controller manages three key steps in the LTI flow:
 * 1. Login initiation - Canvas redirects to /lti/login with initialization parameters
 * 2. Authentication request - App redirects to Canvas auth endpoint with OIDC parameters
 * 3. Launch - Canvas redirects back with ID token containing LTI data
 */
@Controller
@RequestMapping("/lti")
@Slf4j
public class LtiController {
    // Session attribute keys for storing LTI launch state
    private static final String SESSION_OIDC_STATE = "oidc_state";
    private static final String SESSION_NONCE = "oidc_nonce";
    private static final String SESSION_TARGET_LINK_URI = "target_link_uri";
    private static final String SESSION_LOGIN_HINT = "login_hint";
    private static final String SESSION_CLIENT_ID = "client_id";
    private static final String SESSION_LTI_MESSAGE_HINT = "lti_message_hint";
    private static final String SESSION_LTI_DEPLOYMENT_ID = "lti_deployment_id";
    private static final String SESSION_LAUNCH_DATA = "launchData";
    private static final String SESSION_CANVAS_REGION = "canvas_region";
    private static final String SESSION_CANVAS_ENVIRONMENT = "canvas_environment";
    private static final String SESSION_LTI_STORAGE_TARGET = "lti_storage_target";

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
     * Handles the OIDC Login Initiation request from Canvas.
     * This is the first step in the LTI 1.3 launch flow based on Canvas LTI documentation.
     *
     * Canvas redirects users to this endpoint when they click on an LTI tool.
     *
     * @param iss The issuer (Canvas)
     * @param loginHint The login hint for the user
     * @param targetLinkUri The target link URI to redirect to after successful authentication
     * @param clientId The client ID from Canvas for this LTI tool
     * @param ltiMessageHint Additional LTI specific context information
     * @param deploymentId The deployment ID identifying the specific tool installation
     * @param canvasRegion The AWS region of the Canvas instance
     * @param canvasEnvironment The Canvas environment (production, beta, test)
     * @param ltiStorageTarget The name of the frame for LTI storage postMessages
     * @param session The HTTP session to store state for the authentication flow
     * @return A redirect to Canvas for authentication
     */
    @GetMapping("/login")
    public RedirectView handleLogin(
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

        log.debug("LTI login initiation received: iss={}, clientId={}, region={}, env={}",
                iss, clientId, canvasRegion, canvasEnvironment);

        // Validate the issuer - This must match the configured issuer from Canvas
        if (!ltiConfig.getIssuer().equals(iss)) {
            log.error("Invalid issuer: {}", iss);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid issuer");
        }

        // Generate a state parameter for CSRF protection
        String state = UUID.randomUUID().toString();
        session.setAttribute(SESSION_OIDC_STATE, state);

        // Generate a nonce for replay protection
        String nonce = UUID.randomUUID().toString();
        session.setAttribute(SESSION_NONCE, nonce);

        // Store parameters in session for the next step
        session.setAttribute(SESSION_TARGET_LINK_URI, targetLinkUri);
        session.setAttribute(SESSION_LOGIN_HINT, loginHint);
        session.setAttribute(SESSION_CLIENT_ID, clientId);

        if (ltiMessageHint != null) {
            session.setAttribute(SESSION_LTI_MESSAGE_HINT, ltiMessageHint);
        }

        if (deploymentId != null) {
            session.setAttribute(SESSION_LTI_DEPLOYMENT_ID, deploymentId);
        }

        if (canvasRegion != null) {
            session.setAttribute(SESSION_CANVAS_REGION, canvasRegion);
        }

        if (canvasEnvironment != null) {
            session.setAttribute(SESSION_CANVAS_ENVIRONMENT, canvasEnvironment);
        }

        if (ltiStorageTarget != null) {
            session.setAttribute(SESSION_LTI_STORAGE_TARGET, ltiStorageTarget);
        }

        // Construct the authentication request URL to Canvas
        StringBuilder authUrlBuilder = new StringBuilder(ltiConfig.getAuthUrl())
                .append("?client_id=").append(clientId)
                .append("&login_hint=").append(loginHint)
                .append("&redirect_uri=").append(ltiConfig.getToolUrl()).append("/lti/launch")
                .append("&response_type=id_token")
                .append("&scope=openid")
                .append("&state=").append(state)
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
     * Handles the LTI launch request with the ID token.
     * This is the third step in the LTI 1.3 launch flow.
     *
     * Canvas redirects back to this endpoint after successful authentication.
     * The ID token contains all the LTI launch data which is validated and processed.
     *
     * @param idToken The ID token from Canvas containing the LTI message
     * @param state The state parameter for CSRF protection validation
     * @param session The HTTP session with stored state
     * @param model The Spring model for the view
     * @param request The HTTP request for SEB detection
     * @return The appropriate view based on user role and context
     */
    @PostMapping("/launch")
    public String handleLaunch(
            @RequestParam("id_token") String idToken,
            @RequestParam("state") String state,
            HttpSession session,
            Model model,
            HttpServletRequest request) {

        log.debug("LTI launch received with ID token");

        // Verify state parameter to prevent CSRF
        String expectedState = (String) session.getAttribute(SESSION_OIDC_STATE);
        if (expectedState == null || !expectedState.equals(state)) {
            log.error("Invalid state parameter: expected={}, received={}", expectedState, state);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid state parameter");
        }

        try {
            // Validate the token and extract LTI data
            String nonce = (String) session.getAttribute(SESSION_NONCE);
            LtiLaunchData launchData = ltiService.validateToken(idToken, nonce);

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
            log.error("Error validating LTI token", e);
            model.addAttribute("error", "Failed to validate LTI launch. Please contact your instructor.");
            return "error";
        }
    }

    /**
     * Handles an LTI deep linking request message type.
     * Used when Canvas is requesting content selection from the tool.
     *
     * @param launchData The LTI launch data
     * @param model The Spring model for the view
     * @return The view name
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
     * Determines the appropriate view based on user role and context.
     *
     * @param launchData The LTI launch data
     * @param isUsingSeb Whether the user is using SEB
     * @param model The Spring model for the view
     * @param request The HTTP request
     * @return The view name
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
     * This generates a .seb file that students can download and use to launch SEB.
     *
     * @param quizId The ID of the quiz
     * @param session The HTTP session with user information
     * @return The SEB configuration file as a download
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
     * Used by Canvas for LTI Platform Storage communication.
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
     * Provides a user-friendly error page with details about what went wrong.
     *
     * @param ex The exception that occurred
     * @param model The Spring model for the view
     * @return The error view
     */
    @ExceptionHandler(ResponseStatusException.class)
    public String handleError(ResponseStatusException ex, Model model) {
        model.addAttribute("error", ex.getReason());
        model.addAttribute("status", ex.getStatusCode().value());
        return "error";
    }
}