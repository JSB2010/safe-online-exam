package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.view.RedirectView;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Controller for handling SEB-related requests.
 * Manages SEB redirection, validation, and configuration downloads.
 */
@Controller
@RequestMapping("/seb")
@Slf4j
public class SebRedirectController {

    private final SebDetector sebDetector;
    private final QuizService quizService;
    private final CanvasService canvasService;

    @Autowired
    public SebRedirectController(
            SebDetector sebDetector,
            QuizService quizService,
            @Qualifier("oauthCanvasService") CanvasService canvasService) {
        this.sebDetector = sebDetector;
        this.quizService = quizService;
        this.canvasService = canvasService;
    }

    /**
     * Handles quiz redirection for SEB-required quizzes.
     * This is the endpoint that students will be directed to via Deep Linking.
     */
    @GetMapping("/redirect/{quizId}")
    public String redirectQuiz(
            @PathVariable String quizId,
            @RequestParam(required = false) String userId,
            HttpServletRequest request,
            HttpSession session,
            Model model) {

        log.debug("SEB redirect requested for quiz: {}, user: {}", quizId, userId);

        // Get the quiz details
        Quiz quiz = quizService.getQuiz(quizId);
        if (quiz == null) {
            log.error("Quiz not found: {}", quizId);
            model.addAttribute("error", "Quiz not found");
            return "error";
        }

        model.addAttribute("quiz", quiz);

        // Get SEB settings for this quiz
        QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
        boolean sebRequired = sebSetting != null && sebSetting.isSebRequired();

        // If SEB is not required, redirect directly to the quiz
        if (!sebRequired) {
            log.info("SEB not required for quiz: {}, redirecting directly", quizId);
            return "redirect:" + quiz.getHtmlUrl();
        }

        // Check if this request is coming from SEB
        boolean isUsingSeb = sebDetector.isRequestFromSEB(request, sebSetting);

        if (isUsingSeb) {
            log.info("Request from SEB detected for quiz: {}, generating Canvas session", quizId);

            // If user is using SEB, get a canvas session token for direct access
            // First, check if userId is provided (may come from LTI session)
            if (userId == null) {
                // Try to get userId from session
                userId = (String) session.getAttribute("canvas_user_id");
            }

            if (userId != null && canvasService.hasValidCredentials(userId)) {
                // Get a session token URL for direct Canvas access
                String sessionTokenUrl = canvasService.getSessionToken(userId, quiz.getHtmlUrl());

                if (sessionTokenUrl != null) {
                    log.debug("Redirecting to Canvas session URL: {}", sessionTokenUrl);
                    return "redirect:" + sessionTokenUrl;
                }
            }

            // Fallback if no sessionToken could be generated
            log.debug("No Canvas session token available, redirecting directly to quiz URL");
            return "redirect:" + quiz.getHtmlUrl();
        } else {
            // User is not using SEB, show the SEB requirement page
            log.info("User not using SEB for quiz: {}, showing SEB requirement page", quizId);

            // Generate the download URL for the config file
            String configUrl = "/seb/config/" + quizId;
            model.addAttribute("configUrl", configUrl);

            return "sebRequired";
        }
    }

    /**
     * Provides the SEB configuration file for a quiz.
     */
    @GetMapping("/config/{quizId}")
    public ResponseEntity<byte[]> getSebConfig(@PathVariable String quizId) {
        log.debug("SEB config file requested for quiz: {}", quizId);

        try {
            // Get the quiz details
            Quiz quiz = quizService.getQuiz(quizId);
            if (quiz == null) {
                log.error("Quiz not found: {}", quizId);
                return ResponseEntity.notFound().build();
            }

            // Generate the SEB config file
            byte[] configFile = quizService.generateSebConfig(quizId, quiz.getHtmlUrl());

            // Create the response with the config file
            HttpHeaders headers = new HttpHeaders();
            headers.set("Content-Type", "application/seb");
            headers.set("Content-Disposition", "attachment; filename=quiz_" + quizId + ".seb");

            return new ResponseEntity<>(configFile, headers, HttpStatus.OK);
        } catch (Exception e) {
            log.error("Error generating SEB config file for quiz: {}", quizId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Validates a SEB Browser Exam Key.
     * This endpoint can be used by Canvas to verify the SEB request.
     */
    @PostMapping("/validate")
    @ResponseBody
    public Map<String, Object> validateSebRequest(
            @RequestBody Map<String, String> request,
            HttpServletRequest httpRequest) {

        String quizId = request.get("quiz_id");
        String browserExamKey = request.get("browser_exam_key");

        log.debug("SEB validation requested for quiz: {}", quizId);

        Map<String, Object> response = new HashMap<>();

        try {
            if (quizId == null || browserExamKey == null) {
                response.put("valid", false);
                response.put("error", "Missing required parameters");
                return response;
            }

            // Get SEB settings for this quiz
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
            if (sebSetting == null) {
                response.put("valid", false);
                response.put("error", "No SEB settings found for quiz");
                return response;
            }

            // Validate the Browser Exam Key
            boolean valid = sebDetector.validateBrowserExamKey(browserExamKey, sebSetting.getBrowserExamKey());
            response.put("valid", valid);

            if (!valid) {
                response.put("error", "Invalid Browser Exam Key");
            }

            return response;
        } catch (Exception e) {
            log.error("Error validating SEB request", e);
            response.put("valid", false);
            response.put("error", "Internal error during validation");
            return response;
        }
    }

    /**
     * Checks if a URL is accessible via SEB.
     * This is for supporting endpoints that may need to verify SEB access.
     */
    @GetMapping("/check")
    @ResponseBody
    public Map<String, Object> checkSebAccess(
            @RequestParam String quizId,
            HttpServletRequest request) {

        log.debug("SEB access check for quiz: {}", quizId);

        Map<String, Object> response = new HashMap<>();

        try {
            // Get SEB settings for this quiz
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);

            boolean sebRequired = sebSetting != null && sebSetting.isSebRequired();
            response.put("seb_required", sebRequired);

            if (sebRequired) {
                boolean isUsingSeb = sebDetector.isRequestFromSEB(request, sebSetting);
                response.put("using_seb", isUsingSeb);

                if (!isUsingSeb) {
                    response.put("config_url", "/seb/config/" + quizId);
                }
            } else {
                response.put("using_seb", true); // If SEB not required, access is allowed
            }

            return response;
        } catch (Exception e) {
            log.error("Error checking SEB access", e);
            response.put("error", "Error checking SEB access");
            return response;
        }
    }

    /**
     * Provides JavaScript code for Canvas integration to detect and enforce SEB requirements.
     * This script should be injected into Canvas quiz pages.
     */
    @GetMapping("/api/seb/canvas-detector.js")
    public ResponseEntity<String> getCanvasDetectorScript() {
        try {
            // Read the JavaScript file from resources
            ClassPathResource resource = new ClassPathResource("static/js/canvas-seb-detector.js");
            String script = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.valueOf("application/javascript"));
            headers.setCacheControl("no-cache, no-store, must-revalidate");
            headers.setPragma("no-cache");
            headers.setExpires(0);

            return new ResponseEntity<>(script, headers, HttpStatus.OK);
        } catch (Exception e) {
            log.error("Error serving Canvas detector script", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("// Error loading SEB detector script");
        }
    }
}