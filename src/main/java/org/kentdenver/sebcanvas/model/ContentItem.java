package org.kentdenver.sebcanvas.model;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.annotation.DocumentId;
import com.google.cloud.firestore.annotation.ServerTimestamp;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Content model retained for module-item and launch compatibility during the
 * classic-quiz-only cleanup phase.
 */
@Data
@NoArgsConstructor
public class ContentItem {

    /**
     * Unique identifier for the content item.
     * In Firestore, this will be the document ID.
     * Format: {contentType}_{canvasId} (e.g., "classicquiz_12345", "assignment_67890")
     */
    @DocumentId
    private String id;

    /**
     * The Canvas course ID this content belongs to.
     */
    private String courseId;

    /**
     * The Canvas ID for this content (quiz ID, assignment ID, etc.)
     */
    private String canvasId;

    /**
     * Assignment-backed identifier used for New Quizzes.
     */
    private String assignmentId;

    /**
     * The type of content this represents.
     */
    private ContentType contentType;

    /**
     * The title of the content as shown in Canvas.
     */
    private String title;

    /**
     * The description of the content from Canvas.
     */
    private String description;

    /**
     * The full URL to the content in Canvas.
     * For quizzes: https://canvas.com/courses/123/quizzes/456
     * For assignments: https://canvas.com/courses/123/assignments/789
     */
    private String htmlUrl;

    /**
     * The Canvas API URL for this content.
     * Used for API operations.
     */
    private String apiUrl;

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
     * Points value for this content (if applicable).
     */
    private Double pointsPossible;

    /**
     * Due date for this content (if applicable).
     */
    private Timestamp dueAt;

    /**
     * Submission types allowed (for assignments).
     * e.g., ["online_text_entry", "online_upload"]
     */
    private String[] submissionTypes;

    /**
     * For external tool integrations, the LTI assignment ID.
     */
    private String ltiAssignmentId;

    /**
     * For External Tools, the tool URL.
     */
    private String externalToolUrl;

    /**
     * Additional metadata specific to the content type.
     * Stored as JSON for flexibility.
     */
    private String metadata;

    /**
     * When this content was created in our system.
     */
    @ServerTimestamp
    private Timestamp createdAt;

    /**
     * When this content was last updated in our system.
     */
    @ServerTimestamp
    private Timestamp updatedAt;

    /**
     * Whether this content is currently published in Canvas.
     */
    private Boolean published;

    /**
     * Enum representing different types of Canvas content.
     */
    public enum ContentType {
        CLASSIC_QUIZ("Classic Quiz"),
        NEW_QUIZ("New Quiz"),
        ASSIGNMENT("Assignment"),
        DISCUSSION("Discussion"),
        EXTERNAL_TOOL("External Tool"),
        PAGE("Page");

        private final String displayName;

        ContentType(String displayName) {
            this.displayName = displayName;
        }

        public String getDisplayName() {
            return displayName;
        }

        /**
         * Determines content type from Canvas API response.
         */
        public static ContentType fromCanvasType(String canvasType) {
            if (canvasType == null) return ASSIGNMENT;

            switch (canvasType.toLowerCase()) {
                case "quiz":
                case "classic_quiz":
                    return CLASSIC_QUIZ;
                case "new_quiz":
                    return NEW_QUIZ;
                case "assignment":
                    return ASSIGNMENT;
                case "discussion_topic":
                case "discussion":
                    return DISCUSSION;
                case "external_tool":
                    return EXTERNAL_TOOL;
                case "page":
                case "wiki_page":
                    return PAGE;
                default:
                    return ASSIGNMENT; // Default to assignment
            }
        }
    }

    /**
     * Factory method to create ContentItem from Canvas Quiz.
     */
    public static ContentItem fromQuiz(Quiz quiz) {
        ContentItem item = new ContentItem();
        item.setId(classicQuizContentId(quiz.getCanvasQuizId()));
        item.setCourseId(quiz.getCourseId());
        item.setCanvasId(quiz.getCanvasQuizId());
        item.setContentType(ContentType.CLASSIC_QUIZ);
        item.setTitle(quiz.getTitle());
        item.setDescription(quiz.getDescription());
        item.setHtmlUrl(quiz.getHtmlUrl());
        item.setPublished(true);
        return item;
    }

    /**
     * Checks if this content type supports SEB enforcement.
     */
    public boolean supportsSebEnforcement() {
        return contentType == ContentType.CLASSIC_QUIZ || contentType == ContentType.NEW_QUIZ;
    }

    public static String classicQuizContentId(String quizId) {
        return "classicquiz_" + quizId;
    }

    public static String newQuizContentId(String courseId, String assignmentId) {
        return "newquiz:" + courseId + ":" + assignmentId;
    }

    /**
     * Gets a user-friendly display name for this content.
     */
    public String getDisplayName() {
        return String.format("%s: %s", contentType.getDisplayName(), title);
    }

    /**
     * Gets the unique identifier used in Canvas URLs.
     * For backward compatibility with Quiz model.
     */
    public String getCanvasQuizId() {
        if (contentType == ContentType.CLASSIC_QUIZ) {
            return canvasId;
        }
        return null;
    }
}
