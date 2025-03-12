package org.kentdenver.sebcanvas;

import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.service.JwkService;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.EnableAsync;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Main application class for the Canvas SEB Integration.
 * Configures and starts the Spring Boot application.
 */
@SpringBootApplication
@EnableAsync
@Slf4j
@RequiredArgsConstructor
public class CanvasSebApplication {

    private final LtiConfig ltiConfig;
    private final JwkService jwkService;

    /**
     * Main method to start the application.
     *
     * @param args Command line arguments
     */
    public static void main(String[] args) {
        SpringApplication.run(CanvasSebApplication.class, args);
    }

    /**
     * Event listener that runs after the application has started.
     * Initializes configurations and logs startup information.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        log.info("Canvas SEB Integration started successfully");

        // Initialize and log LTI configuration
        ltiConfig.init();

        // Initialize JWK service
        jwkService.initialize();
    }
}