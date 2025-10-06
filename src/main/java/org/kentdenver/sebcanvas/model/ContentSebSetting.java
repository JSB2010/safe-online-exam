package org.kentdenver.sebcanvas.model;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.annotation.DocumentId;
import com.google.cloud.firestore.annotation.ServerTimestamp;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Unified SEB settings for any Canvas content type (quizzes, assignments, etc.)
 * Replaces QuizSebSetting for Phase 2 multi-content support.
 *
 * This model supports:
 * - Classic Quizzes
 * - New Quizzes
 * - Assignments
 * - External Tools
 */
@Data
@NoArgsConstructor
public class ContentSebSetting {

    /**
     * Unique identifier for the SEB setting.
     * Format: matches content item ID (e.g., "quiz_12345", "assignment_67890")
     */
    @DocumentId
    private String id;

    /**
     * The content item ID this setting applies to.
     * References ContentItem.id
     */
    private String contentId;

    /**
     * The Canvas ID for the content (quiz ID, assignment ID, etc.)
     */
    private String canvasId;

    /**
     * The type of content this applies to.
     */
    private ContentItem.ContentType contentType;

    /**
     * The Canvas course ID.
     */
    private String courseId;

    /**
     * Flag to indicate whether SEB is required for this content.
     */
    private boolean sebRequired;

    /**
     * Flag to indicate whether SEB enforcement is currently enabled.
     */
    private boolean enabled;

    /**
     * The access code set on the Canvas content for SEB enforcement.
     * For quizzes: Set via Quiz Settings API
     * For assignments: Stored in assignment settings (if supported)
     */
    private String accessCode;

    /**
     * The Browser Exam Key used for SEB validation.
     */
    private String browserExamKey;

    /**
     * Additional configuration key for SEB.
     */
    private String configKey;

    /**
     * The quit password required to exit SEB.
     */
    private String quitPassword;

    /**
     * List of SSO domains for authentication.
     */
    private List<String> ssoDomains = new ArrayList<>();

    /**
     * List of educational tool domains.
     */
    private List<String> educationalToolDomains = new ArrayList<>();

    /**
     * List of custom domains specified by the teacher.
     */
    private List<String> customDomains = new ArrayList<>();

    /**
     * The external tool URL for LTI launch.
     * Format: https://our-app.com/seb/launch/{contentId}
     */
    private String externalToolUrl;

    /**
     * Deep linking URL returned after content item placement.
     */
    private String deepLinkUrl;

    /**
     * When this setting was created.
     */
    @ServerTimestamp
    private Timestamp createdAt;

    /**
     * When this setting was last updated.
     */
    @ServerTimestamp
    private Timestamp updatedAt;

    /**
     * Additional metadata stored as JSON.
     */
    private String metadata;

    /**
     * Factory method to create ContentSebSetting from QuizSebSetting for backward compatibility.
     */
    public static ContentSebSetting fromQuizSebSetting(QuizSebSetting quizSetting) {
        ContentSebSetting setting = new ContentSebSetting();
        setting.setId("classicquiz_" + quizSetting.getQuizId());
        setting.setContentId("classicquiz_" + quizSetting.getQuizId());
        setting.setCanvasId(quizSetting.getQuizId());
        setting.setContentType(ContentItem.ContentType.CLASSIC_QUIZ);
        setting.setCourseId(quizSetting.getCourseId());
        setting.setSebRequired(quizSetting.isSebRequired());
        setting.setEnabled(quizSetting.isEnabled());
        setting.setAccessCode(quizSetting.getAccessCode());
        setting.setBrowserExamKey(quizSetting.getBrowserExamKey());
        setting.setConfigKey(quizSetting.getConfigKey());
        setting.setSsoDomains(quizSetting.getSsoDomains());
        setting.setEducationalToolDomains(quizSetting.getEducationalToolDomains());
        setting.setCustomDomains(quizSetting.getCustomDomains());
        setting.setExternalToolUrl(quizSetting.getExternalToolUrl());
        setting.setDeepLinkUrl(quizSetting.getDeepLinkUrl());
        // Note: quitPassword was removed from QuizSebSetting, not copying
        return setting;
    }

    /**
     * For backward compatibility with QuizSebSetting APIs.
     */
    public String getQuizId() {
        if (contentType == ContentItem.ContentType.CLASSIC_QUIZ ||
            contentType == ContentItem.ContentType.NEW_QUIZ) {
            return canvasId;
        }
        return null;
    }

    /**
     * For backward compatibility with QuizSebSetting APIs.
     */
    public void setQuizId(String quizId) {
        this.canvasId = quizId;
    }

    /**
     * Gets all allowed domains (SSO + educational tools + custom).
     */
    public List<String> getAllAllowedDomains() {
        List<String> all = new ArrayList<>();
        all.addAll(ssoDomains);
        all.addAll(educationalToolDomains);
        all.addAll(customDomains);
        return all;
    }

    /**
     * Checks if this content supports access code enforcement.
     */
    public boolean supportsAccessCode() {
        switch (contentType) {
            case CLASSIC_QUIZ:
            case NEW_QUIZ:
                return true;
            case ASSIGNMENT:
            case EXTERNAL_TOOL:
            default:
                // Assignments don't have native access code support in Canvas
                // but we can still enforce via LTI launch
                return false;
        }
    }
}
