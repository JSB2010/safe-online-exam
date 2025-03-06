package org.kentdenver.sebcanvas.repository;

import org.kentdenver.sebcanvas.model.Quiz;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface QuizRepository extends JpaRepository<Quiz, String> {
    List<Quiz> findByCourseId(String courseId);
}