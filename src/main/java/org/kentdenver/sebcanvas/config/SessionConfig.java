package org.kentdenver.sebcanvas.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.web.servlet.ServletContextInitializer;

import jakarta.servlet.SessionCookieConfig;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletException;

/**
 * Session configuration for the Canvas SEB Integration application.
 *
 * This configuration ensures that sessions work properly in Cloud Run environment
 * by configuring session cookies with appropriate settings for security and persistence.
 */
@Configuration
public class SessionConfig {

    /**
     * Configures session cookie settings for Cloud Run environment.
     * This ensures sessions persist properly across requests.
     */
    @Bean
    public ServletContextInitializer servletContextInitializer() {
        return new ServletContextInitializer() {
            @Override
            public void onStartup(ServletContext servletContext) throws ServletException {
                SessionCookieConfig sessionCookieConfig = servletContext.getSessionCookieConfig();

                // Configure session cookie
                sessionCookieConfig.setName("JSESSIONID");
                sessionCookieConfig.setHttpOnly(true);
                sessionCookieConfig.setSecure(true); // HTTPS only
                sessionCookieConfig.setMaxAge(30 * 60); // 30 minutes
                sessionCookieConfig.setPath("/");

                // Set SameSite to None for iframe embedding (LTI requirement)
                sessionCookieConfig.setAttribute("SameSite", "None");
            }
        };
    }
}
