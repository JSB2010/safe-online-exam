package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;

/**
 * Controller for serving static JavaScript files without authentication.
 * This is specifically for Canvas integration where the JavaScript needs to be
 * publicly accessible for Canvas to load it.
 */
@RestController
@RequestMapping("/js")
@Slf4j
public class StaticJsController {

    @Value("${seb.api.key:SEB_DEFAULT_KEY_CHANGE_IN_PRODUCTION}")
    private String apiKey;

    /**
     * Serves the Canvas SEB detector JavaScript file.
     * This endpoint is publicly accessible (no authentication required)
     * so that Canvas can load the script directly.
     */
    @GetMapping(value = "/canvas-seb-detector.js", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> getCanvasDetectorScript() {
        try {
            log.info("Serving Canvas SEB detector JavaScript (public endpoint)");

            // Read the JavaScript file from resources
            ClassPathResource resource = new ClassPathResource("static/js/canvas-seb-detector.js");
            String script = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

            // Embed the API key in the script for secure API calls
            script = script.replace("${SEB_API_KEY}", apiKey);

            log.info("Canvas SEB detector script served successfully, length: {} characters", script.length());

            return ResponseEntity.ok()
                    .header("Content-Type", "application/javascript; charset=utf-8")
                    .header("Cache-Control", "public, max-age=300") // Cache for 5 minutes
                    .header("Access-Control-Allow-Origin", "*") // Allow CORS for Canvas
                    .header("Access-Control-Allow-Methods", "GET")
                    .header("Access-Control-Allow-Headers", "Content-Type")
                    .body(script);

        } catch (Exception e) {
            log.error("Error loading Canvas SEB detector script", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .header("Content-Type", "application/javascript; charset=utf-8")
                    .body("// Error loading SEB detector script: " + e.getMessage());
        }
    }

    /**
     * Health check endpoint for the JavaScript service
     */
    @GetMapping("/health")
    public ResponseEntity<String> healthCheck() {
        return ResponseEntity.ok()
                .header("Content-Type", "application/json")
                .body("{\"status\":\"ok\",\"service\":\"static-js\"}");
    }
}
