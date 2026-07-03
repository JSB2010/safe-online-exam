package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import jakarta.servlet.http.HttpServletRequest;
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

    /**
     * Serves the Canvas SEB detector JavaScript file.
     * This endpoint is publicly accessible (no authentication required)
     * so that Canvas can load the script directly.
     */
    @GetMapping(value = "/canvas-seb-detector.js", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> getCanvasDetectorScript(HttpServletRequest request) {
        try {
            log.info("Serving Canvas SEB detector JavaScript (public endpoint)");

            // Read the JavaScript file from resources
            ClassPathResource resource = new ClassPathResource("static/js/canvas-seb-detector.js");
            String script = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

            script = script.replace("${SEB_BASE_URL}", getRequestBaseUrl(request));
            script = script.replace("${SEB_API_KEY}", "");

            log.info("Canvas SEB detector script served successfully, length: {} characters", script.length());

            return ResponseEntity.ok()
                    .header("Content-Type", "application/javascript; charset=utf-8")
                    .header("Cache-Control", "no-cache, no-store, must-revalidate")
                    .header("Pragma", "no-cache")
                    .header("Expires", "0")
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

    private String getRequestBaseUrl(HttpServletRequest request) {
        String forwardedProto = firstHeaderValue(request.getHeader("X-Forwarded-Proto"), null);
        String scheme = forwardedProto != null ? forwardedProto : request.getScheme();
        String host = firstHeaderValue(request.getHeader("X-Forwarded-Host"), request.getServerName());
        String forwardedPort = firstHeaderValue(request.getHeader("X-Forwarded-Port"), null);
        int fallbackPort = forwardedProto != null ? defaultPortForScheme(scheme, request.getServerPort()) : request.getServerPort();
        int port = parsePort(forwardedPort, fallbackPort);

        StringBuilder baseUrl = new StringBuilder()
                .append(scheme)
                .append("://")
                .append(host);

        if (!hostIncludesPort(host) && !isDefaultPort(scheme, port)) {
            baseUrl.append(":").append(port);
        }

        if (request.getContextPath() != null && !request.getContextPath().isBlank()) {
            baseUrl.append(request.getContextPath());
        }

        return baseUrl.toString();
    }

    private String firstHeaderValue(String headerValue, String fallback) {
        if (headerValue == null || headerValue.isBlank()) {
            return fallback;
        }
        String first = headerValue.split(",", 2)[0].trim();
        return first.isBlank() ? fallback : first;
    }

    private int parsePort(String portValue, int fallback) {
        if (portValue == null || portValue.isBlank()) {
            return fallback;
        }
        try {
            return Integer.parseInt(portValue);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private boolean hostIncludesPort(String host) {
        return host != null && host.matches(".*:\\d+$");
    }

    private boolean isDefaultPort(String scheme, int port) {
        return ("https".equalsIgnoreCase(scheme) && port == 443)
                || ("http".equalsIgnoreCase(scheme) && port == 80);
    }

    private int defaultPortForScheme(String scheme, int fallback) {
        if ("https".equalsIgnoreCase(scheme)) {
            return 443;
        }
        if ("http".equalsIgnoreCase(scheme)) {
            return 80;
        }
        return fallback;
    }
}
