package org.kentdenver.sebcanvas.controller;

import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebConfigService;
import org.kentdenver.sebcanvas.service.SebConfigurationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * Controller for SEB (Safe Exam Browser) enforcement.
 * This replaces Respondus LockDown Browser functionality.
 * 
 * Flow:
 * 1. Student clicks Canvas quiz link (modified to point to our service)
 * 2. We check if request has SEB headers
 * 3. If SEB detected -> redirect to actual Canvas quiz
 * 4. If no SEB -> show download/instruction page
 */
@Controller
@RequestMapping("/seb")
public class SebEnforcementController {

    private static final Logger log = LoggerFactory.getLogger(SebEnforcementController.class);

    @Autowired
    private QuizService quizService;

    @Autowired
    private SebConfigService sebConfigService;

    @Autowired
    private SebConfigurationService sebConfigurationService;

    // SEB header names (official SEB integration specification)
    private static final String SEB_CONFIG_KEY_HEADER = "X-SafeExamBrowser-ConfigKeyHash";
    private static final String SEB_REQUEST_HASH_HEADER = "X-SafeExamBrowser-RequestHash";
    private static final String SEB_USER_AGENT_PATTERN = "SEB";

    /**
     * Main SEB enforcement endpoint.
     * This is where Canvas quiz links will redirect to.
     * 
     * @param quizId Canvas quiz ID
     * @param courseId Canvas course ID  
     * @param canvasUrl Original Canvas quiz URL (encoded)
     * @param request HTTP request to check for SEB headers
     * @param model Spring model for template rendering
     * @return Either redirect to Canvas quiz (if SEB) or SEB download page
     */
    @GetMapping("/quiz/{courseId}/{quizId}")
    public String enforceQuiz(
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestParam(value = "canvas_url", required = false) String canvasUrl,
            @RequestParam(value = "user_id", required = false) String userId,
            HttpServletRequest request,
            Model model) {

        log.info("SEB enforcement check for quiz {} in course {} from user {}", quizId, courseId, userId);

        try {
            // Check if this quiz requires SEB
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
            if (sebSetting == null || !sebSetting.isSebRequired()) {
                log.info("Quiz {} does not require SEB, redirecting to Canvas", quizId);
                return redirectToCanvas(canvasUrl, courseId, quizId);
            }

            // Check if request is coming from SEB
            boolean isSebRequest = detectSebBrowser(request, sebSetting);
            
            if (isSebRequest) {
                log.info("SEB detected for quiz {}, allowing access to Canvas", quizId);
                return redirectToCanvas(canvasUrl, courseId, quizId);
            } else {
                log.info("SEB not detected for quiz {}, showing download page", quizId);
                return showSebDownloadPage(courseId, quizId, canvasUrl, userId, model);
            }

        } catch (Exception e) {
            log.error("Error in SEB enforcement for quiz {}: {}", quizId, e.getMessage(), e);
            model.addAttribute("error", "Unable to verify SEB requirements. Please contact your instructor.");
            return "error";
        }
    }

    /**
     * Endpoint to download SEB configuration file for a specific quiz.
     */
    @GetMapping("/config/{courseId}/{quizId}")
    @ResponseBody
    public ResponseEntity<byte[]> downloadSebConfig(
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestParam(value = "canvas_url", required = false) String canvasUrl,
            @RequestParam(value = "user_id", required = false) String userId) {

        log.info("Generating SEB config for quiz {} in course {}", quizId, courseId);

        try {
            // Get SEB settings for the quiz
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
            if (sebSetting == null || !sebSetting.isSebRequired()) {
                log.warn("SEB not enabled for quiz {}", quizId);
                return ResponseEntity.badRequest().build();
            }

            // Get access code
            String accessCode = sebSetting.getAccessCode();
            if (accessCode == null || accessCode.isEmpty()) {
                log.warn("No access code found for quiz {}", quizId);
                return ResponseEntity.badRequest().build();
            }

            // Generate SEB configuration file
            byte[] sebConfigData = sebConfigService.generateSebConfig(courseId, quizId, accessCode, sebSetting, null);

            HttpHeaders headers = new HttpHeaders();
            headers.add("Content-Disposition", "attachment; filename=quiz_" + quizId + ".seb");
            headers.add("Content-Type", "application/x-seb");

            return new ResponseEntity<>(sebConfigData, headers, HttpStatus.OK);

        } catch (Exception e) {
            log.error("Error generating SEB config for quiz {}: {}", quizId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Detects if the request is coming from Safe Exam Browser.
     * Uses multiple detection methods for security.
     */
    private boolean detectSebBrowser(HttpServletRequest request, QuizSebSetting sebSetting) {
        // Method 1: Check for SEB-specific headers (most secure)
        String configKeyHash = request.getHeader(SEB_CONFIG_KEY_HEADER);
        String requestHash = request.getHeader(SEB_REQUEST_HASH_HEADER);
        
        if (configKeyHash != null && requestHash != null) {
            log.debug("SEB headers detected - ConfigKey: {}, RequestHash: {}", 
                     configKeyHash.substring(0, Math.min(8, configKeyHash.length())) + "...",
                     requestHash.substring(0, Math.min(8, requestHash.length())) + "...");
            
            // Verify the config key hash matches our expected value
            if (sebSetting.getBrowserExamKey() != null && 
                sebSetting.getBrowserExamKey().equals(configKeyHash)) {
                log.info("SEB config key hash verified successfully");
                return true;
            } else {
                log.warn("SEB config key hash mismatch. Expected: {}, Got: {}", 
                        sebSetting.getBrowserExamKey(), configKeyHash);
            }
        }

        // Method 2: Check User-Agent for SEB (less secure, fallback)
        String userAgent = request.getHeader("User-Agent");
        if (userAgent != null && userAgent.contains(SEB_USER_AGENT_PATTERN)) {
            log.debug("SEB detected in User-Agent: {}", userAgent);
            return true;
        }

        log.debug("No SEB indicators found in request");
        return false;
    }

    /**
     * Redirects to the actual Canvas quiz.
     */
    private String redirectToCanvas(String canvasUrl, String courseId, String quizId) {
        if (canvasUrl != null && !canvasUrl.isEmpty()) {
            try {
                String decodedUrl = URLDecoder.decode(canvasUrl, StandardCharsets.UTF_8);
                log.debug("Redirecting to Canvas URL: {}", decodedUrl);
                return "redirect:" + decodedUrl;
            } catch (Exception e) {
                log.error("Error decoding Canvas URL: {}", e.getMessage());
            }
        }
        
        // Fallback: construct Canvas URL
        String fallbackUrl = String.format("https://kentdenver.instructure.com/courses/%s/quizzes/%s", courseId, quizId);
        log.debug("Using fallback Canvas URL: {}", fallbackUrl);
        return "redirect:" + fallbackUrl;
    }

    /**
     * Shows the SEB download and instruction page.
     */
    private String showSebDownloadPage(String courseId, String quizId, String canvasUrl, String userId, Model model) {
        model.addAttribute("courseId", courseId);
        model.addAttribute("quizId", quizId);
        model.addAttribute("canvasUrl", canvasUrl);
        model.addAttribute("userId", userId);
        model.addAttribute("configUrl", String.format("/seb/config/%s/%s.seb?canvas_url=%s&user_id=%s",
                          courseId, quizId, canvasUrl != null ? canvasUrl : "", userId != null ? userId : ""));

        return "sebRequired";
    }

    /**
     * Downloads the SEB configuration file for a specific quiz.
     * This endpoint generates a comprehensive SEB configuration that:
     * - Completely locks down the computer
     * - Implements all necessary security measures
     * - Automatically provides quiz access codes
     * - Configures allowed websites and browser restrictions
     */
    @GetMapping("/config/{courseId}/{quizId}.seb")
    public ResponseEntity<byte[]> downloadSebConfig(
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestParam(required = false) String canvas_url,
            @RequestParam(required = false) String user_id,
            HttpServletRequest request) {

        log.info("Generating SEB configuration for course: {}, quiz: {}", courseId, quizId);

        try {
            // Get quiz settings to determine access code
            QuizSebSetting quizSetting = quizService.getSebSettingForQuiz(quizId);
            String accessCode = (quizSetting != null) ? quizSetting.getAccessCode() : null;

            // Construct the quiz URL
            String quizUrl;
            if (canvas_url != null && !canvas_url.trim().isEmpty()) {
                quizUrl = URLDecoder.decode(canvas_url, StandardCharsets.UTF_8);
            } else {
                quizUrl = String.format("https://kentdenver.instructure.com/courses/%s/quizzes/%s", courseId, quizId);
            }

            log.debug("Quiz URL for SEB config: {}", quizUrl);
            log.debug("Access code configured: {}", accessCode != null ? "Yes" : "No");

            // Generate comprehensive SEB configuration
            byte[] sebConfig = sebConfigurationService.generateSebConfiguration(
                courseId, quizId, quizUrl, accessCode);

            // Set appropriate headers for file download
            HttpHeaders headers = new HttpHeaders();
            // Use application/octet-stream to force download instead of display
            headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
            headers.setContentDispositionFormData("attachment",
                String.format("quiz_%s_%s.seb", courseId, quizId));
            headers.add("Content-Description", "Safe Exam Browser Configuration");
            headers.add("X-Content-Type-Options", "nosniff");
            headers.add("Content-Transfer-Encoding", "binary");
            headers.add("Accept-Ranges", "bytes");

            log.info("Successfully generated SEB configuration file ({} bytes) for quiz: {}",
                    sebConfig.length, quizId);

            return ResponseEntity.ok()
                    .headers(headers)
                    .body(sebConfig);

        } catch (Exception e) {
            log.error("Failed to generate SEB configuration for quiz: {}", quizId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(("Error generating SEB configuration: " + e.getMessage()).getBytes());
        }
    }
}
