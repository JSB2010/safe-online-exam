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
     * Format: matches content item ID (e.g., "classicquiz_12345", "assignment_67890")
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
     * Assignment-backed identifier used for New Quizzes.
     */
    private String assignmentId;

    /**
     * The type of content this applies to.
     */
    private ContentItem.ContentType contentType;

    /**
     * The Canvas course ID.
     */
    private String courseId;

    /**
     * Canvas HTML URL for the content.
     */
    private String htmlUrl;

    /**
     * Original Canvas launch URL for New Quizzes when available.
     */
    private String canvasLaunchUrl;

    /**
     * Canvas resource-link identifier for New Quizzes when discoverable.
     */
    private String resourceLinkUuid;

    /**
     * Canvas lookup identifier for New Quizzes when discoverable.
     */
    private String lookupUuid;

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
        setting.setId(ContentItem.classicQuizContentId(quizSetting.getQuizId()));
        setting.setContentId(ContentItem.classicQuizContentId(quizSetting.getQuizId()));
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
        setting.setQuitPassword(quizSetting.getQuitPassword());
        return setting;
    }

    public static ContentSebSetting fromContentItem(ContentItem contentItem) {
        ContentSebSetting setting = new ContentSebSetting();
        setting.setId(contentItem.getId());
        setting.setContentId(contentItem.getId());
        setting.setCanvasId(contentItem.getCanvasId());
        setting.setAssignmentId(contentItem.getAssignmentId());
        setting.setContentType(contentItem.getContentType());
        setting.setCourseId(contentItem.getCourseId());
        setting.setHtmlUrl(contentItem.getHtmlUrl());
        setting.setCanvasLaunchUrl(contentItem.getCanvasLaunchUrl());
        setting.setResourceLinkUuid(contentItem.getResourceLinkUuid());
        setting.setLookupUuid(contentItem.getLookupUuid());
        setting.setMetadata(contentItem.getMetadata());
        return setting;
    }

    /**
     * For backward compatibility with QuizSebSetting APIs.
     */
    public String getQuizId() {
        if (contentType == ContentItem.ContentType.CLASSIC_QUIZ) {
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
        return contentType == ContentItem.ContentType.CLASSIC_QUIZ
                || contentType == ContentItem.ContentType.NEW_QUIZ;
    }
}
