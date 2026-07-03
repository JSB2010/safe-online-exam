package org.kentdenver.sebcanvas.model;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.annotation.DocumentId;
import com.google.cloud.firestore.annotation.ServerTimestamp;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

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
     * The Canvas course ID that this quiz belongs to.
     * Used for Canvas API operations.
     */
    private String courseId;

    /**
     * Flag to indicate whether SEB is required for this quiz.
     * When true, students must use SEB to access the quiz.
     */
    private boolean sebRequired;

    /**
     * Flag to indicate whether SEB enforcement is currently enabled.
     * This allows temporary disabling without losing configuration.
     */
    private boolean enabled;

    /**
     * The access code set on the Canvas quiz for SEB enforcement.
     * Students must enter this code to access the quiz.
     */
    private String accessCode;

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
     * Optional password required for emergency/manual SEB quit.
     */
    private String quitPassword;

    /**
     * JSON array of additional allowed sites for this quiz.
     * These sites will be included in the SEB URL filter configuration.
     * Example: ["docs.google.com", "calculator.net"]
     * @deprecated Use structured domain fields instead
     */
    @Deprecated
    private String allowedSites;

    /**
     * The external tool URL that Canvas will redirect to.
     * Format: https://our-service.com/quiz/{orgId}/{courseId}/{quizId}
     */
    private String externalToolUrl;

    /**
     * List of SSO domains that students need to access for authentication.
     * Examples: accounts.google.com, login.microsoftonline.com
     */
    private List<String> ssoDomains = new ArrayList<>();

    /**
     * List of educational tool domains that are allowed for the quiz.
     * Examples: www.desmos.com/calculator, www.khanacademy.org
     */
    private List<String> educationalToolDomains = new ArrayList<>();

    /**
     * List of custom domains specified by the teacher.
     * These are additional domains beyond the standard SSO and educational tools.
     */
    private List<String> customDomains = new ArrayList<>();

    /**
     * The Canvas domain for this institution (auto-detected).
     * Examples: kentdenver.instructure.com, myschool.instructure.com
     */
    private String canvasDomain;

    /**
     * Canvas assignment ID for API updates.
     * Used to update the Canvas assignment to use external tool submission type.
     */
    private String canvasAssignmentId;

    /**
     * Deep Linking URL for updating module items.
     * This URL can be used by instructors to update Canvas module items via LTI Deep Linking.
     */
    private String deepLinkUrl;

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
