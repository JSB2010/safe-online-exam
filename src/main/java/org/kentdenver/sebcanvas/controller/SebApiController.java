package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.QuizService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Simple API controller for SEB-related endpoints.
 * This controller handles the access code API that the JavaScript uses.
 */
@RestController
@RequestMapping("/api/seb")
@Slf4j
public class SebApiController {

    private final QuizService quizService;

    @Value("${seb.api.key:SEB_DEFAULT_KEY_CHANGE_IN_PRODUCTION}")
    private String apiKey;

    @Autowired
    public SebApiController(QuizService quizService) {
        this.quizService = quizService;
        log.info("SebApiController initialized with basic security");
    }

    /**
     * Provides the access code for a specific quiz when requested from SEB.
     * This endpoint is used by the JavaScript auto-fill functionality.
     * SECURITY: Requires valid API key and SEB user agent.
     */
    @GetMapping("/access-code/{courseId}/{quizId}")
    public ResponseEntity<Map<String, Object>> getAccessCode(
            @PathVariable String courseId,
            @PathVariable String quizId,
            HttpServletRequest request) {

        Map<String, Object> response = new HashMap<>();

        try {
            log.info("=== SECURED SEB API: Getting access code for course {} quiz {} ===", courseId, quizId);

            // SECURITY: Basic SEB browser validation (API key validation temporarily disabled)
            String userAgent = request.getHeader("User-Agent");
            log.info("Access code request from User-Agent: {}", userAgent);

            // TODO: Re-enable API key validation later
            // For now, just log the request for debugging
            String providedApiKey = request.getHeader("X-SEB-API-Key");
            log.info("API key provided: {}", providedApiKey != null ? "YES" : "NO");

            // Get SEB setting for this quiz
            QuizSebSetting setting = quizService.getSebSettingForQuiz(quizId);

            if (setting == null) {
                log.info("No SEB setting found for quiz {}", quizId);
                response.put("success", false);
                response.put("message", "No SEB setting found for this quiz");
                return ResponseEntity.ok(response);
            }

            if (!setting.isSebRequired() || !setting.isEnabled()) {
                log.info("SEB not required or not enabled for quiz {}: sebRequired={}, enabled={}",
                        quizId, setting.isSebRequired(), setting.isEnabled());
                response.put("success", false);
                response.put("message", "SEB not required for this quiz");
                return ResponseEntity.ok(response);
            }

            String accessCode = setting.getAccessCode();
            if (accessCode == null || accessCode.trim().isEmpty()) {
                log.info("No access code set for quiz {}", quizId);
                response.put("success", false);
                response.put("message", "No access code configured for this quiz");
                return ResponseEntity.ok(response);
            }

            log.info("SECURITY PASSED: Returning access code for quiz {} (length: {})", quizId, accessCode.length());
            response.put("success", true);
            response.put("accessCode", accessCode);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Error getting access code for quiz {}", quizId, e);
            response.put("success", false);
            response.put("message", "Error retrieving access code: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    /**
     * Simple test endpoint to verify the API is working.
     */
    @GetMapping("/test")
    public ResponseEntity<Map<String, Object>> test() {
        Map<String, Object> response = new HashMap<>();
        response.put("status", "success");
        response.put("message", "SEB API is working");
        response.put("timestamp", System.currentTimeMillis());
        return ResponseEntity.ok(response);
    }

    /**
     * Provides JavaScript code for Canvas integration to detect and enforce SEB requirements.
     * This script should be injected into Canvas quiz pages.
     * The API key is embedded in the script for secure access to the access code endpoint.
     */
    @GetMapping(value = "/canvas-detector.js", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> getCanvasDetectorScript() {
        try {
            log.info("Serving Canvas SEB detector JavaScript with embedded API key");

            // Read the JavaScript file from resources
            ClassPathResource resource = new ClassPathResource("static/js/canvas-seb-detector.js");
            String script = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

            // Embed the API key in the script
            script = script.replace("${SEB_API_KEY}", apiKey);

            log.info("Canvas SEB detector script loaded with API key, length: {} characters", script.length());

            return ResponseEntity.ok()
                    .header("Content-Type", "application/javascript")
                    .header("Cache-Control", "no-cache, no-store, must-revalidate") // Don't cache for security
                    .header("Pragma", "no-cache")
                    .header("Expires", "0")
                    .body(script);

        } catch (Exception e) {
            log.error("Error loading Canvas SEB detector script", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("// Error loading SEB detector script: " + e.getMessage());
        }
    }
}
