package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebAccessProofService;
import org.kentdenver.sebcanvas.service.SebConfigKeyService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Simple API controller for SEB-related endpoints.
 * This controller handles the access code API that the JavaScript uses.
 */
@RestController
@RequestMapping("/api/seb")
@Slf4j
public class SebApiController {

    private final QuizService quizService;
    private final ContentService contentService;
    private final SebConfigKeyService sebConfigKeyService;
    private final SebAccessProofService sebAccessProofService;

    @Autowired
    public SebApiController(QuizService quizService,
                            ContentService contentService,
                            SebConfigKeyService sebConfigKeyService,
                            SebAccessProofService sebAccessProofService) {
        this.quizService = quizService;
        this.contentService = contentService;
        this.sebConfigKeyService = sebConfigKeyService;
        this.sebAccessProofService = sebAccessProofService;
        log.info("SebApiController initialized with Config Key proof security");
    }

    @PostMapping("/access-proof/{courseId}/{quizId}")
    public ResponseEntity<Map<String, Object>> createAccessProof(
            @PathVariable String courseId,
            @PathVariable String quizId,
            @RequestBody(required = false) ConfigKeyProofRequest proofRequest,
            HttpServletRequest request) {

        Map<String, Object> response = new HashMap<>();
        SebSettingView setting = resolveSetting(courseId, quizId);
        if (setting == null || !setting.enabledForAccess()) {
            response.put("success", false);
            response.put("message", "No SEB setting found for this quiz");
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
        }

        if (setting.configKey() == null || setting.configKey().isBlank()) {
            response.put("success", false);
            response.put("message", "SEB configuration must be downloaded before access-code proof can be issued");
            return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
        }

        String providedHash = proofRequest != null ? proofRequest.configKeyHash() : null;
        String proofUrl = proofRequest != null ? proofRequest.url() : null;
        boolean validProof = sebConfigKeyService.validateConfigKeyHashForUrl(providedHash, proofUrl, setting.configKey())
                || sebConfigKeyService.validateConfigKeyHash(request, setting.configKey());

        if (!validProof) {
            logInvalidConfigKeyProof(courseId, quizId, providedHash, proofUrl, setting.configKey(), request);
            response.put("success", false);
            response.put("message", "Invalid SEB configuration proof");
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
        }

        response.put("success", true);
        response.put("proofToken", sebAccessProofService.mintProof(courseId, quizId));
        response.put("expiresInSeconds", sebAccessProofService.getTokenTtlSeconds());
        return ResponseEntity.ok(response);
    }

    private void logInvalidConfigKeyProof(String courseId,
                                          String quizId,
                                          String providedHash,
                                          String proofUrl,
                                          String storedConfigKey,
                                          HttpServletRequest request) {
        String requestUrl = requestUrl(request);
        String proofUrlWithoutQuery = removeQuery(proofUrl);
        String expectedForProofUrl = hashForLog(proofUrl, storedConfigKey);
        String expectedForProofUrlWithoutQuery = hashForLog(proofUrlWithoutQuery, storedConfigKey);
        String expectedForRequestUrl = hashForLog(requestUrl, storedConfigKey);

        log.warn("Invalid SEB Config Key proof for course {} quiz {}: provided={}, proofUrl={}, " +
                        "matchesProofUrl={}, matchesProofUrlWithoutQuery={}, matchesRequestUrl={}, " +
                        "expectedProof={}, expectedProofNoQuery={}, expectedRequest={}, storedConfigKey={}",
                courseId,
                quizId,
                fingerprint(providedHash),
                sanitizeUrlForLog(proofUrl),
                equalsHash(providedHash, expectedForProofUrl),
                equalsHash(providedHash, expectedForProofUrlWithoutQuery),
                equalsHash(providedHash, expectedForRequestUrl),
                fingerprint(expectedForProofUrl),
                fingerprint(expectedForProofUrlWithoutQuery),
                fingerprint(expectedForRequestUrl),
                fingerprint(storedConfigKey));
    }

    private String hashForLog(String url, String storedConfigKey) {
        if (url == null || url.isBlank() || storedConfigKey == null || storedConfigKey.isBlank()) {
            return null;
        }
        return sebConfigKeyService.hashForUrl(url, storedConfigKey);
    }

    private boolean equalsHash(String providedHash, String expectedHash) {
        return providedHash != null && expectedHash != null && providedHash.equalsIgnoreCase(expectedHash);
    }

    private String fingerprint(String value) {
        if (value == null || value.isBlank()) {
            return "missing";
        }
        if (value.length() <= 16) {
            return "len=" + value.length() + ",fp=" + value;
        }
        return "len=" + value.length() + ",fp=" + value.substring(0, 8) + "..." + value.substring(value.length() - 8);
    }

    private String sanitizeUrlForLog(String url) {
        if (url == null || url.isBlank()) {
            return "missing";
        }

        try {
            URI uri = URI.create(url);
            String queryKeys = "";
            if (uri.getRawQuery() != null && !uri.getRawQuery().isBlank()) {
                queryKeys = Arrays.stream(uri.getRawQuery().split("&"))
                        .map(part -> part.split("=", 2)[0])
                        .distinct()
                        .collect(Collectors.joining(",", "?queryKeys=", ""));
            }

            return uri.getScheme() + "://" + uri.getHost() + safeString(uri.getRawPath()) + queryKeys;
        } catch (Exception e) {
            return "unparseable,len=" + url.length();
        }
    }

    private String requestUrl(HttpServletRequest request) {
        if (request == null) {
            return null;
        }

        StringBuilder url = new StringBuilder(request.getRequestURL());
        if (request.getQueryString() != null) {
            url.append("?").append(request.getQueryString());
        }
        return url.toString();
    }

    private String removeQuery(String url) {
        if (url == null) {
            return null;
        }
        int queryIndex = url.indexOf('?');
        return queryIndex >= 0 ? url.substring(0, queryIndex) : url;
    }

    private String safeString(String value) {
        return value == null ? "" : value;
    }

    /**
     * Provides the access code for a specific quiz when requested from SEB.
     * This endpoint is used by the JavaScript auto-fill functionality.
     * SECURITY: Requires a short-lived, single-use Config Key proof token.
     */
    @GetMapping("/access-code/{courseId}/{quizId}")
    public ResponseEntity<Map<String, Object>> getAccessCode(
            @PathVariable String courseId,
            @PathVariable String quizId,
            HttpServletRequest request) {

        Map<String, Object> response = new HashMap<>();

        try {
            log.info("SEB API access-code request for course {} quiz/content {}", courseId, quizId);

            String proofToken = request.getHeader("X-SEB-Proof-Token");
            if (!sebAccessProofService.consumeProof(proofToken, courseId, quizId)) {
                response.put("success", false);
                response.put("message", "Invalid or expired SEB access proof");
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
            }

            ContentSebSetting contentSetting = resolveNewQuizSetting(courseId, quizId);
            if (contentSetting != null) {
                return buildContentAccessCodeResponse(courseId, quizId, contentSetting, response);
            }

            // Get SEB setting for this classic quiz
            QuizSebSetting setting = quizService.getSebSettingForQuiz(quizId);
            if (setting == null) {
                log.info("No SEB setting found for quiz {}", quizId);
                response.put("success", false);
                response.put("message", "No SEB setting found for this quiz");
                return ResponseEntity.ok(response);
            }

            if (setting.getCourseId() != null && !courseId.equals(setting.getCourseId())) {
                log.warn("Rejecting access-code request for quiz {}: requested course {} does not match setting course {}",
                        quizId, courseId, setting.getCourseId());
                response.put("success", false);
                response.put("message", "No SEB setting found for this quiz");
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
            }

            if (!setting.isSebRequired() || !setting.isEnabled()) {
                log.info("SEB not required or not enabled for quiz {}: sebRequired={}, enabled={}",
                        quizId, setting.isSebRequired(), setting.isEnabled());
                response.put("success", false);
                response.put("message", "SEB not required for this quiz");
                return ResponseEntity.ok(response);
            }

            String accessCode = setting.getAccessCode();
            if (accessCode == null || accessCode.trim().isEmpty()) {
                log.info("No access code set for quiz {}", quizId);
                response.put("success", false);
                response.put("message", "No access code configured for this quiz");
                return ResponseEntity.ok(response);
            }

            log.info("Returning SEB access code for quiz {}", quizId);
            response.put("success", true);
            response.put("accessCode", accessCode);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Error getting access code for quiz {}", quizId, e);
            response.put("success", false);
            response.put("message", "Error retrieving access code: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    private ContentSebSetting resolveNewQuizSetting(String courseId, String quizId) {
        if (quizId == null) {
            return null;
        }

        if (quizId.startsWith("newquiz:")) {
            return contentService.getSebSetting(quizId);
        }

        String contentId = ContentItem.newQuizContentId(courseId, quizId);
        ContentSebSetting setting = contentService.getSebSetting(contentId);
        if (setting != null && setting.getContentType() == ContentItem.ContentType.NEW_QUIZ) {
            return setting;
        }

        return null;
    }

    private ResponseEntity<Map<String, Object>> buildContentAccessCodeResponse(String courseId,
                                                                               String quizId,
                                                                               ContentSebSetting setting,
                                                                               Map<String, Object> response) {
        if (setting.getCourseId() != null && !courseId.equals(setting.getCourseId())) {
            log.warn("Rejecting access-code request for content {}: requested course {} does not match setting course {}",
                    quizId, courseId, setting.getCourseId());
            response.put("success", false);
            response.put("message", "No SEB setting found for this quiz");
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
        }

        if (!setting.isSebRequired() || !setting.isEnabled()) {
            log.info("SEB not required or not enabled for content {}: sebRequired={}, enabled={}",
                    quizId, setting.isSebRequired(), setting.isEnabled());
            response.put("success", false);
            response.put("message", "SEB not required for this quiz");
            return ResponseEntity.ok(response);
        }

        String accessCode = setting.getAccessCode();
        if (accessCode == null || accessCode.trim().isEmpty()) {
            log.info("No access code set for content {}", quizId);
            response.put("success", false);
            response.put("message", "No access code configured for this quiz");
            return ResponseEntity.ok(response);
        }

        log.info("Returning SEB access code for content {}", quizId);
        response.put("success", true);
        response.put("accessCode", accessCode);
        return ResponseEntity.ok(response);
    }

    /**
     * Provides JavaScript code for Canvas integration to detect and enforce SEB requirements.
     * This script should be injected into Canvas quiz pages.
     */
    @GetMapping(value = "/canvas-detector.js", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> getCanvasDetectorScript(HttpServletRequest request) {
        try {
            log.info("Serving Canvas SEB detector JavaScript");

            // Read the JavaScript file from resources
            ClassPathResource resource = new ClassPathResource("static/js/canvas-seb-detector.js");
            String script = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

            script = script.replace("${SEB_BASE_URL}", getRequestBaseUrl(request));
            script = script.replace("${SEB_API_KEY}", "");

            log.info("Canvas SEB detector script loaded, length: {} characters", script.length());

            return ResponseEntity.ok()
                    .header("Content-Type", "application/javascript")
                    .header("Cache-Control", "no-cache, no-store, must-revalidate") // Don't cache for security
                    .header("Pragma", "no-cache")
                    .header("Expires", "0")
                    .body(script);

        } catch (Exception e) {
            log.error("Error loading Canvas SEB detector script", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("// Error loading SEB detector script: " + e.getMessage());
        }
    }

    private SebSettingView resolveSetting(String courseId, String quizId) {
        ContentSebSetting contentSetting = resolveNewQuizSetting(courseId, quizId);
        if (contentSetting != null) {
            return new SebSettingView(
                    contentSetting.getCourseId(),
                    contentSetting.isSebRequired(),
                    contentSetting.isEnabled(),
                    contentSetting.getAccessCode(),
                    contentSetting.getConfigKey());
        }

        QuizSebSetting setting = quizService.getSebSettingForQuiz(quizId);
        if (setting == null) {
            return null;
        }

        if (setting.getCourseId() != null && !courseId.equals(setting.getCourseId())) {
            return null;
        }

        return new SebSettingView(
                setting.getCourseId(),
                setting.isSebRequired(),
                setting.isEnabled(),
                setting.getAccessCode(),
                setting.getConfigKey());
    }

    private String getRequestBaseUrl(HttpServletRequest request) {
        String forwardedProto = firstHeaderValue(request.getHeader("X-Forwarded-Proto"), null);
        String scheme = forwardedProto != null ? forwardedProto : request.getScheme();
        String host = firstHeaderValue(request.getHeader("X-Forwarded-Host"), request.getServerName());
        String forwardedPort = firstHeaderValue(request.getHeader("X-Forwarded-Port"), null);
        int fallbackPort = forwardedProto != null ? defaultPortForScheme(scheme, request.getServerPort()) : request.getServerPort();
        int port = parsePort(forwardedPort, fallbackPort);

        StringBuilder baseUrl = new StringBuilder()
                .append(scheme)
                .append("://")
                .append(host);

        if (!hostIncludesPort(host) && !isDefaultPort(scheme, port)) {
            baseUrl.append(":").append(port);
        }

        if (request.getContextPath() != null && !request.getContextPath().isBlank()) {
            baseUrl.append(request.getContextPath());
        }

        return baseUrl.toString();
    }

    private String firstHeaderValue(String headerValue, String fallback) {
        if (headerValue == null || headerValue.isBlank()) {
            return fallback;
        }
        String first = headerValue.split(",", 2)[0].trim();
        return first.isBlank() ? fallback : first;
    }

    private int parsePort(String portValue, int fallback) {
        if (portValue == null || portValue.isBlank()) {
            return fallback;
        }
        try {
            return Integer.parseInt(portValue);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private boolean hostIncludesPort(String host) {
        return host != null && host.matches(".*:\\d+$");
    }

    private boolean isDefaultPort(String scheme, int port) {
        return ("https".equalsIgnoreCase(scheme) && port == 443)
                || ("http".equalsIgnoreCase(scheme) && port == 80);
    }

    private int defaultPortForScheme(String scheme, int fallback) {
        if ("https".equalsIgnoreCase(scheme)) {
            return 443;
        }
        if ("http".equalsIgnoreCase(scheme)) {
            return 80;
        }
        return fallback;
    }

    public record ConfigKeyProofRequest(String configKeyHash, String url) {
    }

    private record SebSettingView(String courseId,
                                  boolean sebRequired,
                                  boolean enabled,
                                  String accessCode,
                                  String configKey) {
        boolean enabledForAccess() {
            return sebRequired && enabled && accessCode != null && !accessCode.isBlank();
        }
    }
}
