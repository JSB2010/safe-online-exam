package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.ui.Model;
import org.springframework.web.server.ResponseStatusException;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class SebControllerTest {

    @Mock
    private SebService sebService;

    @Mock
    private QuizService quizService;

    @Mock
    private SebDetector sebDetector;

    @Mock
    private Model model;

    @InjectMocks
    private SebController sebController;

    private MockHttpSession session;
    private MockHttpServletRequest request;
    private LtiLaunchData ltiLaunchData;
    private static final String QUIZ_ID = "67890";

    @BeforeEach
    void setUp() {
        session = new MockHttpSession();
        request = new MockHttpServletRequest();

        // Setup LTI launch data for student
        ltiLaunchData = new LtiLaunchData();
        ltiLaunchData.setUserId("student1");
        ltiLaunchData.setCourseId("12345");
        ltiLaunchData.setRoles(Arrays.asList("http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"));

        session.setAttribute("launchData", ltiLaunchData);
    }

    @Test
    void testIsSebBrowser() {
        // Mock detection
        when(sebDetector.isSebBrowser(any())).thenReturn(true);

        // Call the method
        ResponseEntity<Boolean> response = sebController.isSebBrowser(request);

        // Verify
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertTrue(response.getBody());
    }

    @Test
    void testValidateBrowserExamKey_valid() {
        // Setup SEB required for quiz
        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId(QUIZ_ID);
        setting.setSebRequired(true);
        setting.setBrowserExamKey("test_key");

        when(quizService.getSebSettingForQuiz(QUIZ_ID)).thenReturn(setting);
        when(sebDetector.validateBrowserExamKey(any(), anyString())).thenReturn(true);

        // Call the method
        ResponseEntity<Boolean> response = sebController.validateBrowserExamKey(QUIZ_ID, request);

        // Verify
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertTrue(response.getBody());
    }

    @Test
    void testValidateBrowserExamKey_notRequired() {
        // Setup SEB not required for quiz
        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId(QUIZ_ID);
        setting.setSebRequired(false);

        when(quizService.getSebSettingForQuiz(QUIZ_ID)).thenReturn(setting);

        // Call the method
        ResponseEntity<Boolean> response = sebController.validateBrowserExamKey(QUIZ_ID, request);

        // Verify
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertTrue(response.getBody());
        verify(sebDetector, never()).validateBrowserExamKey(any(), anyString());
    }

    @Test
    void testGetSebConfig() throws Exception {
        // Setup mock data
        LtiLaunchData mockLaunchData = new LtiLaunchData();
        session.setAttribute("launchData", mockLaunchData);

        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId(QUIZ_ID);
        setting.setSebRequired(true);

        byte[] mockConfig = "test config data".getBytes();

        // Configure mocks
        when(quizService.getSebSettingForQuiz(QUIZ_ID)).thenReturn(setting);
        when(quizService.getQuizUrl(QUIZ_ID)).thenReturn("https://example.com/quiz");
        when(sebService.generateSebConfig(eq(QUIZ_ID), anyString())).thenReturn(mockConfig);

        // Call the method
        ResponseEntity<byte[]> response = sebController.getSebConfig(QUIZ_ID, session);

        // Verify
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertArrayEquals(mockConfig, response.getBody());
        assertTrue(response.getHeaders().getContentDisposition().toString().contains("quiz_" + QUIZ_ID + ".seb"));
    }

    @Test
    void testSebRequiredPage_alreadyUsingSeb() {
        // Setup mock
        when(sebDetector.isSebBrowser(any())).thenReturn(true);
        when(quizService.getQuizUrl(QUIZ_ID)).thenReturn("https://example.com/quiz");

        // Call the method
        String result = sebController.sebRequiredPage(QUIZ_ID, model, request);

        // Verify redirect to Canvas quiz
        assertEquals("redirect:https://example.com/quiz", result);
        verify(model).addAttribute("quizUrl", "https://example.com/quiz");
    }

    @Test
    void testSebRequiredPage_notUsingSeb() {
        // Setup mock
        when(sebDetector.isSebBrowser(any())).thenReturn(false);

        // Call the method
        String result = sebController.sebRequiredPage(QUIZ_ID, model, request);

        // Verify
        assertEquals("sebRequired", result);
        verify(model).addAttribute("quizId", QUIZ_ID);
    }
}