package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.SebService;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.ui.Model;

import java.util.Arrays;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class SebControllerTest {

    @Mock
    private SebSettingRepository sebSettingRepository;

    @Mock
    private SebService sebService;

    @Mock
    private Model model;

    @InjectMocks
    private SebController sebController;

    private MockHttpSession session;
    private MockHttpServletRequest request;
    private LtiLaunchData ltiLaunchData;
    private static final String COURSE_ID = "12345";
    private static final String QUIZ_ID = "67890";
    private static final String RESOURCE_ID = "resource123";

    @BeforeEach
    void setUp() {
        session = new MockHttpSession();
        request = new MockHttpServletRequest();

        // Setup LTI launch data for student
        ltiLaunchData = new LtiLaunchData();
        ltiLaunchData.setUserId("student1");
        ltiLaunchData.setCourseId(COURSE_ID);
        ltiLaunchData.setRoles(Arrays.asList("http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"));

        session.setAttribute("ltiLaunchData", ltiLaunchData);
    }

    @Test
    void testAccessQuiz_sebRequiredButNotUsingSeb() {
        // Setup SEB required for quiz
        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId(QUIZ_ID);
        setting.setSebRequired(true);

        when(sebSettingRepository.findByQuizId(QUIZ_ID)).thenReturn(Optional.of(setting));
        when(sebService.isUsingSeb(any())).thenReturn(false);

        // Call the method
        String result = sebController.accessQuiz(COURSE_ID, QUIZ_ID, request, session, model);

        // Verify
        assertEquals("sebRequired", result);
        verify(model).addAttribute("quizId", QUIZ_ID);
        verify(model).addAttribute("courseId", COURSE_ID);
    }

    @Test
    void testAccessQuiz_sebRequiredAndUsingSeb() {
        // Setup SEB required for quiz
        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId(QUIZ_ID);
        setting.setSebRequired(true);

        when(sebSettingRepository.findByQuizId(QUIZ_ID)).thenReturn(Optional.of(setting));
        when(sebService.isUsingSeb(any())).thenReturn(true);

        // Call the method
        String result = sebController.accessQuiz(COURSE_ID, QUIZ_ID, request, session, model);

        // Verify redirect to Canvas quiz
        assertTrue(result.startsWith("redirect:"));
        assertTrue(result.contains("/courses/" + COURSE_ID + "/quizzes/" + QUIZ_ID));
    }

    @Test
    void testAccessQuiz_sebNotRequired() {
        // Setup SEB not required for quiz
        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId(QUIZ_ID);
        setting.setSebRequired(false);

        when(sebSettingRepository.findByQuizId(QUIZ_ID)).thenReturn(Optional.of(setting));

        // Call the method
        String result = sebController.accessQuiz(COURSE_ID, QUIZ_ID, request, session, model);

        // Verify direct access without SEB check
        assertTrue(result.startsWith("redirect:"));
        assertTrue(result.contains("/courses/" + COURSE_ID + "/quizzes/" + QUIZ_ID));
        verify(sebService, never()).isUsingSeb(any());
    }

    @Test
    void testAccessQuiz_unauthorized() {
        // No LTI data in session
        session = new MockHttpSession();

        // Call the method
        String result = sebController.accessQuiz(COURSE_ID, QUIZ_ID, request, session, model);

        // Verify
        assertEquals("redirect:/error?message=Unauthorized", result);
    }

    @Test
    void testDownloadSebConfig() throws Exception {
        // Setup mock data
        byte[] mockConfig = "test config data".getBytes();
        when(sebService.generateSebConfig(anyString(), anyString())).thenReturn(mockConfig);

        // Call the method
        ResponseEntity<byte[]> response = sebController.downloadSebConfig(QUIZ_ID, COURSE_ID, RESOURCE_ID, session);

        // Verify
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertArrayEquals(mockConfig, response.getBody());
        assertTrue(response.getHeaders().getContentDisposition().toString().contains("quiz_" + QUIZ_ID + ".seb"));
    }

    @Test
    void testDownloadSebConfig_unauthorized() {
        // No LTI data in session
        session = new MockHttpSession();

        // Call the method
        ResponseEntity<byte[]> response = sebController.downloadSebConfig(QUIZ_ID, COURSE_ID, RESOURCE_ID, session);

        // Verify
        assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
        assertNull(response.getBody());
    }
}