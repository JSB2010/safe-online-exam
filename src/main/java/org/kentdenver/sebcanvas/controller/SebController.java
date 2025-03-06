package org.kentdenver.sebcanvas.controller;

import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.SebService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.security.NoSuchAlgorithmException;
import java.util.Optional;

@Controller
@RequestMapping("/student")
@RequiredArgsConstructor
@Slf4j
public class SebController {

    private final SebSettingRepository sebSettingRepository;
    private final SebService sebService;

    /**
     * Handle quiz access for students
     */
    @GetMapping("/quiz")
    public String accessQuiz(
            @RequestParam("courseId") String courseId,
            @RequestParam("resourceId") String resourceId,
            HttpServletRequest request,
            HttpSession session,
            Model model) {

        // Check LTI authentication
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("ltiLaunchData");
        if (launchData == null) {
            return "redirect:/error?message=Unauthorized";
        }

        // Get the quiz ID from the resource link
        String quizId = resourceId; // This is simplified; in practice, parse the actual quiz ID

        // Check if SEB is required for this quiz
        Optional<QuizSebSetting> settingOpt = sebSettingRepository.findByQuizId(quizId);
        boolean sebRequired = settingOpt.isPresent() && settingOpt.get().isSebRequired();

        // If SEB is required, check if the student is using SEB
        if (sebRequired) {
            boolean usingSeb = sebService.isUsingSeb(request);

            if (!usingSeb) {
                // Not using SEB, show the download SEB page
                model.addAttribute("quizId", quizId);
                model.addAttribute("courseId", courseId);
                model.addAttribute("resourceId", resourceId);
                return "sebRequired";
            }

            // Optionally validate Browser Exam Key
            String browserExamKey = request.getHeader("X-SafeExamBrowser-BrowserExamKey");
            if (browserExamKey != null && !sebService.validateBrowserExamKey(quizId, browserExamKey)) {
                return "invalidSebConfig";
            }
        }

        // Student is using SEB or SEB is not required, redirect to the actual quiz
        // In a real implementation, you would construct the proper redirect URL to the Canvas quiz
        String canvasQuizUrl = "https://canvas.instructure.com/courses/" + courseId + "/quizzes/" + quizId;
        return "redirect:" + canvasQuizUrl;
    }

    /**
     * Generate and download a SEB config file
     */
    @GetMapping("/downloadSebConfig")
    public ResponseEntity<byte[]> downloadSebConfig(
            @RequestParam("quizId") String quizId,
            @RequestParam("courseId") String courseId,
            @RequestParam("resourceId") String resourceId,
            HttpSession session) {

        // Check LTI authentication
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("ltiLaunchData");
        if (launchData == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(null);
        }

        try {
            // Generate the quiz URL including the authentication parameters
            String quizUrl = "https://canvas.instructure.com/courses/" + courseId + "/quizzes/" + quizId;

            // Generate SEB config file
            byte[] sebConfig = sebService.generateSebConfig(quizId, quizUrl);

            // Set response headers
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
            headers.setContentDispositionFormData("attachment", "quiz_" + quizId + ".seb");

            return new ResponseEntity<>(sebConfig, headers, HttpStatus.OK);
        } catch (IOException | NoSuchAlgorithmException e) {
            log.error("Error generating SEB config", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(null);
        }
    }
}