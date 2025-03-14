package org.kentdenver.sebcanvas;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.service.JwkService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
@Slf4j
public class CanvasSebApplication {

    private final JwkService jwkService;

    @Autowired
    public CanvasSebApplication(JwkService jwkService) {
        this.jwkService = jwkService;
    }

    public static void main(String[] args) {
        SpringApplication.run(CanvasSebApplication.class, args);
    }

    /**
     * Application startup initialization tasks.
     * This ensures critical services are properly initialized before handling requests.
     */
    @Bean
    public ApplicationRunner applicationRunner() {
        return (ApplicationArguments args) -> {
            log.info("Running application initialization tasks...");

            // Force JWK Service initialization with correct tool URL
            jwkService.forceInitializeWithCorrectToolUrl();

            log.info("Canvas SEB Integration started successfully");
        };
    }
}