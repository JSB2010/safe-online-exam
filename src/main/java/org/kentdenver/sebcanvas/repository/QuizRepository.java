package org.kentdenver.sebcanvas.repository;

import org.kentdenver.sebcanvas.model.Quiz;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository interface for accessing Quiz entities.
 *
 * @deprecated This JPA repository is no longer used. Use {@link FirestoreQuizRepository} instead
 * as the application has been migrated to use Firestore.
 */
@Deprecated
@Repository
public interface QuizRepository {
    List<Quiz> findByCourseId(String courseId);
}
