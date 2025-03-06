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
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.view.RedirectView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpSession;
import java.text.ParseException;
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
 *
 * The controller then routes users to appropriate views based on their roles (instructor or student)
 * and handles SEB configuration and enforcement for quizzes.
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
    private static final String SESSION_CANVAS_USER_ACCESS_TOKEN = "canvas_user_access_token";

    // Service dependencies
    private final LtiService ltiService;
    private final LtiConfig ltiConfig;
    private final SebDetector sebDetector;
    private final CanvasService canvasService;
    private final QuizService quizService;
    private final SebService sebService;

    /**
     * Constructor with dependency injection for all required services.
     *
     * @param ltiService Service for LTI token validation and processing
     * @param ltiConfig Configuration for LTI integration
     * @param sebDetector Utility for detecting SEB usage
     * @param canvasService Service for Canvas API interactions
     * @param quizService Service for quiz management
     * @param sebService Service for SEB configuration generation
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
     * Canvas redirects users to this endpoint when they click on an LTI tool. The method
     * validates the issuer, generates CSRF protection state and nonce parameters, and
     * redirects to Canvas's authorization endpoint.
     *
     * @param iss The issuer (Canvas)
     * @param loginHint The login hint for the user
     * @param targetLinkUri The target link URI to redirect to after successful authentication
     * @param clientId The client ID from Canvas for this LTI tool
     * @param ltiMessageHint Additional LTI specific context information
     * @param deploymentId The deployment ID identifying the specific tool installation
     * @param canvasRegion The AWS region of the Canvas instance
     * @param canvasEnvironment The Canvas environment (production, beta, test)
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
            HttpSession session) {

        log.debug("LTI login initiation received: iss={}, loginHint={}, targetLinkUri={}, clientId={}, deploymentId={}, region={}, env={}",
                iss, loginHint, targetLinkUri, clientId, deploymentId, canvasRegion, canvasEnvironment);

        // Validate the issuer - This must match the configured issuer from Canvas
        // For Canvas, this is always https://canvas.instructure.com regardless of the specific domain
        if (!ltiConfig.getIssuer().equals(iss)) {
            log.error("Invalid issuer: {}", iss);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid issuer");
        }

        // Generate a state parameter for CSRF protection
        // This will be checked on return to verify the authentication response is for this request
        String state = UUID.randomUUID().toString();
        session.setAttribute(SESSION_OIDC_STATE, state);

        // Generate a nonce for replay protection
        // This helps prevent replay attacks by ensuring the token can only be used once
        String nonce = UUID.randomUUID().toString();
        session.setAttribute(SESSION_NONCE, nonce);

        // Store other parameters for the next step in the session
        session.setAttribute(SESSION_TARGET_LINK_URI, targetLinkUri);
        session.setAttribute(SESSION_LOGIN_HINT, loginHint);
        session.setAttribute(SESSION_CLIENT_ID, clientId);
        if (ltiMessageHint != null) {
            session.setAttribute(SESSION_LTI_MESSAGE_HINT, ltiMessageHint);
        }

        // Construct the authentication request URL
        // This follows the OpenID Connect third-party initiated login flow used by Canvas
        // See: https://canvas.instructure.com/doc/api/file.lti_dev_key_config.html
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

        // Include lti_message_hint if available - this contains context about the launch
        if (ltiMessageHint != null) {
            authUrlBuilder.append("&lti_message_hint=").append(ltiMessageHint);
        }

        // Include the deployment_id if available - helps identify the specific tool installation
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
     * Based on the user's role and context, they are directed to appropriate views.
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
        // This ensures the response is for the original authentication request
        String expectedState = (String) session.getAttribute(SESSION_OIDC_STATE);
        if (expectedState == null || !expectedState.equals(state)) {
            log.error("Invalid state parameter: expected={}, received={}", expectedState, state);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid state parameter");
        }

        try {
            // Validate the token and extract LTI data
            // This verifies the signature and checks all required claims
            LtiLaunchData launchData = ltiService.validateToken(idToken);

            // Add launch data to session and model
            // This makes it available for the view and subsequent requests
            model.addAttribute("launchData", launchData);
            session.setAttribute("launchData", launchData);

            // Check if using SEB by examining request headers
            boolean isUsingSeb = sebDetector.isSebBrowser(request);
            model.addAttribute("isUsingSeb", isUsingSeb);

            log.info("LTI launch successful for user: {}, course: {}, resource: {}, using SEB: {}",
                    launchData.getUserId(), launchData.getCourseId(), launchData.getResourceLinkId(), isUsingSeb);

            // Determine the appropriate view based on user role and context
            if (launchData.isInstructor()) {
                log.debug("Instructor launch detected, displaying teacher view");

                // For instructors, get all quizzes in the course
                List<Quiz> quizzes = quizService.getQuizzesForCourse(launchData.getCourseId());
                model.addAttribute("quizzes", quizzes);

                // Add SEB settings for each quiz to the model
                Map<String, Boolean> quizSebRequirements = quizService.getQuizSebRequirements(quizzes);
                model.addAttribute("quizSebRequirements", quizSebRequirements);

                return "teacherView";
            } else if (launchData.isStudent()) {
                log.debug("Student launch detected, checking SEB requirements");

                // For students, check if the current quiz requires SEB
                String quizId = launchData.getResourceLinkId();
                boolean sebRequired = quizService.isSebRequired(quizId);
                model.addAttribute("sebRequired", sebRequired);
                model.addAttribute("quizId", quizId);

                // If SEB is required but the student isn't using it, show the requirement page
                if (sebRequired && !isUsingSeb) {
                    log.debug("SEB required but not using SEB, redirecting to SEB download page");
                    return "sebRequired";
                }

                // If using SEB or SEB not required, show the quiz content
                String quizUrl = quizService.getQuizUrl(quizId);
                model.addAttribute("quizUrl", quizUrl);

                return "studentView";
            } else {
                log.debug("User with undefined role, displaying generic view");
                return "genericView";
            }

            // Note: IOException is not thrown in the above logic, so we're removing it from the catch clause
        } catch (ParseException | JOSEException e) {
            log.error("Error validating LTI token", e);
            model.addAttribute("error", "Failed to validate LTI launch. Please contact your instructor.");
            return "error";
        }
    }

    /**
     * Provides the SEB configuration file for a specific quiz.
     * This generates a .seb file that students can download and use to launch SEB.
     *
     * The method retrieves the quiz URL, generates a SEB configuration for that quiz,
     * and returns it as a downloadable file. This configuration includes the browser exam key
     * and appropriate settings for the Canvas quiz.
     *
     * @param quizId The ID of the quiz
     * @param session The HTTP session with user information
     * @return The SEB configuration file as a download
     */
    @GetMapping("/seb/config/{quizId}")
    @ResponseBody
    public byte[] getSebConfig(@PathVariable String quizId, HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.error("No launch data in session when requesting SEB config");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not authenticated");
        }

        try {
            // Get the Canvas quiz URL
            String quizUrl = quizService.getQuizUrl(quizId);

            // Generate SEB config
            return sebService.generateSebConfig(quizId, quizUrl);
        } catch (Exception e) {
            log.error("Error generating SEB config", e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Error generating SEB config");
        }
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
        model.addAttribute("status", ex.getStatus().value());
        return "error";
    }
}