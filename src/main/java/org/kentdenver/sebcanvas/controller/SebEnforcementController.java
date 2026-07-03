package org.kentdenver.sebcanvas.controller;

import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebConfigKeyService;
import org.kentdenver.sebcanvas.service.SebConfigurationService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Controller for SEB (Safe Exam Browser) enforcement.
 * This replaces Respondus LockDown Browser functionality.
 * 
 * Flow:
 * 1. Student clicks Canvas quiz link (modified to point to our service)
 * 2. We check if request has SEB headers
 * 3. If SEB detected -> redirect to actual Canvas quiz
 * 4. If no SEB -> show download/instruction page
 */
@Controller
@RequestMapping("/seb")
public class SebEnforcementController {

    private static final Logger log = LoggerFactory.getLogger(SebEnforcementController.class);

    @Autowired
    private QuizService quizService;

    @Autowired
    private SebConfigurationService sebConfigurationService;

    @Autowired
    private ContentService contentService;

    @Autowired
    private SebDetector sebDetector;

    @Autowired
    private SebConfigKeyService sebConfigKeyService;

    @Autowired
    private CanvasApiConfig canvasApiConfig;

    /**
     * Main SEB enforcement endpoint.
     * This is where Canvas quiz links will redirect to.
     * 
     * @param quizId Canvas quiz ID
     * @param courseId Canvas course ID  
     * @param canvasUrl Original Canvas quiz URL (encoded)
     * @param request HTTP request to check for SEB headers
     * @param model Spring model for template rendering
     * @return Either redirect to Canvas quiz (if SEB) or SEB download page
     */
    @GetMapping("/quiz/{courseId}/{quizId}")
    public String enforceQuiz(
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestParam(value = "canvas_url", required = false) String canvasUrl,
            @RequestParam(value = "user_id", required = false) String userId,
            HttpServletRequest request,
            Model model) {

        log.info("SEB enforcement check for quiz {} in course {} from user {}", quizId, courseId, userId);

        try {
            // Check if this quiz requires SEB
            QuizSebSetting sebSetting = quizService.getSebSettingForQuiz(quizId);
            if (sebSetting == null || !sebSetting.isSebRequired()) {
                log.info("Quiz {} does not require SEB, redirecting to Canvas", quizId);
                return redirectToCanvas(canvasUrl, courseId, quizId);
            }

            // Check if request is coming from SEB
            boolean isSebRequest = sebDetector.isRequestFromSEB(request, sebSetting);
            
            if (isSebRequest) {
                log.info("SEB detected for quiz {}, allowing access to Canvas", quizId);
                return redirectToCanvas(canvasUrl, courseId, quizId);
            } else {
                log.info("SEB not detected for quiz {}, showing download page", quizId);
                return showSebDownloadPage(courseId, quizId, canvasUrl, userId, request, model);
            }

        } catch (Exception e) {
            log.error("Error in SEB enforcement for quiz {}: {}", quizId, e.getMessage(), e);
            model.addAttribute("error", "Unable to verify SEB requirements. Please contact your instructor.");
            return "error";
        }
    }

    /**
     * Endpoint to download SEB configuration file for a specific quiz.
     */
    @GetMapping("/config/{courseId}/{quizId}")
    @ResponseBody
    public ResponseEntity<byte[]> downloadSebConfig(
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestParam(value = "canvas_url", required = false) String canvasUrl,
            @RequestParam(value = "user_id", required = false) String userId) {

        String location = String.format("/seb/config/%s/%s.seb", courseId, quizId);
        return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, location)
                .build();
    }

    /**
     * Redirects to the actual Canvas quiz.
     */
    private String redirectToCanvas(String canvasUrl, String courseId, String quizId) {
        if (canvasUrl != null && !canvasUrl.isEmpty()) {
            try {
                String decodedUrl = URLDecoder.decode(canvasUrl, StandardCharsets.UTF_8);
                log.debug("Redirecting to Canvas URL: {}", decodedUrl);
                return "redirect:" + decodedUrl;
            } catch (Exception e) {
                log.error("Error decoding Canvas URL: {}", e.getMessage());
            }
        }
        
        // Fallback: construct Canvas URL
        String fallbackUrl = String.format("https://kentdenver.instructure.com/courses/%s/quizzes/%s", courseId, quizId);
        log.debug("Using fallback Canvas URL: {}", fallbackUrl);
        return "redirect:" + fallbackUrl;
    }

    /**
     * Shows the SEB download and instruction page.
     */
    private String showSebDownloadPage(String courseId,
                                       String quizId,
                                       String canvasUrl,
                                       String userId,
                                       HttpServletRequest request,
                                       Model model) {
        model.addAttribute("courseId", courseId);
        model.addAttribute("quizId", quizId);
        model.addAttribute("canvasUrl", canvasUrl);
        model.addAttribute("userId", userId);
        String configUrl = String.format("/seb/config/%s/%s.seb?canvas_url=%s&user_id=%s",
                courseId, quizId, encodeQueryParam(canvasUrl), encodeQueryParam(userId));
        model.addAttribute("configUrl", configUrl);
        model.addAttribute("sebConfigUrl", configUrl);
        model.addAttribute("sebLaunchUrl", toSebSchemeUrl(request, configUrl));

        return "sebRequired";
    }

    /**
     * Downloads the SEB configuration file for a specific quiz.
     * This endpoint generates a comprehensive SEB configuration that:
     * - Completely locks down the computer
     * - Implements all necessary security measures
     * - Automatically provides quiz access codes
     * - Configures allowed websites and browser restrictions
     */
    @GetMapping("/config/{courseId}/{quizId}.seb")
    public ResponseEntity<byte[]> downloadSebConfig(
            @PathVariable String courseId,
            @PathVariable("quizId") String contentId,
            @RequestParam(required = false) String canvas_url,
            @RequestParam(required = false) String user_id,
            HttpServletRequest request) {

        log.info("Generating SEB configuration for course: {}, quiz/content: {}", courseId, contentId);

        try {
            if (isContentScopedLaunchId(contentId)) {
                return downloadContentScopedSebConfig(courseId, contentId, request);
            }

            QuizSebSetting quizSetting = quizService.getSebSettingForQuiz(contentId);
            if (quizSetting == null
                    || !quizSetting.isSebRequired()
                    || quizSetting.getAccessCode() == null
                    || quizSetting.getAccessCode().isBlank()) {
                log.warn("SEB not enabled or access code missing for quiz {}", contentId);
                return ResponseEntity.badRequest().build();
            }

            String launchContentId = "classicquiz_" + contentId;
            String quizUrl = resolveClassicCanvasStartUrl(courseId, contentId, canvas_url);
            log.debug("Quiz URL for SEB config: {}", quizUrl);
            log.debug("Access code configured: yes");

            // Generate comprehensive SEB configuration
            byte[] sebConfig = sebConfigurationService.generateSebConfiguration(
                courseId,
                launchContentId,
                quizUrl,
                quizSetting.getAccessCode(),
                getAllowedDomains(quizSetting),
                quizSetting.getQuitPassword());
            persistQuizConfigKey(quizSetting, sebConfig);

            // Set appropriate headers for file download
            HttpHeaders headers = new HttpHeaders();
            // Use application/octet-stream to force download instead of display
            headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
            headers.setContentDispositionFormData("attachment",
                String.format("quiz_%s_%s.seb", courseId, contentId));
            headers.add("Content-Description", "Safe Exam Browser Configuration");
            headers.add("X-Content-Type-Options", "nosniff");
            headers.add("Content-Transfer-Encoding", "binary");
            headers.add("Accept-Ranges", "bytes");

            log.info("Successfully generated SEB configuration file ({} bytes) for quiz: {}",
                    sebConfig.length, contentId);

            return ResponseEntity.ok()
                    .headers(headers)
                    .body(sebConfig);

        } catch (Exception e) {
            log.error("Failed to generate SEB configuration for quiz/content: {}", contentId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(("Error generating SEB configuration: " + e.getMessage()).getBytes());
        }
    }

    private boolean isContentScopedLaunchId(String contentId) {
        return contentId != null && (contentId.startsWith("classicquiz_") || contentId.startsWith("newquiz:"));
    }

    private ResponseEntity<byte[]> downloadContentScopedSebConfig(String courseId,
                                                                  String contentId,
                                                                  HttpServletRequest request) {
        String accessCode;
        List<String> allowedDomains;

        if (contentId.startsWith("newquiz:")) {
            ContentSebSetting setting = contentService.getSebSetting(contentId);
            if (setting == null || !setting.isSebRequired() || setting.getAccessCode() == null || setting.getAccessCode().isBlank()) {
                log.warn("SEB not enabled or access code missing for content {}", contentId);
                return ResponseEntity.badRequest().build();
            }
            accessCode = setting.getAccessCode();
            allowedDomains = getAllowedDomains(setting);

            String launchUrl = resolveNewQuizCanvasStartUrl(courseId, contentId, setting);
            byte[] sebConfig = sebConfigurationService.generateSebConfiguration(
                    courseId,
                    contentId,
                    launchUrl,
                    accessCode,
                    allowedDomains,
                    setting.getQuitPassword());
            persistContentConfigKey(setting, sebConfig);

            return buildConfigDownloadResponse(courseId, contentId, sebConfig);
        } else {
            String quizId = contentId.substring("classicquiz_".length());
            QuizSebSetting quizSetting = quizService.getSebSettingForQuiz(quizId);
            if (quizSetting == null || !quizSetting.isSebRequired() || quizSetting.getAccessCode() == null || quizSetting.getAccessCode().isBlank()) {
                log.warn("SEB not enabled or access code missing for classic quiz content {}", contentId);
                return ResponseEntity.badRequest().build();
            }
            accessCode = quizSetting.getAccessCode();
            allowedDomains = getAllowedDomains(quizSetting);

            String launchUrl = resolveClassicCanvasStartUrl(courseId, quizId, null);
            byte[] sebConfig = sebConfigurationService.generateSebConfiguration(
                    courseId,
                    contentId,
                    launchUrl,
                    accessCode,
                    allowedDomains,
                    quizSetting.getQuitPassword());
            persistQuizConfigKey(quizSetting, sebConfig);

            return buildConfigDownloadResponse(courseId, contentId, sebConfig);
        }
    }

    private String resolveClassicCanvasStartUrl(String courseId, String quizId, String canvasUrl) {
        String queryParamUrl = normalizeCanvasStartUrl(canvasUrl);
        if (queryParamUrl != null) {
            return queryParamUrl;
        }

        Quiz quiz = quizService.getQuiz(quizId);
        if (quiz != null) {
            String storedUrl = normalizeCanvasStartUrl(quiz.getHtmlUrl());
            if (storedUrl != null) {
                return storedUrl;
            }
        }

        return buildCanvasContentUrl(courseId, "quizzes", quizId);
    }

    private String resolveNewQuizCanvasStartUrl(String courseId, String contentId, ContentSebSetting setting) {
        ContentItem content = contentService.getContentItem(contentId);
        String startUrl = firstCanvasStartUrl(
                content != null ? content.getHtmlUrl() : null,
                setting.getHtmlUrl(),
                content != null ? content.getCanvasLaunchUrl() : null,
                setting.getCanvasLaunchUrl());
        if (startUrl != null) {
            return startUrl;
        }

        String assignmentId = firstText(
                content != null ? content.getAssignmentId() : null,
                setting.getAssignmentId(),
                setting.getCanvasId(),
                parseNewQuizAssignmentId(contentId));
        if (assignmentId != null) {
            return buildCanvasContentUrl(courseId, "assignments", assignmentId);
        }

        throw new IllegalStateException("Unable to determine Canvas start URL for New Quiz " + contentId);
    }

    private String firstCanvasStartUrl(String... candidates) {
        for (String candidate : candidates) {
            String normalized = normalizeCanvasStartUrl(candidate);
            if (normalized != null) {
                return normalized;
            }
        }
        return null;
    }

    private String normalizeCanvasStartUrl(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }

        String decoded = decodeQueryParam(value.trim());
        if (isConfiguredCanvasUrl(decoded)) {
            return decoded;
        }

        log.warn("Ignoring non-Canvas SEB start URL candidate: {}", decoded);
        return null;
    }

    private boolean isConfiguredCanvasUrl(String value) {
        try {
            URI candidate = URI.create(value);
            URI canvasBase = URI.create(getCanvasBaseUrl());
            return "https".equalsIgnoreCase(candidate.getScheme())
                    && candidate.getHost() != null
                    && candidate.getHost().equalsIgnoreCase(canvasBase.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    private String buildCanvasContentUrl(String courseId, String contentPath, String canvasId) {
        return getCanvasBaseUrl() + "/courses/" + courseId + "/" + contentPath + "/" + canvasId;
    }

    private String getCanvasBaseUrl() {
        try {
            String canvasDomain = canvasApiConfig.getCanvasDomain();
            if (canvasDomain != null && !canvasDomain.isBlank()) {
                return canvasDomain.replaceAll("/+$", "");
            }
        } catch (Exception e) {
            log.warn("Could not resolve Canvas base URL from configuration: {}", e.getMessage());
        }
        return "https://kentdenver.instructure.com";
    }

    private String parseNewQuizAssignmentId(String contentId) {
        if (contentId == null || !contentId.startsWith("newquiz:")) {
            return null;
        }
        String[] parts = contentId.split(":");
        return parts.length == 3 && !parts[2].isBlank() ? parts[2] : null;
    }

    private String firstText(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private String decodeQueryParam(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return value;
        }
    }

    private String encodeQueryParam(String value) {
        return value == null ? "" : URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private ResponseEntity<byte[]> buildConfigDownloadResponse(String courseId, String contentId, byte[] sebConfig) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        headers.setContentDispositionFormData("attachment",
                String.format("quiz_%s_%s.seb", courseId, sanitizeFileToken(contentId)));
        headers.add("Content-Description", "Safe Exam Browser Configuration");
        headers.add("X-Content-Type-Options", "nosniff");
        headers.add("Content-Transfer-Encoding", "binary");
        headers.add("Accept-Ranges", "bytes");

        return ResponseEntity.ok()
                .headers(headers)
                .body(sebConfig);
    }

    private void persistQuizConfigKey(QuizSebSetting setting, byte[] sebConfig) {
        String configKey = sebConfigKeyService.computeConfigKey(sebConfig);
        setting.setConfigKey(configKey);
        quizService.saveSebSetting(setting);
        log.debug("Persisted SEB Config Key for quiz {}", setting.getQuizId());
    }

    private void persistContentConfigKey(ContentSebSetting setting, byte[] sebConfig) {
        String configKey = sebConfigKeyService.computeConfigKey(sebConfig);
        setting.setConfigKey(configKey);
        contentService.saveSebSetting(setting);
        log.debug("Persisted SEB Config Key for content {}", setting.getContentId());
    }

    private List<String> getAllowedDomains(QuizSebSetting setting) {
        List<String> domains = new ArrayList<>();
        if (setting.getSsoDomains() != null) {
            domains.addAll(setting.getSsoDomains());
        }
        if (setting.getEducationalToolDomains() != null) {
            domains.addAll(setting.getEducationalToolDomains());
        }
        if (setting.getCustomDomains() != null) {
            domains.addAll(setting.getCustomDomains());
        }
        return domains;
    }

    private List<String> getAllowedDomains(ContentSebSetting setting) {
        List<String> domains = new ArrayList<>();
        if (setting.getSsoDomains() != null) {
            domains.addAll(setting.getSsoDomains());
        }
        if (setting.getEducationalToolDomains() != null) {
            domains.addAll(setting.getEducationalToolDomains());
        }
        if (setting.getCustomDomains() != null) {
            domains.addAll(setting.getCustomDomains());
        }
        return domains;
    }

    private String sanitizeFileToken(String value) {
        return value.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private String toSebSchemeUrl(HttpServletRequest request, String relativeConfigUrl) {
        StringBuilder url = new StringBuilder("sebs://")
                .append(request.getServerName());
        if (request.getServerPort() != 80 && request.getServerPort() != 443) {
            url.append(":").append(request.getServerPort());
        }
        if (request.getContextPath() != null && !request.getContextPath().isBlank()) {
            url.append(request.getContextPath());
        }
        url.append(relativeConfigUrl);
        return url.toString();
    }
}
