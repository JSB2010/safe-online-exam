package org.kentdenver.sebcanvas.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import javax.persistence.*;

@Entity
@Data
@NoArgsConstructor
public class QuizSebSetting {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true)
    private String quizId;

    private boolean sebRequired;
    private String browserExamKey;
    private String configKey;

    // Reference to stored SEB config file if using a custom configuration
    private String sebConfigFileId;
}