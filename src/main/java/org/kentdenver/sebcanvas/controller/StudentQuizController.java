package org.kentdenver.sebcanvas.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.QuizService;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Controller for student quiz access.
 * Handles the external tool URLs that Canvas redirects to.
 * Format: /quiz/{orgId}/{courseId}/{quizId}
 *
 * DEPRECATED: This controller is disabled in favor of LTI Deep Linking workflow.
 * All quiz access should go through the LTI flow in LtiController.
 */
// @Controller
// @RequestMapping("/quiz")
@Slf4j
@RequiredArgsConstructor
public class StudentQuizController {

    private final QuizService quizService;

    /**
     * Main student quiz access endpoint.
     * This is where Canvas external tool links redirect to.
     * Shows "Ready to take quiz?" page and handles SEB enforcement.
     *
     * DEPRECATED: Disabled in favor of LTI Deep Linking workflow.
     *
     * @param orgId Organization ID (e.g., "kentdenver")
     * @param courseId Canvas course ID
     * @param quizId Canvas quiz ID
     * @param request HTTP request for SEB detection
     * @param model Spring model for template rendering
     * @return Template name for quiz access page
     */
    // @GetMapping("/{orgId}/{courseId}/{quizId}")
    public String accessQuiz(
            @PathVariable String orgId,
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestParam(value = "user_id", required = false) String userId,
            @RequestParam(value = "assignment_id", required = false) String assignmentId,
            HttpServletRequest request,
            Model model) {

        log.info("Student accessing quiz {} in course {} for org {}", quizId, courseId, orgId);

        try {
            // Check if this quiz requires SEB
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
            if (sebSetting == null || !sebSetting.isSebRequired()) {
                log.info("Quiz {} does not require SEB, redirecting to Canvas", quizId);
                return redirectToCanvas(courseId, quizId);
            }

            // Check if request is coming from SEB
            boolean isSebRequest = detectSebBrowser(request, sebSetting);
            
            if (isSebRequest) {
                log.info("SEB detected for quiz {}, proceeding to LTI launch", quizId);
                return showLtiLaunchPage(orgId, courseId, quizId, userId, assignmentId, model);
            } else {
                log.info("SEB not detected for quiz {}, showing SEB requirement page", quizId);
                return showSebRequiredPage(orgId, courseId, quizId, userId, assignmentId, sebSetting, model);
            }

        } catch (Exception e) {
            log.error("Error in student quiz access for quiz {}: {}", quizId, e.getMessage(), e);
            model.addAttribute("error", "Unable to access quiz. Please contact your instructor.");
            return "error";
        }
    }

    /**
     * LTI Deep Linking launch endpoint.
     * Called when student clicks "Yes, I'm ready" and SEB is detected.
     *
     * DEPRECATED: Disabled in favor of LTI Deep Linking workflow.
     */
    // @PostMapping("/{orgId}/{courseId}/{quizId}/launch")
    public String launchQuiz(
            @PathVariable String orgId,
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestParam(value = "user_id", required = false) String userId,
            @RequestParam(value = "assignment_id", required = false) String assignmentId,
            HttpServletRequest request,
            Model model) {

        log.info("Launching quiz {} via LTI Deep Linking", quizId);

        try {
            // Verify SEB is still present
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
            if (sebSetting != null && sebSetting.isSebRequired()) {
                boolean isSebRequest = detectSebBrowser(request, sebSetting);
                if (!isSebRequest) {
                    log.warn("SEB not detected during launch for quiz {}", quizId);
                    return showSebRequiredPage(orgId, courseId, quizId, userId, assignmentId, sebSetting, model);
                }
            }

            // Perform LTI Deep Linking to Canvas quiz
            String canvasQuizUrl = generateCanvasQuizUrl(courseId, quizId);
            log.info("Redirecting to Canvas quiz: {}", canvasQuizUrl);
            
            return "redirect:" + canvasQuizUrl;

        } catch (Exception e) {
            log.error("Error launching quiz {}: {}", quizId, e.getMessage(), e);
            model.addAttribute("error", "Unable to launch quiz. Please contact your instructor.");
            return "error";
        }
    }

    /**
     * Detects if the request is coming from Safe Exam Browser.
     */
    private boolean detectSebBrowser(HttpServletRequest request, QuizSebSetting sebSetting) {
        // Method 1: Check for SEB-specific headers (most secure)
        String configKeyHash = request.getHeader("X-SafeExamBrowser-ConfigKeyHash");
        String requestHash = request.getHeader("X-SafeExamBrowser-RequestHash");
        
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
        if (userAgent != null && userAgent.contains("SEB")) {
            log.debug("SEB detected in User-Agent: {}", userAgent);
            return true;
        }

        log.debug("No SEB indicators found in request");
        return false;
    }

    /**
     * Shows the "Ready to take quiz?" page for SEB-enabled quizzes.
     */
    private String showLtiLaunchPage(String orgId, String courseId, String quizId, String userId, String assignmentId, Model model) {
        model.addAttribute("orgId", orgId);
        model.addAttribute("courseId", courseId);
        model.addAttribute("quizId", quizId);
        model.addAttribute("userId", userId);
        model.addAttribute("assignmentId", assignmentId);
        model.addAttribute("launchUrl", String.format("/quiz/%s/%s/%s/launch", orgId, courseId, quizId));
        
        return "quizLaunch";
    }

    /**
     * Shows the SEB requirement page when SEB is not detected.
     */
    private String showSebRequiredPage(String orgId, String courseId, String quizId, String userId, String assignmentId, QuizSebSetting sebSetting, Model model) {
        model.addAttribute("orgId", orgId);
        model.addAttribute("courseId", courseId);
        model.addAttribute("quizId", quizId);
        model.addAttribute("userId", userId);
        model.addAttribute("assignmentId", assignmentId);
        model.addAttribute("sebConfigUrl", String.format("/seb/config/%s/%s", courseId, quizId));
        model.addAttribute("allowedSites", sebSetting.getAllowedSites());
        
        return "sebRequired";
    }

    /**
     * Redirects to the actual Canvas quiz (for non-SEB quizzes).
     */
    private String redirectToCanvas(String courseId, String quizId) {
        String canvasUrl = generateCanvasQuizUrl(courseId, quizId);
        return "redirect:" + canvasUrl;
    }

    /**
     * Generates the Canvas quiz URL.
     */
    private String generateCanvasQuizUrl(String courseId, String quizId) {
        return String.format("https://kentdenver.instructure.com/courses/%s/quizzes/%s", courseId, quizId);
    }
}
