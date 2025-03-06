package org.kentdenver.sebcanvas.controller;

import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpSession;
import java.util.List;
import java.util.Optional;

@Controller
@RequestMapping("/teacher")
@RequiredArgsConstructor
@Slf4j
public class QuizController {

    private final CanvasService canvasService;
    private final SebSettingRepository sebSettingRepository;

    /**
     * Teacher dashboard
     */
    @GetMapping("/dashboard")
    public String dashboard(
            @RequestParam("courseId") String courseId,
            HttpSession session,
            Model model) {

        // Check LTI authentication
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("ltiLaunchData");
        if (launchData == null || !launchData.isInstructor()) {
            return "redirect:/error?message=Unauthorized";
        }

        // Get quizzes for the course
        // (In production, obtain access token from OAuth or session)
        String accessToken = "sample_access_token";
        List<Quiz> quizzes = canvasService.getQuizzesForCourse(courseId, accessToken);

        // Load SEB settings for each quiz
        for (Quiz quiz : quizzes) {
            Optional<QuizSebSetting> setting = sebSettingRepository.findByQuizId(quiz.getId());
            if (setting.isPresent()) {
                model.addAttribute("sebSetting_" + quiz.getId(), setting.get());
            }
        }

        model.addAttribute("quizzes", quizzes);
        model.addAttribute("courseId", courseId);

        return "teacherView";
    }

    /**
     * Update SEB settings for a quiz
     */
    @PostMapping("/updateSebSettings")
    @ResponseBody
    public String updateSebSettings(
            @RequestParam("quizId") String quizId,
            @RequestParam("sebRequired") boolean sebRequired,
            HttpSession session) {

        // Check LTI authentication
        LtiLaunchData launchData = (LtiLaunchData) session.getAttribute("ltiLaunchData");
        if (launchData == null || !launchData.isInstructor()) {
            return "Unauthorized";
        }

        // Find or create SEB settings for the quiz
        QuizSebSetting setting = sebSettingRepository.findByQuizId(quizId)
                .orElse(new QuizSebSetting());

        setting.setQuizId(quizId);
        setting.setSebRequired(sebRequired);

        // Save the settings
        sebSettingRepository.save(setting);

        return "Success";
    }
}