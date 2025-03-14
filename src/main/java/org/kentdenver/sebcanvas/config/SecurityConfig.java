package org.kentdenver.sebcanvas.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProvider;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizedClientManager;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Security configuration for the Canvas SEB Integration application.
 *
 * This configuration provides minimal security restrictions to support the LTI flow,
 * while properly configuring OAuth2 login support. It sets up the necessary OAuth2
 * client infrastructure for Canvas API integration.
 *
 * Key features:
 * - Disables CSRF for LTI compatibility
 * - Configures OAuth2 login for Canvas API authorization
 * - Enables frame display for embedded LTI content
 * - Configures authorized client manager for token management
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /**
     * Configures the security filter chain with minimal restrictions.
     * Also sets up OAuth2 login for Canvas API integration.
     *
     * @param http The HttpSecurity to configure
     * @return The configured SecurityFilterChain
     * @throws Exception If configuration fails
     */
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/lti/**", "/api/**", "/seb/**", "/").permitAll()
                        .anyRequest().permitAll())
                .oauth2Login(oauth2 -> oauth2
                        .loginPage("/api/oauth2authorize")
                        .defaultSuccessUrl("/api/oauth2callback")
                        .failureUrl("/error"))
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .headers(headers -> headers.frameOptions(frameOptions -> frameOptions.disable()));

        return http.build();
    }

    /**
     * Creates an OAuth2AuthorizedClientManager.
     * This enables the OAuth2 login flow to work with various authorization types.
     *
     * @param clientRegistrationRepository The repository of client registrations
     * @param authorizedClientRepository The repository of authorized clients
     * @return An OAuth2AuthorizedClientManager
     */
    @Bean
    public OAuth2AuthorizedClientManager authorizedClientManager(
            ClientRegistrationRepository clientRegistrationRepository,
            OAuth2AuthorizedClientRepository authorizedClientRepository) {

        OAuth2AuthorizedClientProvider authorizedClientProvider =
                OAuth2AuthorizedClientProviderBuilder.builder()
                        .authorizationCode()
                        .refreshToken()
                        .clientCredentials()
                        .build();

        DefaultOAuth2AuthorizedClientManager authorizedClientManager =
                new DefaultOAuth2AuthorizedClientManager(
                        clientRegistrationRepository, authorizedClientRepository);

        authorizedClientManager.setAuthorizedClientProvider(authorizedClientProvider);

        return authorizedClientManager;
    }
}