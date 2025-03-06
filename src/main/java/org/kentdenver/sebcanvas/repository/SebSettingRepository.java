package org.kentdenver.sebcanvas.repository;

import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for accessing QuizSebSetting entities in the database.
 * Provides methods to find and manage SEB settings for quizzes.
 *
 * @deprecated This JPA repository is no longer used. Use {@link FirestoreSebSettingRepository} instead
 * as the application has been migrated to use Firestore.
 */
@Deprecated
@Repository
public interface SebSettingRepository {

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

    /**
     * Saves a SEB setting entity.
     *
     * @param setting The setting to save
     * @return The saved setting
     */
    QuizSebSetting save(QuizSebSetting setting);
}
