package org.kentdenver.sebcanvas.controller;

import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import lombok.extern.slf4j.Slf4j;

/**
 * Controller for diagnosing OAuth2 configuration issues.
 * This is for troubleshooting only and should be secured or removed in production.
 *
 * The controller provides endpoints to inspect the OAuth2 client registration details
 * and check if the OAuth2 client is properly configured without revealing sensitive
 * information like the full client secret.
 *
 * Usage:
 * - GET /api/diagnostic/oauth2-config - Returns information about the OAuth2 client configuration
 */
@RestController
@RequestMapping("/api/diagnostic")
@Slf4j
public class OAuth2DiagnosticController {

    private final ClientRegistrationRepository clientRegistrationRepository;
    private final OAuth2AuthorizedClientRepository authorizedClientRepository;

    @Autowired
    public OAuth2DiagnosticController(
            ClientRegistrationRepository clientRegistrationRepository,
            OAuth2AuthorizedClientRepository authorizedClientRepository) {
        this.clientRegistrationRepository = clientRegistrationRepository;
        this.authorizedClientRepository = authorizedClientRepository;
    }

    /**
     * Get information about the configured OAuth2 client registrations.
     * Useful for debugging OAuth2 configuration issues.
     *
     * This endpoint returns:
     * - Client ID (masked for security)
     * - Client secret status (not the actual secret)
     * - Authorization grant type
     * - Redirect URI
     * - Configured scopes
     * - Authorization and token endpoints
     *
     * @return Information about the OAuth2 client registrations
     */
    @GetMapping("/oauth2-config")
    public Map<String, Object> getOAuth2Info() {
        Map<String, Object> info = new HashMap<>();

        try {
            // Get Canvas API registration
            ClientRegistration registration = clientRegistrationRepository.findByRegistrationId("canvas-api");

            if (registration != null) {
                Map<String, Object> registrationInfo = new HashMap<>();
                registrationInfo.put("clientId", maskSensitiveInfo(registration.getClientId()));
                registrationInfo.put("clientSecret", registration.getClientSecret() != null ? "********" : null);
                registrationInfo.put("authorizationGrantType", registration.getAuthorizationGrantType().getValue());
                registrationInfo.put("redirectUri", registration.getRedirectUri());
                registrationInfo.put("scopes", registration.getScopes());
                registrationInfo.put("authorizationUri", registration.getProviderDetails().getAuthorizationUri());
                registrationInfo.put("tokenUri", registration.getProviderDetails().getTokenUri());

                info.put("canvasApiRegistration", registrationInfo);
                info.put("status", "configured");
            } else {
                info.put("status", "not_found");
                info.put("message", "No client registration found with ID 'canvas-api'");
            }
        } catch (Exception e) {
            log.error("Error getting OAuth2 client registration", e);
            info.put("status", "error");
            info.put("error", e.getMessage());
            info.put("errorType", e.getClass().getName());
        }

        return info;
    }

    /**
     * Masks sensitive information like client IDs.
     * Shows only the first 4 and last 4 characters, if available.
     *
     * @param value The value to mask
     * @return The masked value
     */
    private String maskSensitiveInfo(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }

        if (value.length() <= 8) {
            return value;
        }

        return value.substring(0, 4) + "..." +
                value.substring(value.length() - 4);
    }
}