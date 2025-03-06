package org.kentdenver.sebcanvas.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import javax.persistence.*;
import java.time.LocalDateTime;

@Entity
@Data
@NoArgsConstructor
public class Quiz {
    @Id
    private String id;

    private String title;
    private String description;
    private String courseId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // Canvas-specific fields
    private String canvasQuizId;
    private String htmlUrl;
}