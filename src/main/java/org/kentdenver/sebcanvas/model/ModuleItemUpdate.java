package org.kentdenver.sebcanvas.model;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.annotation.DocumentId;
import com.google.cloud.firestore.annotation.ServerTimestamp;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a Canvas module item that has been updated for SEB enforcement.
 * This tracks the original URLs so we can revert them when SEB is disabled.
 */
@Data
@NoArgsConstructor
public class ModuleItemUpdate {

    /**
     * Unique identifier for this update record.
     */
    @DocumentId
    private String id;

    /**
     * The Canvas course ID where this module item exists.
     */
    private String courseId;

    /**
     * The Canvas quiz ID that this module item links to.
     */
    private String quizId;

    /**
     * The Canvas module ID containing this item.
     */
    private String moduleId;

    /**
     * The name of the Canvas module.
     */
    private String moduleName;

    /**
     * The Canvas module item ID.
     */
    private String moduleItemId;

    /**
     * The title/name of the module item.
     */
    private String title;

    /**
     * The original URL before SEB enforcement was enabled.
     * This is used to revert the module item when SEB is disabled.
     */
    private String originalUrl;

    /**
     * The SEB redirect URL that replaced the original URL.
     */
    private String sebUrl;

    /**
     * Whether this module item is currently using the SEB URL.
     */
    private boolean usingSebUrl;

    /**
     * When this update was created.
     */
    @ServerTimestamp
    private Timestamp createdAt;

    /**
     * When this update was last modified.
     */
    @ServerTimestamp
    private Timestamp updatedAt;

    /**
     * Additional metadata about the module item (JSON string).
     */
    private String metadata;

    /**
     * Creates a unique key for this module item update.
     * Used to prevent duplicate updates for the same module item.
     */
    public String getUniqueKey() {
        return String.format("%s_%s_%s", courseId, moduleId, moduleItemId);
    }

    /**
     * Checks if this update is for a specific quiz.
     */
    public boolean isForQuiz(String quizId) {
        return this.quizId != null && this.quizId.equals(quizId);
    }

    /**
     * Gets a human-readable description of this update.
     */
    public String getDescription() {
        return String.format("Module item '%s' in module '%s'", title, moduleName);
    }
}
