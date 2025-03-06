package org.kentdenver.sebcanvas.repository.impl;

import lombok.RequiredArgsConstructor;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.FirestoreSebSettingRepository;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * Implementation of SebSettingRepository that delegates to FirestoreSebSettingRepository.
 * This adapter allows services to continue using the original repository interface
 * while the actual data access is performed by Firestore.
 */
@Component
@Primary
@RequiredArgsConstructor
public class SebSettingRepositoryAdapter implements SebSettingRepository {

    private final FirestoreSebSettingRepository firestoreRepository;

    /**
     * Finds a SEB setting for a specific quiz.
     *
     * @param quizId The quiz ID
     * @return An Optional containing the SEB setting, or empty if not found
     */
    @Override
    public Optional<QuizSebSetting> findByQuizId(String quizId) {
        return firestoreRepository.findByQuizId(quizId);
    }

    /**
     * Finds all SEB settings for a list of quiz IDs.
     *
     * @param quizIds The list of quiz IDs
     * @return The list of SEB settings found
     */
    @Override
    public List<QuizSebSetting> findAllByQuizIdIn(List<String> quizIds) {
        return firestoreRepository.findAllByQuizIdIn(quizIds);
    }

    /**
     * Saves a SEB setting entity.
     *
     * @param setting The setting to save
     * @return The saved setting
     */
    @Override
    public QuizSebSetting save(QuizSebSetting setting) {
        return firestoreRepository.save(setting);
    }
}
