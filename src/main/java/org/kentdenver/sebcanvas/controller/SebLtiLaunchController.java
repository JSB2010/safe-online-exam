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
 * Controller for handling student-facing LTI launches with SEB enforcement for
 * the supported classic-quiz module-item flow.
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
     * Handles LTI launches for SEB-enforced classic quizzes.
     * This is the endpoint that Canvas will POST to when a student clicks the module item.
     *
     * @param contentId The content ID (from URL path) - format: "classicquiz_123".
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
                try {
                    launchData = ltiService.validateToken(idToken);
                } catch (Exception e) {
                    log.error("Invalid LTI launch token for content: {}", contentId, e);
                    model.addAttribute("error", "Invalid LTI launch. Please try again from Canvas.");
                    return "error";
                }

                // Store launch data in session
                session.setAttribute("launchData", launchData);
                session.setAttribute("canvas_user_id", launchData.getUserId());

                log.info("LTI launch validated for user: {} ({})", launchData.getFullName(), launchData.getUserId());
            } else {
                // Try to get launch data from session (for GET requests or follow-up requests)
                launchData = (LtiService.LtiLaunchData) session.getAttribute("launchData");
                log.debug("Using existing launch data from session");
            }

            ContentItem content = resolveContent(contentId);

            if (content == null) {
                log.error("Unsupported or missing launch content: {}", contentId);
                model.addAttribute("error", "Launch content not found");
                return "error";
            }

            boolean sebRequired = isSebRequired(content);
            String launchTarget = resolveLaunchTarget(content);

            if (launchTarget == null || launchTarget.isBlank()) {
                log.error("No launch target available for content: {}", contentId);
                model.addAttribute("error", "Launch target not found");
                return "error";
            }

            log.info("Content: {} ({}) - SEB Required: {}", content.getTitle(), content.getContentType(), sebRequired);

            // If SEB is not required, redirect directly to Canvas content
            if (!sebRequired) {
                log.info("SEB not required, redirecting directly to content");
                return new RedirectView(launchTarget);
            }

            // Check if student is using SEB
            boolean isUsingSeb = isRequestFromSeb(request, content);

            log.info("SEB detection result: {}", isUsingSeb ? "SEB DETECTED" : "NOT SEB");

            if (isUsingSeb) {
                // Student is using SEB - allow access
                log.info("Student is using SEB, allowing access to content");
                return new RedirectView(launchTarget);
            } else {
                // Student is NOT using SEB - show download page
                log.info("Student is NOT using SEB, showing download page");

                // Prepare model for sebDownload.html template
                model.addAttribute("content", content);
                model.addAttribute("contentTitle", content.getTitle());
                model.addAttribute("contentType", content.getContentType().getDisplayName());
                model.addAttribute("courseId", content.getCourseId());
                model.addAttribute("contentId", content.getId());
                String configDownloadUrl = "/seb/config/" + content.getCourseId() + "/" + content.getId() + ".seb";
                model.addAttribute("configDownloadUrl", configDownloadUrl);
                model.addAttribute("sebConfigUrl", configDownloadUrl);

                // Backward compatibility attributes
                model.addAttribute("quiz", content);
                model.addAttribute("quizTitle", content.getTitle());
                model.addAttribute("quizId", content.getCanvasId());

                // Add user info if available
                if (launchData != null) {
                    model.addAttribute("userName", launchData.getFullName());
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

    private ContentItem resolveContent(String contentId) {
        ContentItem classicQuizContent = resolveClassicQuizContent(contentId);
        if (classicQuizContent != null) {
            return classicQuizContent;
        }

        return resolveNewQuizContent(contentId);
    }

    private ContentItem resolveClassicQuizContent(String contentId) {
        String quizId = extractClassicQuizId(contentId);
        if (quizId == null) {
            return null;
        }

        Quiz quiz = quizService.getQuiz(quizId);
        if (quiz == null) {
            log.warn("Classic quiz not found for launch content ID: {}", contentId);
            return null;
        }

        return ContentItem.fromQuiz(quiz);
    }

    private ContentItem resolveNewQuizContent(String contentId) {
        if (contentId == null || !contentId.startsWith("newquiz:")) {
            return null;
        }

        ContentItem cachedContent = contentService.getContentItem(contentId);
        if (cachedContent != null) {
            return cachedContent;
        }

        ContentSebSetting setting = contentService.getSebSetting(contentId);
        if (setting == null) {
            return null;
        }

        ContentItem fallback = new ContentItem();
        fallback.setId(contentId);
        fallback.setCourseId(setting.getCourseId());
        fallback.setCanvasId(setting.getCanvasId());
        fallback.setAssignmentId(setting.getAssignmentId());
        fallback.setContentType(setting.getContentType() != null ? setting.getContentType() : ContentItem.ContentType.NEW_QUIZ);
        fallback.setTitle("New Quiz");
        fallback.setHtmlUrl(setting.getHtmlUrl());
        fallback.setCanvasLaunchUrl(setting.getCanvasLaunchUrl());
        return fallback;
    }

    private boolean isSebRequired(ContentItem content) {
        if (content.getContentType() == ContentItem.ContentType.NEW_QUIZ) {
            ContentSebSetting setting = contentService.getSebSetting(content.getId());
            return setting != null && setting.isSebRequired();
        }

        QuizSebSetting quizSetting = quizService.getSebSettingForQuiz(content.getCanvasId());
        return quizSetting != null && quizSetting.isSebRequired();
    }

    private boolean isRequestFromSeb(HttpServletRequest request, ContentItem content) {
        if (content.getContentType() == ContentItem.ContentType.NEW_QUIZ) {
            return sebDetector.isRequestFromSEB(request, contentService.getSebSetting(content.getId()));
        }

        return sebDetector.isRequestFromSEB(request, quizService.getSebSettingForQuiz(content.getCanvasId()));
    }

    private String resolveLaunchTarget(ContentItem content) {
        if (content.getContentType() == ContentItem.ContentType.NEW_QUIZ
                && content.getCanvasLaunchUrl() != null
                && !content.getCanvasLaunchUrl().isBlank()) {
            return content.getCanvasLaunchUrl();
        }
        return content.getHtmlUrl();
    }

    private String extractClassicQuizId(String contentId) {
        if (contentId == null || contentId.isBlank()) {
            return null;
        }

        if (contentId.startsWith("classicquiz_")) {
            return contentId.substring("classicquiz_".length());
        }

        if (!contentId.contains("_")) {
            return contentId;
        }

        return null;
    }
}
