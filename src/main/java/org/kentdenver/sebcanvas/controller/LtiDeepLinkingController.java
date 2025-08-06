package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.LtiDeepLinkingService;

import org.kentdenver.sebcanvas.service.QuizService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
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
 * Controller for handling LTI Deep Linking requests and responses.
 * Manages content item selection for configuring quizzes with SEB.
 */
@Controller
@RequestMapping("/lti/deeplink")
@Slf4j
public class LtiDeepLinkingController {

    private final LtiDeepLinkingService deepLinkingService;
    private final QuizService quizService;

    @Autowired
    public LtiDeepLinkingController(
            LtiDeepLinkingService deepLinkingService,
            QuizService quizService) {
        this.deepLinkingService = deepLinkingService;
        this.quizService = quizService;
    }

    /**
     * Displays the content item selection UI for instructors.
     * This endpoint should be called when Canvas initiates a Deep Linking request.
     */
    @GetMapping("/select")
    public String selectContentItems(
            @RequestParam(required = false) String deploymentId,
            @RequestParam(required = false) String returnUrl,
            @RequestParam(required = false) String data,
            @RequestParam(required = false) String courseId,
            HttpSession session,
            Model model) {

        log.debug("Deep Linking content selection initiated for course: {}", courseId);

        // Store Deep Linking parameters in session
        session.setAttribute("dl_deployment_id", deploymentId);
        session.setAttribute("dl_return_url", returnUrl);
        session.setAttribute("dl_data", data);

        // Get quizzes for this course
        List<Quiz> quizzes = quizService.getQuizzesForCourse(courseId);
        model.addAttribute("quizzes", quizzes);

        // Get SEB settings for each quiz
        Map<String, Boolean> quizSebRequirements = quizService.getQuizSebRequirements(quizzes);
        model.addAttribute("quizSebRequirements", quizSebRequirements);

        // Add Deep Linking info to model
        model.addAttribute("deploymentId", deploymentId);
        model.addAttribute("returnUrl", returnUrl);
        model.addAttribute("courseId", courseId);

        return "deepLinkingSelect";
    }

    /**
     * Processes the content item selection form and creates a Deep Linking response.
     * This endpoint is called when the instructor submits their quiz selections.
     */
    @PostMapping(value = "/process", produces = MediaType.TEXT_HTML_VALUE)
    @ResponseBody
    public String processContentItems(
            @RequestParam Map<String, String> requestParams,
            HttpSession session) {

        log.debug("Processing Deep Linking content selection");

        try {
            // Get Deep Linking parameters from session
            String deploymentId = (String) session.getAttribute("dl_deployment_id");
            String returnUrl = (String) session.getAttribute("dl_return_url");
            String data = (String) session.getAttribute("dl_data");

            if (deploymentId == null || returnUrl == null) {
                log.error("Missing required Deep Linking parameters");
                return "<html><body><h1>Error</h1><p>Missing required Deep Linking parameters</p></body></html>";
            }

            // Process selected quizzes
            List<String> selectedQuizIds = requestParams.entrySet().stream()
                    .filter(e -> e.getKey().startsWith("quiz_") && "on".equals(e.getValue()))
                    .map(e -> e.getKey().substring(5)) // Remove "quiz_" prefix
                    .collect(Collectors.toList());

            log.debug("Selected {} quizzes for Deep Linking", selectedQuizIds.size());

            // Get quiz details for selected quizzes
            List<Quiz> selectedQuizzes = selectedQuizIds.stream()
                    .map(quizService::getQuiz)
                    .filter(q -> q != null)
                    .collect(Collectors.toList());

            // Get SEB settings for selected quizzes
            Map<String, QuizSebSetting> sebSettings = new HashMap<>();
            for (Quiz quiz : selectedQuizzes) {
                QuizSebSetting setting = quizService.getSebSettingForQuiz(quiz.getId());
                if (setting != null) {
                    sebSettings.put(quiz.getId(), setting);
                }
            }

            // Process SEB requirements from form
            for (String quizId : selectedQuizIds) {
                boolean requiresSeb = "on".equals(requestParams.get("seb_" + quizId));

                // Update SEB requirement
                QuizSebSetting updatedSetting = quizService.updateSebRequirement(quizId, requiresSeb);
                sebSettings.put(quizId, updatedSetting);
            }

            // Create Deep Linking response
            String jwt = deepLinkingService.createDeepLinkingResponse(
                    deploymentId,
                    returnUrl,
                    selectedQuizzes,
                    sebSettings,
                    data);

            // Create auto-submit form
            return deepLinkingService.createAutoSubmitForm(returnUrl, jwt);

        } catch (Exception e) {
            log.error("Error processing Deep Linking content selection", e);
            return "<html><body><h1>Error</h1><p>Failed to process content selection: " +
                    e.getMessage() + "</p></body></html>";
        }
    }

    /**
     * Updates module items for SEB-enabled quizzes using Deep Linking.
     * This endpoint can be called when SEB settings are changed.
     */
    @PostMapping("/update-seb")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> updateSebModuleItems(
            @RequestParam String courseId,
            @RequestParam String quizId,
            @RequestParam boolean sebRequired,
            HttpSession session) {

        try {
            log.info("Updating module items for quiz {} in course {} - SEB required: {}", quizId, courseId, sebRequired);

            // Get the quiz details
            Quiz quiz = quizService.getQuiz(quizId);
            if (quiz == null) {
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "Quiz not found: " + quizId));
            }

            // Create Deep Linking response for this quiz
            String jwt = deepLinkingService.createSingleQuizDeepLinkResponse(quiz, sebRequired);

            // For now, we'll return the JWT that would be sent to Canvas
            // In a full implementation, this would be sent to Canvas via the Deep Linking flow
            Map<String, Object> response = Map.of(
                "success", true,
                "message", "Deep Linking response created for quiz " + quizId,
                "sebRequired", sebRequired,
                "jwt", jwt
            );

            log.info("Successfully created Deep Linking response for quiz {}", quizId);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Error updating module items for quiz {}", quizId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to update module items: " + e.getMessage()));
        }
    }
}