package org.kentdenver.sebcanvas.config;

import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import lombok.extern.slf4j.Slf4j;

/**
 * Configuration for Canvas Service injection.
 * This class provides a clean approach to service dependency injection,
 * avoiding redundant bean definitions that caused conflicts previously.
 */
@Configuration
@Slf4j
public class CanvasServiceConfig {

    private final CanvasApiService canvasApiService;

    @Autowired
    public CanvasServiceConfig(CanvasApiService canvasApiService) {
        this.canvasApiService = canvasApiService;
        log.info("CanvasServiceConfig initialized with CanvasApiService implementation");
    }

    /**
     * Provides the primary CanvasService implementation.
     * This bean will be used when injecting CanvasService without a qualifier.
     *
     * @return CanvasApiService as the primary CanvasService implementation
     */
    @Bean
    @Primary
    public CanvasService canvasService() {
        log.info("Creating primary canvasService bean");
        return canvasApiService;
    }

    /**
     * Note: We do NOT define an "oauthCanvasService" bean here
     * because it's already provided by the OAuthCanvasService class
     * with @Service("oauthCanvasService").
     *
     * Attempting to define it again would cause a bean definition conflict.
     */
}