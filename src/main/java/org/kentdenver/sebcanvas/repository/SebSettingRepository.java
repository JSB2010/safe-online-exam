package org.kentdenver.sebcanvas.repository;

import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for accessing QuizSebSetting entities in the database.
 * Provides methods to find and manage SEB settings for quizzes.
 */
@Repository
public interface SebSettingRepository extends JpaRepository<QuizSebSetting, Long> {

    /**
     * Finds a SEB setting for a specific quiz.
     *
     * @param quizId The quiz ID
     * @return An Optional containing the SEB setting, or empty if not found
     */
    Optional<QuizSebSetting> findByQuizId(String quizId);

    /**
     * Finds all SEB settings for a list of quiz IDs.
     * This is used to efficiently retrieve settings for multiple quizzes at once.
     *
     * @param quizIds The list of quiz IDs
     * @return The list of SEB settings found
     */
    List<QuizSebSetting> findAllByQuizIdIn(List<String> quizIds);
}