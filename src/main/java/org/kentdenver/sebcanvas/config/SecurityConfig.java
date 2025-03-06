package org.kentdenver.sebcanvas.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf().disable()  // Disable CSRF for LTI endpoints
                .authorizeRequests()
                .antMatchers("/lti/**").permitAll()  // LTI endpoints are public
                .antMatchers("/student/**").permitAll()  // Student endpoints are public
                .antMatchers("/teacher/**").permitAll()  // Teacher endpoints public for now, could add session validation
                .antMatchers("/static/**", "/css/**", "/js/**", "/images/**").permitAll()  // Static resources
                .antMatchers("/error", "/h2-console/**").permitAll()  // Error pages and H2 console
                .anyRequest().authenticated()  // All other requests need to be authenticated
                .and()
                .headers().frameOptions().sameOrigin();  // Allow iframes from same origin

        return http.build();
    }
}