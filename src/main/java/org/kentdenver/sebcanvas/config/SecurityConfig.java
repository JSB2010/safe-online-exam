package org.kentdenver.sebcanvas.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.beans.factory.annotation.Value;
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
import org.springframework.web.cors.CorsConfigurationSource;

import java.util.Arrays;

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

    @Autowired
    private CorsConfigurationSource corsConfigurationSource;

    private final Environment environment;

    @Value("${app.debug.enabled:false}")
    private boolean debugEnabled;

    @Autowired
    public SecurityConfig(Environment environment) {
        this.environment = environment;
    }

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
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .authorizeHttpRequests(auth -> {
                    if (isDebugAccessEnabled()) {
                        auth.requestMatchers("/api/debug/**", "/api/diagnostic/**").permitAll();
                    } else {
                        auth.requestMatchers("/api/debug/**", "/api/diagnostic/**").denyAll();
                    }

                    auth.requestMatchers(
                            "/",
                            "/health",
                            "/error",
                            "/login",
                            "/login/health",
                            "/favicon.ico",
                            "/favicon.png",
                            "/.well-known/jwks.json",
                            "/lti/**",
                            "/seb/**",
                            "/api/quizzes",
                            "/api/quizzes/view",
                            "/api/quizzes/seb-settings",
                            "/api/quizzes/seb-config",
                            "/api/quizzes/seb-config-structured",
                            "/api/quizzes/course/*/refresh",
                            "/api/quizzes/*",
                            "/api/quizzes/*/seb",
                            "/api/quizzes/*/*/seb/enable",
                            "/api/quizzes/*/*/seb/disable",
                            "/api/quizzes/*/*/seb/config",
                            "/api/quizzes/*/*/seb/status",
                            "/api/seb/access-code/*/*",
                            "/api/seb/canvas-detector.js",
                            "/api/oauth2authorize",
                            "/api/oauth2reauthorize",
                            "/api/oauth2callback",
                            "/api/oauth2status",
                            "/js/**")
                        .permitAll();

                    auth.anyRequest().denyAll();
                })
                .oauth2Login(oauth2 -> oauth2
                        .loginPage("/api/oauth2authorize")
                        .defaultSuccessUrl("/api/oauth2callback")
                        .failureUrl("/error"))
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .headers(headers -> headers.frameOptions(frameOptions -> frameOptions.disable()));

        return http.build();
    }

    private boolean isDebugAccessEnabled() {
        return debugEnabled || Arrays.asList(environment.getActiveProfiles()).contains("dev");
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