package org.kentdenver.sebcanvas.repository;

import org.kentdenver.sebcanvas.QuizSebSetting;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface SebSettingRepository extends JpaRepository<QuizSebSetting, Long> {
    Optional<QuizSebSetting> findByQuizId(String quizId);
}