package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.ui.Model;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class QuizControllerTest {

    @Mock
    private QuizService quizService;

    @Mock
    private Model model;

    @InjectMocks
    private QuizController quizController;

    private MockHttpSession session;
    private LtiLaunchData ltiLaunchData;
    private List<Quiz> mockQuizzes;
    private static final String COURSE_ID = "12345";

    @BeforeEach
    void setUp() {
        session = new MockHttpSession();

        // Setup LTI launch data for instructor
        ltiLaunchData = new LtiLaunchData();
        ltiLaunchData.setUserId("instructor1");
        ltiLaunchData.setCourseId(COURSE_ID);
        ltiLaunchData.setRoles(Arrays.asList("http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"));

        session.setAttribute("launchData", ltiLaunchData);

        // Setup mock quizzes
        Quiz quiz1 = new Quiz();
        quiz1.setId("1");
        quiz1.setTitle("Quiz 1");
        quiz1.setDescription("Description 1");
        quiz1.setCourseId(COURSE_ID);

        Quiz quiz2 = new Quiz();
        quiz2.setId("2");
        quiz2.setTitle("Quiz 2");
        quiz2.setDescription("Description 2");
        quiz2.setCourseId(COURSE_ID);

        mockQuizzes = Arrays.asList(quiz1, quiz2);
    }

    @Test
    void testUpdateSebRequirement() {
        // Mock data
        String quizId = "1";
        Map<String, Boolean> requestBody = new HashMap<>();
        requestBody.put("required", true);

        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId(quizId);
        setting.setSebRequired(true);

        // Mock service
        when(quizService.updateSebRequirement(quizId, true)).thenReturn(setting);

        // Call the method
        ResponseEntity<QuizSebSetting> response = quizController.updateSebRequirement(quizId, requestBody, session);

        // Verify
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(setting, response.getBody());
        verify(quizService).updateSebRequirement(quizId, true);
    }

    @Test
    void testGetQuizzes() {
        // Mock service
        when(quizService.getQuizzesForCourse(COURSE_ID)).thenReturn(mockQuizzes);

        // Call the method
        ResponseEntity<List<Quiz>> response = quizController.getQuizzes(session);

        // Verify
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(mockQuizzes, response.getBody());
        verify(quizService).getQuizzesForCourse(COURSE_ID);
    }

    @Test
    void testViewQuizzes() {
        // Mock service
        when(quizService.getQuizzesForCourse(COURSE_ID)).thenReturn(mockQuizzes);

        // Create mock data for quiz settings
        Map<String, QuizSebSetting> quizSebSettings = new HashMap<>();
        QuizSebSetting setting1 = new QuizSebSetting();
        setting1.setQuizId("1");
        setting1.setSebRequired(true);
        quizSebSettings.put("1", setting1);

        when(quizService.getSebSettingForQuiz(anyString())).thenReturn(setting1);

        // Call the method
        String viewName = quizController.viewQuizzes(model, session);

        // Verify
        assertEquals("quizzes", viewName);
        verify(model).addAttribute(eq("quizzes"), eq(mockQuizzes));
        verify(model).addAttribute(eq("launchData"), eq(ltiLaunchData));
    }

    @Test
    void testGetQuiz() {
        // Mock data
        String quizId = "1";
        Quiz quiz = mockQuizzes.get(0);

        // Mock service
        when(quizService.getQuiz(quizId)).thenReturn(quiz);

        // Call the method
        ResponseEntity<Quiz> response = quizController.getQuiz(quizId, session);

        // Verify
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(quiz, response.getBody());
        verify(quizService).getQuiz(quizId);
    }

    @Test
    void testGetQuiz_notFound() {
        // Mock data
        String quizId = "999";

        // Mock service to return null
        when(quizService.getQuiz(quizId)).thenReturn(null);

        // Call the method
        ResponseEntity<Quiz> response = quizController.getQuiz(quizId, session);

        // Verify
        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        assertNull(response.getBody());
    }

    @Test
    void testGetQuizzes_unauthorized() {
        // Set no LTI launch data in session
        session = new MockHttpSession();

        // Call the method
        ResponseEntity<List<Quiz>> response = quizController.getQuizzes(session);

        // Verify
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertNull(response.getBody());
        verify(quizService, never()).getQuizzesForCourse(anyString());
    }
}