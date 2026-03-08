package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.ui.ExtendedModelMap;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LtiControllerTest {

    @Mock private LtiService ltiService;
    @Mock private LtiConfig ltiConfig;
    @Mock private CanvasApiConfig canvasApiConfig;
    @Mock private SebDetector sebDetector;
    @Mock private CanvasService canvasService;
    @Mock private QuizService quizService;
    @Mock private SebService sebService;
    @Mock private CanvasApiService canvasApiService;
    @Mock private ContentService contentService;

    @Test
    void handleOAuthRedirectIncludesNewQuizContentAlongsideClassicQuizzes() {
        Quiz classicQuiz = new Quiz();
        classicQuiz.setId("42");
        classicQuiz.setTitle("Classic Quiz");
        classicQuiz.setDescription("Classic description");
        classicQuiz.setHtmlUrl("https://canvas.example.com/courses/7/quizzes/42");

        QuizSebSetting classicSetting = new QuizSebSetting();
        classicSetting.setQuizId("42");
        classicSetting.setSebRequired(true);

        ContentItem newQuiz = new ContentItem();
        newQuiz.setId("newquiz:course-7:99");
        newQuiz.setCourseId("course-7");
        newQuiz.setCanvasId("99");
        newQuiz.setAssignmentId("99");
        newQuiz.setContentType(ContentItem.ContentType.NEW_QUIZ);
        newQuiz.setTitle("Checkpoint Quiz");
        newQuiz.setDescription("New Quiz description");
        newQuiz.setHtmlUrl("https://canvas.example.com/courses/7/assignments/99");

        ContentSebSetting newQuizSetting = new ContentSebSetting();
        newQuizSetting.setContentId("newquiz:course-7:99");
        newQuizSetting.setSebRequired(true);

        when(canvasApiService.hasAccessToken("user-1")).thenReturn(true);
        when(quizService.getQuizzesForCourse("course-7", "user-1")).thenReturn(List.of(classicQuiz));
        when(quizService.getSebSettingForQuiz("42")).thenReturn(classicSetting);
        when(contentService.getAllContentForCourse("course-7", "user-1")).thenReturn(List.of(newQuiz));
        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(newQuizSetting);

        LtiController controller = new LtiController(
                ltiService,
                ltiConfig,
                canvasApiConfig,
                sebDetector,
                canvasService,
                quizService,
                sebService,
                canvasApiService,
                contentService);

        ExtendedModelMap model = new ExtendedModelMap();
        String view = controller.handleOAuthRedirect("course-7", "user-1", model, new MockHttpSession());

        assertEquals("teacherView", view);
        List<?> quizzes = assertInstanceOf(List.class, model.get("quizzes"));
        assertEquals(2, quizzes.size());

        Map<?, ?> classicView = assertInstanceOf(Map.class, quizzes.get(0));
        Map<?, ?> newQuizView = assertInstanceOf(Map.class, quizzes.get(1));
        assertEquals("42", classicView.get("id"));
        assertEquals("newquiz:course-7:99", newQuizView.get("id"));
        assertEquals("New Quiz", newQuizView.get("quizTypeDisplay"));

        Map<?, ?> settings = assertInstanceOf(Map.class, model.get("quizSebSettings"));
        assertEquals(classicSetting, settings.get("42"));
        assertEquals(newQuizSetting, settings.get("newquiz:course-7:99"));
    }
}