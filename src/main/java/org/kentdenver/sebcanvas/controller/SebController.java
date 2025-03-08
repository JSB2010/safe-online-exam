package org.kentdenver.sebcanvas.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.security.NoSuchAlgorithmException;

/**
 * Controller for SEB-related operations.
 * Handles SEB detection, validation, and configuration file generation.
 */
@Controller
@RequestMapping("/seb")
@Slf4j
@RequiredArgsConstructor
public class SebController {

    private final SebService sebService;
    private final QuizService quizService;
    private final SebDetector sebDetector;

    /**
     * Checks if the current request is coming from SEB.
     */
    @GetMapping("/check")
    @ResponseBody
    public ResponseEntity<Boolean> isSebBrowser(HttpServletRequest request) {
        boolean isSeb = sebDetector.isSebBrowser(request);
        log.debug("SEB detection result: {}", isSeb);
        return ResponseEntity.ok(isSeb);
    }

    /**
     * Validates a Browser Exam Key.
     */
    @GetMapping("/validate/{quizId}")
    @ResponseBody
    public ResponseEntity<Boolean> validateBrowserExamKey(
            @PathVariable String quizId,
            HttpServletRequest request) {

        QuizSebSetting setting = quizService.getSebSettingForQuiz(quizId);
        if (setting == null || !setting.isSebRequired()) {
            // If SEB is not required for this quiz, return true
            return ResponseEntity.ok(true);
        }

        String browserExamKey = setting.getBrowserExamKey();
        boolean isValid = sebDetector.validateBrowserExamKey(request, browserExamKey);
        log.debug("Browser Exam Key validation for quiz {}: {}", quizId, isValid);

        return ResponseEntity.ok(isValid);
    }

    /**
     * Generates and returns a SEB configuration file for a quiz.
     */
    @GetMapping("/config/{quizId}")
    public ResponseEntity<byte[]> getSebConfig(
            @PathVariable String quizId,
            HttpSession session) {

        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.error("No launch data in session when requesting SEB config");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not authenticated");
        }

        // Verify that SEB is required for this quiz
        QuizSebSetting setting = quizService.getSebSettingForQuiz(quizId);
        if (setting == null || !setting.isSebRequired()) {
            log.warn("Requested SEB config for quiz that doesn't require SEB: {}", quizId);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SEB not required for this quiz");
        }

        try {
            // Get the quiz URL
            String quizUrl = quizService.getQuizUrl(quizId);

            // Generate SEB config file
            byte[] configFile = sebService.generateSebConfig(quizId, quizUrl);

            // Set up response headers
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
            headers.setContentDispositionFormData("attachment", "quiz_" + quizId + ".seb");

            log.debug("Returning SEB config file for quiz {}: {} bytes", quizId, configFile.length);
            return new ResponseEntity<>(configFile, headers, HttpStatus.OK);
        } catch (IOException | NoSuchAlgorithmException e) {
            log.error("Error generating SEB config for quiz: {}", quizId, e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Error generating SEB config");
        }
    }

    /**
     * Displays the SEB required page for a quiz.
     */
    @GetMapping("/required/{quizId}")
    public String sebRequiredPage(
            @PathVariable String quizId,
            Model model,
            HttpServletRequest request) {

        // Check if the user is already using SEB
        boolean isUsingSeb = sebDetector.isSebBrowser(request);
        if (isUsingSeb) {
            // User is already using SEB, redirect to the quiz
            String quizUrl = quizService.getQuizUrl(quizId);
            model.addAttribute("quizUrl", quizUrl);
            return "redirect:" + quizUrl;
        }

        // User is not using SEB, show the requirement page
        model.addAttribute("quizId", quizId);
        return "sebRequired";
    }
}