package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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
import java.util.Map;
import java.util.HashMap;
import java.util.UUID;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/**
 * Controller for handling Canvas API OAuth2 flow.
 * This controller provides endpoints for initiating OAuth2 authorization
 * and handling the callback from Canvas.
 */
@Controller
@RequestMapping("/api")
@Slf4j
public class CanvasOAuthController {

    private static final String ALGORITHM = "AES";
    private static final String DEV_STATE_ENCRYPTION_FALLBACK = "seb-canvas-dev-state-key";

    private final CanvasApiConfig canvasApiConfig;
    private final ClientRegistrationRepository clientRegistrationRepository;
    private final OAuth2AuthorizedClientService clientService;
    private final CanvasApiService canvasApiService;
    private final RestTemplate restTemplate;

    @Value("${app.security.state-encryption-key:${STATE_ENCRYPTION_KEY:}}")
    private String stateEncryptionKey;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

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
     * Clears existing OAuth token and initiates new authorization.
     * This is useful when the existing token has insufficient scopes.
     *
     * @param courseId The course ID to return to after authorization
     * @param userId The user ID for token association
     * @param redirectUrl The URL to redirect to after authorization
     * @param session The HTTP session for storing state
     * @return A redirect to Canvas OAuth2 authorization endpoint
     */
    @GetMapping("/oauth2reauthorize")
    public RedirectView reauthorize(
            @RequestParam("course_id") String courseId,
            @RequestParam("user_id") String userId,
            @RequestParam(value = "redirect_url", required = false) String redirectUrl,
            HttpSession session) {

        log.info("Clearing existing OAuth token and reauthorizing for user: {}, course: {}", userId, courseId);

        // Clear existing token to force new authorization
        canvasApiService.clearAccessToken(userId);

        // Proceed with normal authorization flow
        return initiateAuthorization(courseId, userId, redirectUrl, session);
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

        // Create a state parameter that includes the necessary data (encrypted)
        Map<String, String> stateData = new HashMap<>();
        stateData.put("user_id", userId);
        stateData.put("course_id", courseId);
        stateData.put("timestamp", String.valueOf(System.currentTimeMillis()));
        stateData.put("nonce", UUID.randomUUID().toString());

        // If no redirect URL provided, use a default
        if (redirectUrl == null || redirectUrl.isEmpty()) {
            redirectUrl = "/lti/launch?course_id=" + courseId + "&user_id=" + userId;
        }

        // Ensure redirect URL is absolute HTTPS URL
        if (redirectUrl.startsWith("/")) {
            String applicationBaseUrl = canvasApiConfig.getApplicationBaseUrl();
            if (applicationBaseUrl == null || applicationBaseUrl.isBlank()) {
                log.error("Cannot construct OAuth redirect URL because application base URL is not configured");
                return new RedirectView("/error?message=OAuth2+redirect+base+URL+not+configured");
            }
            redirectUrl = applicationBaseUrl + redirectUrl;
        }

        stateData.put("redirect_url", redirectUrl);

        // Get the client registration
        ClientRegistration registration = clientRegistrationRepository.findByRegistrationId("canvas-api");
        if (registration == null) {
            log.error("Canvas API OAuth2 client registration not found");
            return new RedirectView("/error?message=OAuth2+client+registration+not+found");
        }

        // Encrypt the state data
        String encryptedState;
        try {
            encryptedState = encryptState(stateData);
        } catch (Exception e) {
            log.error("Error encrypting OAuth state", e);
            return new RedirectView("/error?message=OAuth2+state+encryption+failed");
        }

        // Build the authorization URL
        String scopeString = String.join(" ", registration.getScopes());
        log.info("Requesting OAuth2 scopes: {}", scopeString);

        String authUrl = UriComponentsBuilder
                .fromHttpUrl(registration.getProviderDetails().getAuthorizationUri())
                .queryParam("client_id", registration.getClientId())
                .queryParam("response_type", "code")
                .queryParam("redirect_uri", registration.getRedirectUri())
                .queryParam("scope", scopeString)
                .queryParam("state", encryptedState)
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
            @RequestParam(value = "error_description", required = false) String errorDescription,
            HttpSession session,
            Model model) {

        log.info("Received OAuth2 callback from Canvas");
        log.debug("OAuth2 callback parameters - code: {}, state: {}, error: {}, error_description: {}",
                code != null ? "[PRESENT]" : "[MISSING]",
                state != null ? "[PRESENT]" : "[MISSING]",
                error, errorDescription);

        // Check for error
        if (error != null) {
            log.error("Canvas OAuth2 authorization failed: {} - {}", error, errorDescription);
            String fullError = error;
            if (errorDescription != null) {
                fullError += ": " + errorDescription;
            }
            model.addAttribute("error", "Canvas authorization failed: " + fullError);
            return "oauthError";
        }

        // Decrypt and verify state
        Map<String, String> stateData;
        try {
            stateData = decryptState(state);
        } catch (Exception e) {
            log.error("Error decrypting OAuth state: {}", e.getMessage());
            model.addAttribute("error", "Invalid state parameter in OAuth2 callback");
            return "oauthError";
        }

        // Extract data from state
        String userId = stateData.get("user_id");
        String courseId = stateData.get("course_id");
        String redirectUrl = stateData.get("redirect_url");

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

            // Store the token using data from state
            if (userId != null && accessToken != null) {
                canvasApiService.storeAccessToken(userId, accessToken);
                log.info("Successfully obtained and stored access token for user: {}", userId);

                // Construct redirect URL with proper parameters
                if (redirectUrl != null && courseId != null) {
                    // Ensure the redirect URL has the required parameters (but don't duplicate them)
                    String finalRedirectUrl = redirectUrl;

                    // Only add course_id if it's not already present
                    if (!redirectUrl.contains("course_id=")) {
                        if (redirectUrl.contains("?")) {
                            finalRedirectUrl += "&course_id=" + courseId;
                        } else {
                            finalRedirectUrl += "?course_id=" + courseId;
                        }
                    }

                    // Only add user_id if it's not already present
                    if (!finalRedirectUrl.contains("user_id=")) {
                        finalRedirectUrl += "&user_id=" + userId;
                    }

                    log.info("Redirecting to: {}", finalRedirectUrl);
                    return "redirect:" + finalRedirectUrl;
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

    /**
     * Encrypts state data into a string for use as the OAuth2 state parameter.
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