package org.kentdenver.sebcanvas.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.ui.ExtendedModelMap;
import org.springframework.web.servlet.view.RedirectView;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SebLtiLaunchControllerTest {

    @Mock
    private LtiService ltiService;
    @Mock
    private QuizService quizService;
    @Mock
    private ContentService contentService;
    @Mock
    private SebDetector sebDetector;
    @Mock
    private HttpServletRequest request;

    @Test
    void handleLtiLaunchResolvesClassicQuizPrefixFromCache() {
        Quiz quiz = new Quiz();
        quiz.setId("42");
        quiz.setCanvasQuizId("42");
        quiz.setCourseId("course-7");
        quiz.setTitle("Classic Quiz");
        quiz.setHtmlUrl("https://canvas.example.com/courses/7/quizzes/42");

        when(quizService.getQuiz("42")).thenReturn(quiz);
        when(quizService.getSebSettingForQuiz("42")).thenReturn(null);

        SebLtiLaunchController controller = new SebLtiLaunchController(ltiService, quizService, contentService, sebDetector);
        Object result = controller.handleLtiLaunch(
                "classicquiz_42",
                null,
                request,
                new MockHttpSession(),
                new ExtendedModelMap());

        RedirectView redirectView = assertInstanceOf(RedirectView.class, result);
        assertEquals("https://canvas.example.com/courses/7/quizzes/42", redirectView.getUrl());
        verify(sebDetector, never()).isRequestFromSEB(request, (QuizSebSetting) null);
    }

    @Test
    void handleLtiLaunchRejectsUnknownContentIds() {
        SebLtiLaunchController controller = new SebLtiLaunchController(ltiService, quizService, contentService, sebDetector);
        ExtendedModelMap model = new ExtendedModelMap();

        Object result = controller.handleLtiLaunch(
                "assignment_42",
                null,
                request,
                new MockHttpSession(),
                model);

        assertEquals("error", result);
        assertEquals("Launch content not found", model.get("error"));
    }

    @Test
    void handleLtiLaunchRedirectsNewQuizToCanvasLaunchUrlWhenSebNotRequired() {
        ContentItem content = new ContentItem();
        content.setId("newquiz:course-7:99");
        content.setCourseId("course-7");
        content.setCanvasId("99");
        content.setAssignmentId("99");
        content.setContentType(ContentItem.ContentType.NEW_QUIZ);
        content.setTitle("Checkpoint Quiz");
        content.setHtmlUrl("https://canvas.example.com/courses/7/assignments/99");
        content.setCanvasLaunchUrl("https://canvas.example.com/courses/7/external_tools/sessionless_launch?id=777");

        ContentSebSetting setting = new ContentSebSetting();
        setting.setContentId("newquiz:course-7:99");
        setting.setSebRequired(false);

        when(contentService.getContentItem("newquiz:course-7:99")).thenReturn(content);
        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(setting);

        SebLtiLaunchController controller = new SebLtiLaunchController(ltiService, quizService, contentService, sebDetector);
        Object result = controller.handleLtiLaunch(
                "newquiz:course-7:99",
                null,
                request,
                new MockHttpSession(),
                new ExtendedModelMap());

        RedirectView redirectView = assertInstanceOf(RedirectView.class, result);
        assertEquals("https://canvas.example.com/courses/7/external_tools/sessionless_launch?id=777", redirectView.getUrl());
        verify(sebDetector, never()).isRequestFromSEB(eq(request), any(ContentSebSetting.class));
    }

    @Test
    void handleLtiLaunchShowsDownloadPageForNewQuizWhenSebRequiredAndNotInSeb() {
        ContentItem content = new ContentItem();
        content.setId("newquiz:course-7:99");
        content.setCourseId("course-7");
        content.setCanvasId("99");
        content.setAssignmentId("99");
        content.setContentType(ContentItem.ContentType.NEW_QUIZ);
        content.setTitle("Checkpoint Quiz");
        content.setHtmlUrl("https://canvas.example.com/courses/7/assignments/99");

        ContentSebSetting setting = new ContentSebSetting();
        setting.setContentId("newquiz:course-7:99");
        setting.setSebRequired(true);

        when(contentService.getContentItem("newquiz:course-7:99")).thenReturn(content);
        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(setting);
        when(sebDetector.isRequestFromSEB(eq(request), any(ContentSebSetting.class))).thenReturn(false);

        SebLtiLaunchController controller = new SebLtiLaunchController(ltiService, quizService, contentService, sebDetector);
        ExtendedModelMap model = new ExtendedModelMap();

        Object result = controller.handleLtiLaunch(
                "newquiz:course-7:99",
                null,
                request,
                new MockHttpSession(),
                model);

        assertEquals("sebDownload", result);
        assertEquals("/seb/config/course-7/newquiz:course-7:99.seb", model.get("sebConfigUrl"));
        assertEquals("/seb/config/course-7/newquiz:course-7:99.seb", model.get("configDownloadUrl"));
        assertEquals("Checkpoint Quiz", model.get("contentTitle"));
    }
}