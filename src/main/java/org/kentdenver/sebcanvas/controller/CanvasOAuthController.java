package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.view.RedirectView;

import jakarta.servlet.http.HttpSession;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Controller for handling Canvas API OAuth2 flow.
 * This controller provides endpoints for initiating OAuth2 authorization
 * and handling the callback from Canvas.
 */
@Controller
@RequestMapping("/api")
@Slf4j
public class CanvasOAuthController {

    private final CanvasApiConfig canvasApiConfig;
    private final ClientRegistrationRepository clientRegistrationRepository;
    private final OAuth2AuthorizedClientService clientService;
    private final CanvasApiService canvasApiService;
    private final RestTemplate restTemplate;

    // Session attribute keys
    private static final String SESSION_REDIRECT_URL = "canvas_oauth_redirect_url";
    private static final String SESSION_USER_ID = "canvas_user_id";
    private static final String SESSION_COURSE_ID = "canvas_course_id";

    @Autowired
    public CanvasOAuthController(
            CanvasApiConfig canvasApiConfig,
            ClientRegistrationRepository clientRegistrationRepository,
            OAuth2AuthorizedClientService clientService,
            CanvasApiService canvasApiService,
            RestTemplate restTemplate) {
        this.canvasApiConfig = canvasApiConfig;
        this.clientRegistrationRepository = clientRegistrationRepository;
        this.clientService = clientService;
        this.canvasApiService = canvasApiService;
        this.restTemplate = restTemplate;
    }

    /**
     * Initiates OAuth2 authorization with Canvas.
     * Redirects the user to Canvas for authorization.
     *
     * @param courseId The course ID to return to after authorization
     * @param userId The user ID for token association
     * @param redirectUrl The URL to redirect to after authorization
     * @param session The HTTP session for storing state
     * @return A redirect to Canvas OAuth2 authorization endpoint
     */
    @GetMapping("/oauth2authorize")
    public RedirectView initiateAuthorization(
            @RequestParam("course_id") String courseId,
            @RequestParam("user_id") String userId,
            @RequestParam(value = "redirect_url", required = false) String redirectUrl,
            HttpSession session) {

        log.info("Initiating Canvas API OAuth2 authorization for user: {}, course: {}", userId, courseId);

        // Store information in session
        session.setAttribute(SESSION_USER_ID, userId);
        session.setAttribute(SESSION_COURSE_ID, courseId);

        // If no redirect URL provided, use a default
        if (redirectUrl == null || redirectUrl.isEmpty()) {
            redirectUrl = "/lti/launch?course_id=" + courseId;
        }
        session.setAttribute(SESSION_REDIRECT_URL, redirectUrl);

        // Get the client registration
        ClientRegistration registration = clientRegistrationRepository.findByRegistrationId("canvas-api");
        if (registration == null) {
            log.error("Canvas API OAuth2 client registration not found");
            return new RedirectView("/error?message=OAuth2+client+registration+not+found");
        }

        // Build the authorization URL
        String authUrl = UriComponentsBuilder
                .fromHttpUrl(registration.getProviderDetails().getAuthorizationUri())
                .queryParam("client_id", registration.getClientId())
                .queryParam("response_type", "code")
                .queryParam("redirect_uri", registration.getRedirectUri())
                .queryParam("scope", String.join(" ", registration.getScopes()))
                .queryParam("state", session.getId()) // Use session ID as state
                .build()
                .toUriString();

        log.debug("Redirecting to Canvas OAuth2 authorization URL: {}", authUrl);

        return new RedirectView(authUrl);
    }

    /**
     * Handles the OAuth2 callback from Canvas.
     * Exchanges the authorization code for an access token.
     *
     * @param code The authorization code from Canvas
     * @param state The state parameter for verification
     * @param error Error code if authorization failed
     * @param session The HTTP session for retrieving state
     * @param model The model for the view
     * @return A redirect to the original URL or an error page
     */
    @GetMapping("/oauth2callback")
    public String handleCallback(
            @RequestParam(value = "code", required = false) String code,
            @RequestParam(value = "state", required = false) String state,
            @RequestParam(value = "error", required = false) String error,
            HttpSession session,
            Model model) {

        log.info("Received OAuth2 callback from Canvas");

        // Check for error
        if (error != null) {
            log.error("Canvas OAuth2 authorization failed: {}", error);
            model.addAttribute("error", "Canvas authorization failed: " + error);
            return "oauthError";
        }

        // Verify state
        if (state == null || !state.equals(session.getId())) {
            log.error("OAuth2 state mismatch. Expected: {}, Received: {}", session.getId(), state);
            model.addAttribute("error", "Invalid state parameter in OAuth2 callback");
            return "oauthError";
        }

        // Verify code
        if (code == null) {
            log.error("No authorization code received in OAuth2 callback");
            model.addAttribute("error", "No authorization code received");
            return "oauthError";
        }

        try {
            // Get client registration
            ClientRegistration registration = clientRegistrationRepository.findByRegistrationId("canvas-api");

            // Exchange code for token
            // In a real implementation, you would use OAuth2AuthorizedClientManager
            // For simplicity, we'll directly make the token request

            String tokenUrl = registration.getProviderDetails().getTokenUri();
            UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(tokenUrl)
                    .queryParam("grant_type", "authorization_code")
                    .queryParam("client_id", registration.getClientId())
                    .queryParam("client_secret", registration.getClientSecret())
                    .queryParam("redirect_uri", registration.getRedirectUri())
                    .queryParam("code", code);

            String tokenResponse = restTemplate.postForObject(builder.toUriString(), null, String.class);

            // Parse the token response - in a real implementation you would use Jackson
            // For simplicity, we'll just log it
            log.debug("Token response: {}", tokenResponse);

            // Extract the access token - in a real implementation, parse with Jackson
            // This is a simplified example - you would parse the JSON properly
            String accessToken = extractAccessToken(tokenResponse);

            // Get user ID from session
            String userId = (String) session.getAttribute(SESSION_USER_ID);

            // Store the token
            if (userId != null && accessToken != null) {
                canvasApiService.storeAccessToken(userId, accessToken);
                log.info("Successfully obtained and stored access token for user: {}", userId);

                // Get the redirect URL from session
                String redirectUrl = (String) session.getAttribute(SESSION_REDIRECT_URL);
                if (redirectUrl != null) {
                    return "redirect:" + redirectUrl;
                }
            }

            // If we get here, something went wrong
            model.addAttribute("error", "Failed to process OAuth2 authorization");
            return "oauthError";

        } catch (Exception e) {
            log.error("Error processing OAuth2 callback", e);
            model.addAttribute("error", "Error processing authorization: " + e.getMessage());
            return "oauthError";
        }
    }

    /**
     * Extracts the access token from the token response.
     * This is a simplified implementation - in production, use proper JSON parsing.
     *
     * @param tokenResponse The token response as a JSON string
     * @return The access token or null if not found
     */
    private String extractAccessToken(String tokenResponse) {
        // This is a very simplistic implementation
        // In production, use Jackson to properly parse the JSON
        if (tokenResponse == null) return null;

        int start = tokenResponse.indexOf("\"access_token\":\"");
        if (start == -1) return null;

        start += 16; // Length of "access_token":"
        int end = tokenResponse.indexOf("\"", start);
        if (end == -1) return null;

        return tokenResponse.substring(start, end);
    }

    /**
     * Simple endpoint to check the authorization status for a user.
     *
     * @param userId The user ID to check
     * @return A page showing the authorization status
     */
    @GetMapping("/oauth2status")
    public String checkAuthorizationStatus(
            @RequestParam("user_id") String userId,
            Model model) {

        boolean hasToken = canvasApiService.hasAccessToken(userId);
        model.addAttribute("userId", userId);
        model.addAttribute("hasToken", hasToken);

        return "oauth2Status";
    }
}