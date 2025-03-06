package org.kentdenver.sebcanvas.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpSession;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Controller for quiz-related operations.
 * Handles API calls for quiz SEB settings and viewing quizzes.
 */
@Controller
@RequestMapping("/api/quizzes")
@Slf4j
@RequiredArgsConstructor
public class QuizController {

    private final QuizService quizService;

    /**
     * API endpoint to update SEB requirement for a quiz.
     */
    @PutMapping("/{quizId}/seb")
    @ResponseBody
    public ResponseEntity<QuizSebSetting> updateSebRequirement(
            @PathVariable String quizId,
            @RequestBody Map<String, Boolean> requestBody,
            HttpSession session) {

        // Verify that the user is authorized (should be instructor)
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null || !launchData.isInstructor()) {
            log.warn("Unauthorized attempt to update SEB requirement for quiz: {}", quizId);
            return ResponseEntity.status(403).build();
        }

        boolean required = requestBody.getOrDefault("required", false);
        log.debug("Updating SEB requirement for quiz {} to {}", quizId, required);

        QuizSebSetting setting = quizService.updateSebRequirement(quizId, required);
        return ResponseEntity.ok(setting);
    }

    /**
     * Gets all quizzes for the current course.
     */
    @GetMapping
    @ResponseBody
    public ResponseEntity<List<Quiz>> getQuizzes(HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.warn("Attempted to get quizzes without valid launch data");
            return ResponseEntity.status(403).build();
        }

        String courseId = launchData.getCourseId();
        log.debug("Getting quizzes for course: {}", courseId);

        List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId);
        return ResponseEntity.ok(quizzes);
    }

    /**
     * Gets all SEB settings for quizzes in the current course.
     */
    @GetMapping("/seb-settings")
    @ResponseBody
    public ResponseEntity<Map<String, QuizSebSetting>> getQuizSebSettings(HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.warn("Attempted to get SEB settings without valid launch data");
            return ResponseEntity.status(403).build();
        }

        String courseId = launchData.getCourseId();
        log.debug("Getting SEB settings for course: {}", courseId);

        // Get all quizzes in the course
        List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId);

        // Get SEB settings for each quiz
        Map<String, QuizSebSetting> settings = new HashMap<>();
        for (Quiz quiz : quizzes) {
            QuizSebSetting setting = quizService.getSebSettingForQuiz(quiz.getId());
            if (setting != null) {
                settings.put(quiz.getId(), setting);
            }
        }

        return ResponseEntity.ok(settings);
    }

    /**
     * View endpoint to display all quizzes and their SEB settings.
     */
    @GetMapping("/view")
    public String viewQuizzes(Model model, HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.warn("Attempted to view quizzes without valid launch data");
            return "redirect:/login";
        }

        String courseId = launchData.getCourseId();
        log.debug("Viewing quizzes for course: {}", courseId);

        // Get all quizzes in the course
        List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId);
        model.addAttribute("quizzes", quizzes);

        // Get SEB settings for each quiz
        Map<String, QuizSebSetting> quizSebSettings = quizzes.stream()
                .map(quiz -> quizService.getSebSettingForQuiz(quiz.getId()))
                .filter(setting -> setting != null)
                .collect(Collectors.toMap(QuizSebSetting::getQuizId, setting -> setting));

        model.addAttribute("quizSebSettings", quizSebSettings);
        model.addAttribute("launchData", launchData);

        return "quizzes";
    }

    /**
     * Gets details for a specific quiz.
     */
    @GetMapping("/{quizId}")
    @ResponseBody
    public ResponseEntity<Quiz> getQuiz(@PathVariable String quizId, HttpSession session) {
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("launchData");
        if (launchData == null) {
            log.warn("Attempted to get quiz without valid launch data");
            return ResponseEntity.status(403).build();
        }

        log.debug("Getting details for quiz: {}", quizId);

        Quiz quiz = quizService.getQuiz(quizId);
        if (quiz == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(quiz);
    }
}
