package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.view.RedirectView;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

/**
 * Controller for handling student-facing LTI launches with SEB enforcement.
 * This replaces the need for custom HTML modifications in Canvas.
 *
 * Phase 2: Now supports ALL content types (quizzes, assignments, New Quizzes, etc.)
 *
 * Flow:
 * 1. Student clicks module item (LTI link) in Canvas
 * 2. Canvas initiates LTI launch to /seb/launch/{contentId}
 * 3. We detect if student is using SEB
 * 4. If SEB: redirect to Canvas content
 * 5. If not SEB: show SEB download page
 */
@Controller
@RequestMapping("/seb/launch")
@Slf4j
public class SebLtiLaunchController {

    private final LtiService ltiService;
    private final QuizService quizService;
    private final ContentService contentService;
    private final SebDetector sebDetector;

    @Autowired
    public SebLtiLaunchController(
            LtiService ltiService,
            QuizService quizService,
            ContentService contentService,
            SebDetector sebDetector) {
        this.ltiService = ltiService;
        this.quizService = quizService;
        this.contentService = contentService;
        this.sebDetector = sebDetector;
    }

    /**
     * Handles LTI launches for SEB-enforced content (quizzes, assignments, etc.)
     * This is the endpoint that Canvas will POST to when a student clicks the module item.
     *
     * @param contentId The content ID (from URL path) - format: "classicquiz_123", "assignment_456", etc.
     * @param idToken The LTI 1.3 id_token from Canvas
     * @param request The HTTP request (for SEB detection)
     * @param session The HTTP session
     * @param model The Spring model
     * @return View name or redirect
     */
    @PostMapping("/{contentId}")
    public Object handleLtiLaunch(
            @PathVariable String contentId,
            @RequestParam(value = "id_token", required = false) String idToken,
            HttpServletRequest request,
            HttpSession session,
            Model model) {

        log.info("LTI launch received for content: {}", contentId);

        try {
            // Validate LTI launch (if id_token is present)
            LtiService.LtiLaunchData launchData = null;
            if (idToken != null) {
                launchData = ltiService.validateLtiLaunch(idToken);
                if (launchData == null) {
                    log.error("Invalid LTI launch token for content: {}", contentId);
                    model.addAttribute("error", "Invalid LTI launch. Please try again from Canvas.");
                    return "error";
                }

                // Store launch data in session
                session.setAttribute("launchData", launchData);
                session.setAttribute("canvas_user_id", launchData.getUserId());

                log.info("LTI launch validated for user: {} ({})", launchData.getUserName(), launchData.getUserId());
            } else {
                // Try to get launch data from session (for GET requests or follow-up requests)
                launchData = (LtiService.LtiLaunchData) session.getAttribute("launchData");
                log.debug("Using existing launch data from session");
            }

            // Get the content item
            ContentItem content = contentService.getContentItem(contentId);

            // Backward compatibility: Try as quiz ID if contentId doesn't have prefix
            if (content == null && !contentId.contains("_")) {
                log.debug("Content not found with ID {}, trying as legacy quiz ID", contentId);
                Quiz quiz = quizService.getQuiz(contentId);
                if (quiz != null) {
                    content = ContentItem.fromQuiz(quiz);
                }
            }

            if (content == null) {
                log.error("Content not found: {}", contentId);
                model.addAttribute("error", "Content not found");
                return "error";
            }

            // Get SEB settings (need to create service for this - for now use QuizService for backward compat)
            boolean sebRequired = false;
            ContentSebSetting sebSetting = null;

            // TODO: Replace with ContentSebSettingService
            if (content.getContentType() == ContentItem.ContentType.CLASSIC_QUIZ) {
                QuizSebSetting quizSetting = quizService.getSebSettingForQuiz(content.getCanvasId());
                sebRequired = quizSetting != null && quizSetting.isSebRequired();
            }

            log.info("Content: {} ({}) - SEB Required: {}", content.getTitle(), content.getContentType(), sebRequired);

            // If SEB is not required, redirect directly to Canvas content
            if (!sebRequired) {
                log.info("SEB not required, redirecting directly to content");
                return new RedirectView(content.getHtmlUrl());
            }

            // Check if student is using SEB
            boolean isUsingSeb = false;
            if (content.getContentType() == ContentItem.ContentType.CLASSIC_QUIZ) {
                QuizSebSetting quizSetting = quizService.getSebSettingForQuiz(content.getCanvasId());
                isUsingSeb = sebDetector.isRequestFromSEB(request, quizSetting);
            }

            log.info("SEB detection result: {}", isUsingSeb ? "SEB DETECTED" : "NOT SEB");

            if (isUsingSeb) {
                // Student is using SEB - allow access
                log.info("Student is using SEB, allowing access to content");
                return new RedirectView(content.getHtmlUrl());
            } else {
                // Student is NOT using SEB - show download page
                log.info("Student is NOT using SEB, showing download page");

                // Prepare model for sebDownload.html template
                model.addAttribute("content", content);
                model.addAttribute("contentTitle", content.getTitle());
                model.addAttribute("contentType", content.getContentType().getDisplayName());
                model.addAttribute("courseId", content.getCourseId());
                model.addAttribute("contentId", contentId);
                model.addAttribute("configDownloadUrl", "/seb/config/" + content.getCourseId() + "/" + contentId + ".seb");

                // Backward compatibility attributes
                model.addAttribute("quiz", content);
                model.addAttribute("quizTitle", content.getTitle());
                model.addAttribute("quizId", contentId);

                // Add user info if available
                if (launchData != null) {
                    model.addAttribute("userName", launchData.getUserName());
                }

                return "sebDownload";
            }

        } catch (Exception e) {
            log.error("Error handling LTI launch for content {}: {}", contentId, e.getMessage(), e);
            model.addAttribute("error", "An error occurred while launching the content. Please try again.");
            return "error";
        }
    }

    /**
     * Handles GET requests to the launch endpoint.
     * This can happen if the user bookmarks the launch URL or if Canvas sends a GET.
     */
    @GetMapping("/{contentId}")
    public Object handleLtiLaunchGet(
            @PathVariable String contentId,
            HttpServletRequest request,
            HttpSession session,
            Model model) {

        log.info("GET request to LTI launch endpoint for content: {}", contentId);

        // For GET requests, we don't have an id_token, so we check session for existing launch data
        // Then delegate to the POST handler
        return handleLtiLaunch(contentId, null, request, session, model);
    }

    /**
     * Handles the OIDC login initiation specifically for SEB launches.
     * Canvas may first hit this before the actual launch.
     */
    @GetMapping("/{contentId}/login")
    public RedirectView handleOidcLogin(
            @PathVariable String contentId,
            @RequestParam("iss") String issuer,
            @RequestParam("login_hint") String loginHint,
            @RequestParam("target_link_uri") String targetLinkUri,
            @RequestParam(value = "client_id", required = false) String clientId,
            @RequestParam(value = "lti_message_hint", required = false) String ltiMessageHint) {

        log.info("OIDC login initiation for SEB launch content: {}", contentId);

        // Use the main LTI login flow but with our specific target
        // This delegates to the main LTI controller's login handler
        // We just need to ensure the target_link_uri points back to our launch endpoint

        // For now, redirect to the main LTI login with our custom target_link_uri
        String redirectUrl = "/lti/login" +
                "?iss=" + issuer +
                "&login_hint=" + loginHint +
                "&target_link_uri=" + targetLinkUri +
                (clientId != null ? "&client_id=" + clientId : "") +
                (ltiMessageHint != null ? "&lti_message_hint=" + ltiMessageHint : "");

        return new RedirectView(redirectUrl);
    }
}
