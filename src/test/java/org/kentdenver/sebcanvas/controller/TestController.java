package org.kentdenver.sebcanvas.controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.ArrayList;
import java.util.HashMap;

@Controller
@RequestMapping("/test")
public class TestController {

    @GetMapping("/teacher-view")
    public String testTeacherView(Model model) {
        // Populate model with test data
        model.addAttribute("quizzes", new ArrayList<>());
        model.addAttribute("quizSebRequirements", new HashMap<>());
        return "teacherView";
    }

    @GetMapping("/student-view")
    public String testStudentView(Model model) {
        model.addAttribute("quizUrl", "https://example.com/quiz/123");
        return "studentView";
    }

    @GetMapping("/seb-required")
    public String testSebRequired(Model model) {
        model.addAttribute("quizId", "test-quiz-123");
        return "sebRequired";
    }

    @GetMapping("/health")
    public String healthCheck() {
        return "Application is running!";
    }
}
