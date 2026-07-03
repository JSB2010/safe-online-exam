package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebConfigKeyService;
import org.kentdenver.sebcanvas.service.SebConfigurationService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

@ExtendWith(MockitoExtension.class)
class SebEnforcementControllerTest {

    @Mock
    private QuizService quizService;
    @Mock
    private SebConfigurationService sebConfigurationService;
    @Mock
    private ContentService contentService;
    @Mock
    private SebDetector sebDetector;
    @Mock
    private SebConfigKeyService sebConfigKeyService;
    @Mock
    private CanvasApiConfig canvasApiConfig;

    @InjectMocks
    private SebEnforcementController controller;

    @Test
    void downloadSebConfigUsesNativeCanvasUrlForClassicQuizContentId() {
        Quiz quiz = new Quiz();
        quiz.setId("42");
        quiz.setCanvasQuizId("42");
        quiz.setCourseId("course-7");
        quiz.setHtmlUrl("https://canvas.example.com/courses/course-7/quizzes/42");

        QuizSebSetting setting = new QuizSebSetting();
        setting.setQuizId("42");
        setting.setCourseId("course-7");
        setting.setSebRequired(true);
        setting.setAccessCode("CODE123");
        setting.setQuitPassword("classic-exit");

        when(quizService.getQuiz("42")).thenReturn(quiz);
        when(quizService.getSebSettingForQuiz("42")).thenReturn(setting);
        when(canvasApiConfig.getCanvasDomain()).thenReturn("https://canvas.example.com");
        when(sebConfigurationService.generateSebConfiguration(
                "course-7",
                "classicquiz_42",
                "https://canvas.example.com/courses/course-7/quizzes/42",
                "CODE123",
                List.of(),
                "classic-exit"))
                .thenReturn(new byte[]{1, 2, 3});
        when(sebConfigKeyService.computeConfigKey(any())).thenReturn("config-key");

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/seb/config/course-7/classicquiz_42.seb");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        ResponseEntity<byte[]> response = controller.downloadSebConfig(
                "course-7",
                "classicquiz_42",
                null,
                null,
                request);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertArrayEquals(new byte[]{1, 2, 3}, response.getBody());
        verify(sebConfigurationService).generateSebConfiguration(
                "course-7",
                "classicquiz_42",
                "https://canvas.example.com/courses/course-7/quizzes/42",
                "CODE123",
                List.of(),
                "classic-exit");
        assertEquals("config-key", setting.getConfigKey());
    }

    @Test
    void downloadSebConfigUsesNativeCanvasUrlForNewQuizContentId() {
        ContentSebSetting setting = new ContentSebSetting();
        setting.setContentId("newquiz:course-7:99");
        setting.setSebRequired(true);
        setting.setAccessCode("CODE123");
        setting.setHtmlUrl("https://canvas.example.com/courses/course-7/assignments/99");
        setting.setQuitPassword("newquiz-exit");

        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(setting);
        when(canvasApiConfig.getCanvasDomain()).thenReturn("https://canvas.example.com");
        when(sebConfigurationService.generateSebConfiguration(
                "course-7",
                "newquiz:course-7:99",
                "https://canvas.example.com/courses/course-7/assignments/99",
                "CODE123",
                List.of(),
                "newquiz-exit"))
                .thenReturn(new byte[]{1, 2, 3});
        when(sebConfigKeyService.computeConfigKey(any())).thenReturn("config-key");

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/seb/config/course-7/newquiz:course-7:99.seb");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        ResponseEntity<byte[]> response = controller.downloadSebConfig(
                "course-7",
                "newquiz:course-7:99",
                null,
                null,
                request);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertArrayEquals(new byte[]{1, 2, 3}, response.getBody());
        assertTrue(response.getHeaders().getContentDisposition().getFilename().contains("newquiz_course-7_99"));
        verify(sebConfigurationService).generateSebConfiguration(
                "course-7",
                "newquiz:course-7:99",
                "https://canvas.example.com/courses/course-7/assignments/99",
                "CODE123",
                List.of(),
                "newquiz-exit");
        assertEquals("config-key", setting.getConfigKey());
    }
}
