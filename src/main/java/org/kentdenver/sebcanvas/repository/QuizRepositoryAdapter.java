package org.kentdenver.sebcanvas.repository.impl;

import lombok.RequiredArgsConstructor;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.repository.FirestoreQuizRepository;
import org.kentdenver.sebcanvas.repository.QuizRepository;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Implementation of QuizRepository that delegates to FirestoreQuizRepository.
 * This adapter allows services to continue using the original repository interface
 * while the actual data access is performed by Firestore.
 */
@Component
@Primary
@RequiredArgsConstructor
public class QuizRepositoryAdapter implements QuizRepository {

    private final FirestoreQuizRepository firestoreRepository;

    /**
     * Finds all quizzes for a specific course.
     *
     * @param courseId The Canvas course ID
     * @return List of quizzes in the course
     */
    @Override
    public List<Quiz> findByCourseId(String courseId) {
        return firestoreRepository.findByCourseId(courseId);
    }
}
