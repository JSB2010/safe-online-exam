package org.kentdenver.sebcanvas.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;
import java.util.List;

/**
 * CORS configuration for the Canvas SEB Integration application.
 * 
 * This configuration allows cross-origin requests from Canvas domains
 * so that the JavaScript detector script can fetch access codes from our API
 * when running in Canvas quiz pages.
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    /**
     * Configure CORS mappings for the application.
     * This allows Canvas domains to make API calls to our SEB endpoints.
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/seb/**")
                .allowedOriginPatterns(
                    "https://*.instructure.com",
                    "https://*.canvaslms.com",
                    "https://*.insops.net",
                    "https://*.inscloudgate.net",
                    "https://kentdenver.instructure.com",
                    "https://canvas.instructure.com"
                )
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600); // Cache preflight response for 1 hour
    }

    /**
     * Bean-based CORS configuration as an alternative approach.
     * This provides more fine-grained control over CORS settings.
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        
        // Allow Canvas domains
        configuration.setAllowedOriginPatterns(Arrays.asList(
            "https://*.instructure.com",
            "https://*.canvaslms.com", 
            "https://*.insops.net",
            "https://*.inscloudgate.net",
            "https://kentdenver.instructure.com",
            "https://canvas.instructure.com"
        ));
        
        // Allow common HTTP methods
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        
        // Allow all headers
        configuration.setAllowedHeaders(Arrays.asList("*"));
        
        // Allow credentials (cookies, authorization headers)
        configuration.setAllowCredentials(true);
        
        // Cache preflight response for 1 hour
        configuration.setMaxAge(3600L);
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/seb/**", configuration);
        
        return source;
    }
}
