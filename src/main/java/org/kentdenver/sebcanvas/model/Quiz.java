package org.kentdenver.sebcanvas.model;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.annotation.DocumentId;
import com.google.cloud.firestore.annotation.ServerTimestamp;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a Canvas quiz.
 * This class has been migrated from JPA to Firestore.
 * - @DocumentId replaces JPA's @Id
 * - Timestamp replaces LocalDateTime for Firestore compatibility
 * - @ServerTimestamp provides automatic server-side timestamps
 */
@Data
@NoArgsConstructor
public class Quiz {
    /**
     * Unique identifier for the quiz.
     * In Firestore, this will be the document ID.
     */
    @DocumentId
    private String id;

    /**
     * The title of the quiz as shown in Canvas.
     */
    private String title;

    /**
     * The description of the quiz from Canvas.
     */
    private String description;

    /**
     * The Canvas course ID this quiz belongs to.
     * This is used to group quizzes by course.
     */
    private String courseId;

    /**
     * When this quiz was created in our system.
     * Using Firestore's server timestamp for consistency.
     */
    @ServerTimestamp
    private Timestamp createdAt;

    /**
     * When this quiz was last updated in our system.
     * Using Firestore's server timestamp for consistency.
     */
    @ServerTimestamp
    private Timestamp updatedAt;

    /**
     * The original Canvas quiz ID.
     * This may differ from our internal ID.
     */
    private String canvasQuizId;

    /**
     * The full URL to the quiz in Canvas.
     */
    private String htmlUrl;

    /**
     * The quiz engine type (classic or new).
     */
    private String quizEngine;

    /**
     * Display name for the quiz type.
     */
    private String quizTypeDisplay;
}