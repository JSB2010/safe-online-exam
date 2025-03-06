package org.kentdenver.sebcanvas.repository;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.*;
import com.google.cloud.Timestamp;
import org.kentdenver.sebcanvas.model.Quiz;
import org.springframework.stereotype.Repository;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;

/**
 * Repository for accessing Quiz documents in Firestore.
 * This replaces the JPA-based QuizRepository with Firestore operations.
 */
@Repository
@Slf4j
public class FirestoreQuizRepository {

    private final Firestore firestore;
    private final CollectionReference quizzesCollection;

    /**
     * Constructor that initializes the collection reference.
     *
     * @param firestore The Firestore instance injected by Spring
     */
    @Autowired
    public FirestoreQuizRepository(Firestore firestore) {
        this.firestore = firestore;
        this.quizzesCollection = firestore.collection("quizzes");
    }

    /**
     * Finds a quiz by its ID.
     *
     * @param id The quiz ID
     * @return Optional containing the quiz if found, empty otherwise
     */
    public Optional<Quiz> findById(String id) {
        try {
            DocumentReference docRef = quizzesCollection.document(id);
            ApiFuture<DocumentSnapshot> future = docRef.get();
            DocumentSnapshot document = future.get();

            if (document.exists()) {
                Quiz quiz = document.toObject(Quiz.class);
                return Optional.ofNullable(quiz);
            } else {
                return Optional.empty();
            }
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error finding quiz by ID: {}", id, e);
            throw new RuntimeException("Error finding quiz", e);
        }
    }

    /**
     * Finds all quizzes for a specific course.
     *
     * @param courseId The Canvas course ID
     * @return List of quizzes in the course
     */
    public List<Quiz> findByCourseId(String courseId) {
        try {
            Query query = quizzesCollection.whereEqualTo("courseId", courseId);
            ApiFuture<QuerySnapshot> future = query.get();
            QuerySnapshot snapshot = future.get();

            List<Quiz> quizzes = new ArrayList<>();
            for (DocumentSnapshot document : snapshot.getDocuments()) {
                Quiz quiz = document.toObject(Quiz.class);
                if (quiz != null) {
                    quizzes.add(quiz);
                }
            }

            return quizzes;
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error finding quizzes for course: {}", courseId, e);
            throw new RuntimeException("Error finding quizzes", e);
        }
    }

    /**
     * Saves a quiz to Firestore.
     * If the quiz has no ID, a new document is created.
     * If it has an ID, the existing document is updated.
     *
     * @param quiz The quiz to save
     * @return The saved quiz with ID updated if it was new
     */
    public Quiz save(Quiz quiz) {
        try {
            // Set timestamps if not already set
            Timestamp now = Timestamp.now();
            if (quiz.getCreatedAt() == null) {
                quiz.setCreatedAt(now);
            }
            quiz.setUpdatedAt(now);

            // Handle new or existing quiz
            if (quiz.getId() == null || quiz.getId().isEmpty()) {
                // New quiz - generate ID
                ApiFuture<DocumentReference> future = quizzesCollection.add(quiz);
                DocumentReference docRef = future.get();
                quiz.setId(docRef.getId());
            } else {
                // Existing quiz - update by ID
                ApiFuture<WriteResult> future = quizzesCollection.document(quiz.getId()).set(quiz);
                future.get(); // Wait for write to complete
            }

            return quiz;
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error saving quiz: {}", quiz.getTitle(), e);
            throw new RuntimeException("Error saving quiz", e);
        }
    }

    /**
     * Saves multiple quizzes in a batch operation.
     *
     * @param quizzes The list of quizzes to save
     * @return The list of saved quizzes
     */
    public List<Quiz> saveAll(List<Quiz> quizzes) {
        try {
            // For small batches, use a single batched write
            WriteBatch batch = firestore.batch();
            Timestamp now = Timestamp.now();

            List<Quiz> newQuizzes = new ArrayList<>();
            for (Quiz quiz : quizzes) {
                // Set timestamps if not already set
                if (quiz.getCreatedAt() == null) {
                    quiz.setCreatedAt(now);
                }
                quiz.setUpdatedAt(now);

                if (quiz.getId() == null || quiz.getId().isEmpty()) {
                    // For new quizzes, we need to create a reference first
                    DocumentReference newDocRef = quizzesCollection.document();
                    quiz.setId(newDocRef.getId());
                    batch.set(newDocRef, quiz);
                    newQuizzes.add(quiz);
                } else {
                    // For existing quizzes, update by ID
                    DocumentReference docRef = quizzesCollection.document(quiz.getId());
                    batch.set(docRef, quiz);
                    newQuizzes.add(quiz);
                }
            }

            // Commit the batch
            ApiFuture<List<WriteResult>> future = batch.commit();
            future.get(); // Wait for all writes to complete

            return newQuizzes;
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error saving multiple quizzes", e);
            throw new RuntimeException("Error saving quizzes batch", e);
        }
    }

    /**
     * Deletes a quiz by its ID.
     *
     * @param id The quiz ID to delete
     */
    public void deleteById(String id) {
        try {
            ApiFuture<WriteResult> future = quizzesCollection.document(id).delete();
            future.get(); // Wait for deletion to complete
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error deleting quiz: {}", id, e);
            throw new RuntimeException("Error deleting quiz", e);
        }
    }

    /**
     * Checks if a quiz exists by its ID.
     *
     * @param id The quiz ID to check
     * @return true if the quiz exists, false otherwise
     */
    public boolean existsById(String id) {
        try {
            DocumentReference docRef = quizzesCollection.document(id);
            ApiFuture<DocumentSnapshot> future = docRef.get();
            DocumentSnapshot document = future.get();
            return document.exists();
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error checking if quiz exists: {}", id, e);
            throw new RuntimeException("Error checking quiz existence", e);
        }
    }

    /**
     * Retrieves all quizzes.
     * Note: This should be used with caution as it will retrieve all documents.
     *
     * @return List of all quizzes
     */
    public List<Quiz> findAll() {
        try {
            ApiFuture<QuerySnapshot> future = quizzesCollection.get();
            QuerySnapshot snapshot = future.get();

            return snapshot.getDocuments().stream()
                    .map(doc -> doc.toObject(Quiz.class))
                    .collect(Collectors.toList());
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error retrieving all quizzes", e);
            throw new RuntimeException("Error retrieving all quizzes", e);
        }
    }
}