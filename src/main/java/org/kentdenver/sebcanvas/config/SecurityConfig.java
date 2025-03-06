package org.kentdenver.sebcanvas.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Security configuration for the Canvas SEB Integration application.
 * Configures endpoints that are accessible without authentication for LTI flows.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /**
     * Configures the security filter chain.
     * - Disables CSRF for LTI endpoints (required for POST requests)
     * - Allows access to LTI endpoints without authentication
     * - Allows access to SEB endpoints without authentication
     * - Secures all other endpoints
     *
     * @param http The HttpSecurity to configure
     * @return The configured SecurityFilterChain
     * @throws Exception If configuration fails
     */
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                // Disable CSRF for LTI endpoints (required for LTI 1.3 launches)
                .csrf(csrf -> csrf
                        .ignoringAntMatchers("/lti/**", "/seb/**", "/h2-console/**")
                )
                // Configure authorization for endpoints
                .authorizeRequests(auth -> auth
                        // LTI endpoints must be accessible without authentication
                        .antMatchers("/lti/**").permitAll()
                        // SEB config endpoints must be accessible without authentication
                        .antMatchers("/seb/**").permitAll()
                        // H2 console access (for development only)
                        .antMatchers("/h2-console/**").permitAll()
                        // Static resources
                        .antMatchers("/css/**", "/js/**", "/images/**", "/favicon.ico").permitAll()
                        // Require authentication for all other endpoints
                        .anyRequest().authenticated()
                )
                // Configure form login for admin access
                .formLogin(form -> form
                        .loginPage("/login")
                        .permitAll()
                )
                // Configure logout
                .logout(logout -> logout
                        .logoutUrl("/logout")
                        .logoutSuccessUrl("/login?logout")
                        .permitAll()
                )
                // Allow iframe embedding for LTI
                .headers(headers -> headers
                        .frameOptions().sameOrigin()
                );

        return http.build();
    }
}