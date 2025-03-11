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
 *
 * The @Slf4j annotation adds a 'log' field to the class for logging.
 * This addresses the compilation error related to missing 'log' variables.
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
     *
     * Note: LtiConfig's init() method is annotated with @EventListener and will be called automatically,
     * so we don't need to call it here. We only need to initialize the JWK service.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        log.info("Canvas SEB Integration started successfully");

        // Initialize JWK service with improved error handling
        try {
            // Run JWK initialization in a background thread to avoid blocking startup
            new Thread(() -> {
                try {
                    log.info("Starting JWK service initialization in background thread");
                    Thread.sleep(5000); // Wait 5 seconds to give other services time to initialize
                    jwkService.initialize();
                    log.info("JWK service initialized successfully");
                } catch (Exception e) {
                    // Log the error but allow the application to continue running
                    log.error("Error initializing JWK service: {}", e.getMessage());
                    log.warn("Some signing operations may not work correctly, but the application will continue to run");
                }
            }, "JWK-Init-Thread").start();
        } catch (Exception e) {
            // If we can't even start the background thread, log and continue
            log.error("Failed to start JWK initialization thread: {}", e.getMessage());
            log.warn("Application started with limited functionality");
        }
    }
}
