package org.kentdenver.sebcanvas.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.InMemoryOAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.AuthenticatedPrincipalOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;

/**
 * Configuration for OAuth2 client registration.
 *
 * This class provides a manual ClientRegistrationRepository using the values from CanvasApiConfig.
 * By implementing our own OAuth2 configuration, we avoid the automatic validation
 * that Spring performs which was causing our application to fail on startup.
 */
@Configuration
@Slf4j
public class OAuth2ClientConfig {

    /**
     * Creates a ClientRegistrationRepository using values from CanvasApiConfig.
     *
     * @param canvasApiConfig The Canvas API configuration with client ID and secret
     * @return A ClientRegistrationRepository with Canvas API client registration
     */
    @Bean
    public ClientRegistrationRepository clientRegistrationRepository(CanvasApiConfig canvasApiConfig) {
        String clientId = canvasApiConfig.getClientId();
        String clientSecret = canvasApiConfig.getClientSecret();
        String redirectUri = canvasApiConfig.getRedirectUri();

        // Create Canvas API scopes - request scopes needed for quiz access
        Set<String> scopes = new HashSet<>();
        // Add scopes for quiz access - these are the specific scopes needed
        scopes.add("url:GET|/api/v1/courses");
        scopes.add("url:GET|/api/v1/courses/:course_id/quizzes");
        scopes.add("url:GET|/api/v1/courses/:course_id");
        // Note: LTI scopes are NOT requested via OAuth2, they come from LTI launch

        // Only create a real registration if we have client ID and secret
        if (clientId != null && !clientId.isEmpty() && clientSecret != null && !clientSecret.isEmpty()) {
            log.info("Creating Canvas API OAuth2 client registration with ID: {}",
                    clientId.length() > 8 ? clientId.substring(0, 4) + "..." : clientId);

            // Build the client registration
            ClientRegistration registration = ClientRegistration.withRegistrationId("canvas-api")
                    .clientId(clientId)
                    .clientSecret(clientSecret)
                    .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                    .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                    .redirectUri(redirectUri)
                    .scope(scopes)
                    .authorizationUri("https://kentdenver.instructure.com/login/oauth2/auth")
                    .tokenUri("https://kentdenver.instructure.com/login/oauth2/token")
                    .userInfoUri("https://kentdenver.instructure.com/api/v1/users/self")
                    .userNameAttributeName("id")
                    .build();

            return new InMemoryClientRegistrationRepository(registration);
        }

        // If we don't have credentials, log a clear warning
        log.error("MISSING CREDENTIALS: Canvas API OAuth2 client credentials not found!");
        log.error("Please ensure client_id and client_secret are set in Secret Manager");
        log.error("or as environment variables.");

        // Create an empty repository as a fallback
        return new InMemoryClientRegistrationRepository(Collections.emptyList());
    }

    /**
     * Creates an OAuth2AuthorizedClientService based on the ClientRegistrationRepository.
     * This service is responsible for persisting OAuth2 tokens.
     *
     * @param clientRegistrationRepository The repository of client registrations
     * @return An OAuth2AuthorizedClientService implementation
     */
    @Bean
    public OAuth2AuthorizedClientService authorizedClientService(
            ClientRegistrationRepository clientRegistrationRepository) {
        return new InMemoryOAuth2AuthorizedClientService(clientRegistrationRepository);
    }

    /**
     * Creates an OAuth2AuthorizedClientRepository based on the service.
     * This is needed for OAuth2 login to work properly.
     *
     * @param clientService The OAuth2AuthorizedClientService for persistence
     * @return A repository for OAuth2 authorized clients
     */
    @Bean
    public OAuth2AuthorizedClientRepository authorizedClientRepository(
            OAuth2AuthorizedClientService clientService) {
        return new AuthenticatedPrincipalOAuth2AuthorizedClientRepository(clientService);
    }

    // REMOVED: authorizedClientManager method which was causing the conflict
    // This method already exists in SecurityConfig.java
}