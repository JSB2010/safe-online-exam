package org.kentdenver.sebcanvas.model;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.annotation.DocumentId;
import com.google.cloud.firestore.annotation.ServerTimestamp;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents the Safe Exam Browser settings for a specific Canvas quiz.
 * This class has been migrated from JPA to Firestore.
 * - @DocumentId replaces JPA's @Id
 * - Timestamp replaces LocalDateTime for Firestore compatibility
 * - @ServerTimestamp provides automatic server-side timestamps
 */
@Data
@NoArgsConstructor
public class QuizSebSetting {

    /**
     * Unique identifier for the SEB setting.
     * In Firestore, this will be the document ID.
     */
    @DocumentId
    private String id;

    /**
     * The Canvas quiz ID that this setting applies to.
     * This is used to link the setting to a specific quiz.
     */
    private String quizId;

    /**
     * Flag to indicate whether SEB is required for this quiz.
     * When true, students must use SEB to access the quiz.
     */
    private boolean sebRequired;

    /**
     * The Browser Exam Key used for SEB validation.
     * This key is included in SEB configurations and validated during access.
     */
    private String browserExamKey;

    /**
     * Additional configuration key for SEB if needed.
     * This can be used for more complex SEB configurations.
     */
    private String configKey;

    /**
     * When this setting was created in our system.
     * Using Firestore's server timestamp for consistency.
     */
    @ServerTimestamp
    private Timestamp createdAt;

    /**
     * When this setting was last updated in our system.
     * Using Firestore's server timestamp for consistency.
     */
    @ServerTimestamp
    private Timestamp updatedAt;

    /**
     * Checks if SEB is required for this quiz.
     *
     * @return true if SEB is required, false otherwise
     */
    public boolean isSebRequired() {
        return sebRequired;
    }
}