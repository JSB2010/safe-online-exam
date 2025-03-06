package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.ui.Model;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class QuizControllerTest {

    @Mock
    private CanvasService canvasService;

    @Mock
    private SebSettingRepository sebSettingRepository;

    @Mock
    private Model model;

    @InjectMocks
    private QuizController quizController;

    private MockHttpSession session;
    private LtiLaunchData ltiLaunchData;
    private List<Quiz> mockQuizzes;
    private static final String COURSE_ID = "12345";
    private static final String ACCESS_TOKEN = "test_token";

    @BeforeEach
    void setUp() {
        session = new MockHttpSession();

        // Setup LTI launch data for instructor
        ltiLaunchData = new LtiLaunchData();
        ltiLaunchData.setUserId("instructor1");
        ltiLaunchData.setCourseId(COURSE_ID);
        ltiLaunchData.setRoles(Arrays.asList("http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"));

        session.setAttribute("ltiLaunchData", ltiLaunchData);

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
    void testDashboard() {
        // Mock Canvas service
        when(canvasService.getQuizzesForCourse(COURSE_ID, ACCESS_TOKEN)).thenReturn(mockQuizzes);

        // Mock SEB setting for quiz 1
        QuizSebSetting setting1 = new QuizSebSetting();
        setting1.setQuizId("1");
        setting1.setSebRequired(true);
        when(sebSettingRepository.findByQuizId("1")).thenReturn(Optional.of(setting1));

        // Mock no SEB setting for quiz 2
        when(sebSettingRepository.findByQuizId("2")).thenReturn(Optional.empty());

        // Call the dashboard method
        String result = quizController.dashboard(COURSE_ID, session, model);

        // Verify
        assertEquals("teacherView", result);
        verify(model).addAttribute("quizzes", mockQuizzes);
        verify(model).addAttribute("courseId", COURSE_ID);
        verify(model).addAttribute("sebSetting_1", setting1);
    }

    @Test
    void testUpdateSebSettings() {
        // Mock existing setting
        QuizSebSetting existingSetting = new QuizSebSetting();
        existingSetting.setQuizId("1");
        existingSetting.setSebRequired(false);

        when(sebSettingRepository.findByQuizId("1")).thenReturn(Optional.of(existingSetting));
        when(sebSettingRepository.save(any(QuizSebSetting.class))).thenAnswer(i -> i.getArguments()[0]);

        // Call the method
        String result = quizController.updateSebSettings("1", true, session);

        // Verify
        assertEquals("Success", result);
        verify(sebSettingRepository).save(any(QuizSebSetting.class));
    }

    @Test
    void testUpdateSebSettings_newSetting() {
        // Mock no existing setting
        when(sebSettingRepository.findByQuizId("1")).thenReturn(Optional.empty());
        when(sebSettingRepository.save(any(QuizSebSetting.class))).thenAnswer(i -> {
            QuizSebSetting saved = (QuizSebSetting) i.getArguments()[0];
            assertEquals("1", saved.getQuizId());
            assertEquals(true, saved.isSebRequired());
            return saved;
        });

        // Call the method
        String result = quizController.updateSebSettings("1", true, session);

        // Verify
        assertEquals("Success", result);
        verify(sebSettingRepository).save(any(QuizSebSetting.class));
    }

    @Test
    void testDashboard_unauthorized() {
        // Set no LTI launch data in session
        session = new MockHttpSession();

        // Call the dashboard method
        String result = quizController.dashboard(COURSE_ID, session, model);

        // Verify
        assertEquals("redirect:/error?message=Unauthorized", result);
        verify(canvasService, never()).getQuizzesForCourse(anyString(), anyString());
    }
}