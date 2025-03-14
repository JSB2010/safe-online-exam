package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;

/**
 * Service for managing LTI Deep Linking interactions.
 * Handles creating deep link responses to redirect quizzes through our SEB validation.
 */
@Service
@Slf4j
public class LtiDeepLinkingService {

    private final LtiConfig ltiConfig;
    private final JwkService jwkService;
    private final ObjectMapper objectMapper;

    @Autowired
    public LtiDeepLinkingService(
            LtiConfig ltiConfig,
            JwkService jwkService,
            ObjectMapper objectMapper) {
        this.ltiConfig = ltiConfig;
        this.jwkService = jwkService;
        this.objectMapper = objectMapper;
    }

    /**
     * Creates a Deep Linking response JWT to send back to Canvas.
     * This allows us to define custom content items that will redirect through our app.
     *
     * @param deploymentId The LTI deployment ID from the launch
     * @param deepLinkReturnUrl The Canvas return URL for deep linking response
     * @param quizzes The quizzes to include in the response
     * @param quizSebSettings Map of quiz SEB settings to determine which need redirection
     * @param data Additional data provided in the original deep linking request
     * @return A signed JWT containing the deep linking response
     * @throws JOSEException If signing the JWT fails
     * @throws IOException If serializing JSON content fails
     */
    public String createDeepLinkingResponse(
            String deploymentId,
            String deepLinkReturnUrl,
            List<Quiz> quizzes,
            Map<String, QuizSebSetting> quizSebSettings,
            String data) throws JOSEException, IOException {

        log.debug("Creating Deep Linking response for {} quizzes", quizzes.size());

        // Create the content items list
        List<Map<String, Object>> contentItems = new ArrayList<>();

        for (Quiz quiz : quizzes) {
            // Check if this quiz requires SEB
            QuizSebSetting sebSetting = quizSebSettings.get(quiz.getId());
            boolean requiresSeb = sebSetting != null && sebSetting.isSebRequired();

            Map<String, Object> contentItem = new HashMap<>();
            contentItem.put("type", "ltiResourceLink");
            contentItem.put("title", quiz.getTitle());

            if (requiresSeb) {
                // For SEB-required quizzes, link to our app instead of directly to Canvas
                String redirectUrl = ltiConfig.getSanitizedToolUrl() + "/seb/redirect/" + quiz.getId();
                contentItem.put("url", redirectUrl);

                // Add custom properties to identify this as a SEB-required quiz
                Map<String, String> custom = new HashMap<>();
                custom.put("seb_required", "true");
                custom.put("quiz_id", quiz.getId());
                custom.put("original_url", quiz.getHtmlUrl());
                contentItem.put("custom", custom);

                log.debug("Added SEB-required content item for quiz: {}", quiz.getId());
            } else {
                // For regular quizzes, link directly to Canvas
                contentItem.put("url", quiz.getHtmlUrl());
                log.debug("Added regular content item for quiz: {}", quiz.getId());
            }

            // Add other properties
            contentItem.put("text", quiz.getDescription());

            contentItems.add(contentItem);
        }

        // Create the full message JSON
        Map<String, Object> deepLinkingResponse = new HashMap<>();

        // Standard JWT claims
        deepLinkingResponse.put("iss", ltiConfig.getSanitizedToolUrl());
        deepLinkingResponse.put("aud", ltiConfig.getIssuer());
        deepLinkingResponse.put("exp", System.currentTimeMillis() / 1000 + 600); // 10 minutes expiry
        deepLinkingResponse.put("iat", System.currentTimeMillis() / 1000);
        deepLinkingResponse.put("nonce", UUID.randomUUID().toString());

        // LTI claims
        deepLinkingResponse.put("https://purl.imsglobal.org/spec/lti/claim/message_type",
                "LtiDeepLinkingResponse");
        deepLinkingResponse.put("https://purl.imsglobal.org/spec/lti/claim/version", "1.3.0");
        deepLinkingResponse.put("https://purl.imsglobal.org/spec/lti/claim/deployment_id", deploymentId);

        // Deep linking specific claims
        deepLinkingResponse.put("https://purl.imsglobal.org/spec/lti-dl/claim/content_items", contentItems);

        // Include the original data if provided
        if (data != null && !data.isEmpty()) {
            deepLinkingResponse.put("https://purl.imsglobal.org/spec/lti-dl/claim/data", data);
        }

        // Sign the JWT
        String jwt = jwkService.signDeepLinkingJwt(deepLinkingResponse);

        log.info("Created Deep Linking JWT response with {} content items", contentItems.size());
        return jwt;
    }

    /**
     * Creates an HTML form for automatically submitting the deep linking response back to Canvas.
     *
     * @param deepLinkReturnUrl The Canvas return URL for deep linking response
     * @param jwt The signed JWT response
     * @return HTML form with auto-submit script
     */
    public String createAutoSubmitForm(String deepLinkReturnUrl, String jwt) {
        return "<html>\n" +
                "<head><title>Submitting Deep Linking Response</title></head>\n" +
                "<body onload=\"document.forms[0].submit();\">\n" +
                "  <form action=\"" + deepLinkReturnUrl + "\" method=\"post\">\n" +
                "    <input type=\"hidden\" name=\"JWT\" value=\"" + jwt + "\" />\n" +
                "    <input type=\"submit\" value=\"Submit Response\" />\n" +
                "  </form>\n" +
                "  <p>Submitting response to Canvas...</p>\n" +
                "</body>\n" +
                "</html>";
    }

    /**
     * Creates a content item for redirecting a specific quiz through our SEB validation.
     *
     * @param quiz The quiz to create a content item for
     * @param sebRequired Whether SEB is required for this quiz
     * @return A map representing the LTI content item
     */
    public Map<String, Object> createQuizContentItem(Quiz quiz, boolean sebRequired) {
        Map<String, Object> contentItem = new HashMap<>();
        contentItem.put("type", "ltiResourceLink");
        contentItem.put("title", quiz.getTitle());
        contentItem.put("text", quiz.getDescription());

        if (sebRequired) {
            // Link to our SEB validation endpoint
            String redirectUrl = ltiConfig.getSanitizedToolUrl() + "/seb/redirect/" + quiz.getId();
            contentItem.put("url", redirectUrl);

            // Add custom properties
            Map<String, String> custom = new HashMap<>();
            custom.put("seb_required", "true");
            custom.put("quiz_id", quiz.getId());
            custom.put("original_url", quiz.getHtmlUrl());
            contentItem.put("custom", custom);

            log.debug("Created SEB-required content item for quiz: {}", quiz.getId());
        } else {
            // Link directly to Canvas
            contentItem.put("url", quiz.getHtmlUrl());
            log.debug("Created regular content item for quiz: {}", quiz.getId());
        }

        return contentItem;
    }
}