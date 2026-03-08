package org.kentdenver.sebcanvas.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Controller for handling SEB exit functionality after quiz completion.
 * 
 * This controller provides multiple ways for students to exit SEB:
 * 1. Automatic quit when accessing the exit URL
 * 2. Manual quit link for students to click
 * 3. Timed automatic redirect to quit URL
 */
@Controller
@RequestMapping("/seb/exit")
@RequiredArgsConstructor
@Slf4j
public class SebExitController {

    private final QuizService quizService;

    /**
     * Main SEB exit page - shown after quiz completion.
     * This page provides multiple exit options for students.
     */
    @GetMapping("/{courseId}/{quizId}")
    public String showExitPage(@PathVariable String courseId,
                              @PathVariable String quizId,
                              @RequestParam(required = false) String userId,
                              @RequestParam(required = false) String mode,
                              Model model,
                              HttpServletRequest request) {
        
        log.info("SEB exit page requested for course: {}, quiz: {}, user: {}", courseId, quizId, userId);

        try {
            // Get quiz information
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
            
            // Add model attributes for the exit page
            model.addAttribute("courseId", courseId);
            model.addAttribute("quizId", quizId);
            model.addAttribute("userId", userId);
            model.addAttribute("sebRequired", sebSetting != null && sebSetting.isSebRequired());
            
            // Generate quit URLs
            String quitUrl = generateQuitUrl(courseId, quizId);
            String manualQuitUrl = generateManualQuitUrl(courseId, quizId);
            
            model.addAttribute("quitUrl", quitUrl);
            model.addAttribute("manualQuitUrl", manualQuitUrl);
            
            // Determine exit mode
            String exitMode = determineExitMode(mode, sebSetting);
            model.addAttribute("exitMode", exitMode);
            
            // Add timing for automatic exit (if enabled)
            if ("auto".equals(exitMode)) {
                model.addAttribute("autoExitDelay", 10); // 10 seconds
            }
            
            log.info("Showing SEB exit page with mode: {}", exitMode);
            return "sebExit";
            
        } catch (Exception e) {
            log.error("Error showing SEB exit page for course: {}, quiz: {}", courseId, quizId, e);
            model.addAttribute("error", "Unable to load exit page");
            return "error";
        }
    }

    /**
     * Automatic quit URL - when this URL is accessed, SEB should automatically quit.
     * This is the URL that should be set as the quitURL in SEB configuration.
     */
    @GetMapping("/quit/{courseId}/{quizId}")
    public String automaticQuit(@PathVariable String courseId,
                               @PathVariable String quizId,
                               @RequestParam(required = false) String userId,
                               Model model,
                               HttpServletRequest request,
                               HttpServletResponse response) {
        
        log.info("SEB automatic quit triggered for course: {}, quiz: {}, user: {}", courseId, quizId, userId);

        // Set headers that SEB might use to detect quit condition
        response.setHeader("X-SEB-Quit", "true");
        response.setHeader("X-SEB-Exit", "automatic");
        
        // Add model attributes
        model.addAttribute("courseId", courseId);
        model.addAttribute("quizId", quizId);
        model.addAttribute("userId", userId);
        model.addAttribute("quitType", "automatic");
        
        // Return a page that confirms SEB should quit
        return "sebQuit";
    }

    /**
     * Manual quit link - provides a clickable link for students to exit SEB.
     */
    @GetMapping("/manual/{courseId}/{quizId}")
    public String manualQuit(@PathVariable String courseId,
                            @PathVariable String quizId,
                            @RequestParam(required = false) String userId,
                            Model model,
                            HttpServletRequest request,
                            HttpServletResponse response) {
        
        log.info("SEB manual quit requested for course: {}, quiz: {}, user: {}", courseId, quizId, userId);

        // Set headers for manual quit
        response.setHeader("X-SEB-Quit", "true");
        response.setHeader("X-SEB-Exit", "manual");
        
        // Add model attributes
        model.addAttribute("courseId", courseId);
        model.addAttribute("quizId", quizId);
        model.addAttribute("userId", userId);
        model.addAttribute("quitType", "manual");
        
        // Return a page that provides manual quit instructions
        return "sebQuit";
    }

    /**
     * API endpoint to get exit URLs for a quiz.
     * This can be used by Canvas or other systems to get the appropriate exit URLs.
     */
    @GetMapping("/api/{courseId}/{quizId}/urls")
    @ResponseBody
    public ExitUrlResponse getExitUrls(@PathVariable String courseId,
                                      @PathVariable String quizId,
                                      HttpServletRequest request) {
        
        log.info("Exit URLs requested for course: {}, quiz: {}", courseId, quizId);
        
        try {
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
            
            ExitUrlResponse response = new ExitUrlResponse();
            response.setExitPageUrl(generateExitPageUrl(courseId, quizId));
            response.setQuitUrl(generateQuitUrl(courseId, quizId));
            response.setManualQuitUrl(generateManualQuitUrl(courseId, quizId));
            response.setSebRequired(sebSetting != null && sebSetting.isSebRequired());
            
            return response;
            
        } catch (Exception e) {
            log.error("Error getting exit URLs for course: {}, quiz: {}", courseId, quizId, e);
            ExitUrlResponse errorResponse = new ExitUrlResponse();
            errorResponse.setError("Unable to generate exit URLs");
            return errorResponse;
        }
    }

    // Helper methods

    private String generateExitPageUrl(String courseId, String quizId) {
        return String.format("/seb/exit/%s/%s", courseId, quizId);
    }

    private String generateQuitUrl(String courseId, String quizId) {
        return String.format("/seb/exit/quit/%s/%s", courseId, quizId);
    }

    private String generateManualQuitUrl(String courseId, String quizId) {
        return String.format("/seb/exit/manual/%s/%s", courseId, quizId);
    }

    private String determineExitMode(String requestedMode, QuizSebSetting sebSetting) {
        if (requestedMode != null) {
            return requestedMode;
        }
        
        // Default to manual mode for better user control
        return "manual";
    }

    /**
     * Response object for exit URLs API.
     */
    public static class ExitUrlResponse {
        private String exitPageUrl;
        private String quitUrl;
        private String manualQuitUrl;
        private String externalUrl;
        private boolean sebRequired;
        private String error;

        // Getters and setters
        public String getExitPageUrl() { return exitPageUrl; }
        public void setExitPageUrl(String exitPageUrl) { this.exitPageUrl = exitPageUrl; }

        public String getQuitUrl() { return quitUrl; }
        public void setQuitUrl(String quitUrl) { this.quitUrl = quitUrl; }

        public String getManualQuitUrl() { return manualQuitUrl; }
        public void setManualQuitUrl(String manualQuitUrl) { this.manualQuitUrl = manualQuitUrl; }

        public String getExternalUrl() { return externalUrl; }
        public void setExternalUrl(String externalUrl) { this.externalUrl = externalUrl; }

        public boolean isSebRequired() { return sebRequired; }
        public void setSebRequired(boolean sebRequired) { this.sebRequired = sebRequired; }

        public String getError() { return error; }
        public void setError(String error) { this.error = error; }
    }
}
