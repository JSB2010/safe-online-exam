package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.ApiSecurityService;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SebApiControllerTest {

    @Mock private QuizService quizService;
    @Mock private ContentService contentService;
    @Mock private ApiSecurityService apiSecurityService;

    private SebApiController controller;

    @BeforeEach
    void setUp() {
        controller = new SebApiController(quizService, contentService, apiSecurityService);
    }

    @Test
    void getAccessCodeRejectsFailedSecurityValidation() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(apiSecurityService.validateSebApiRequest(request))
                .thenReturn(ApiSecurityService.SecurityValidationResult.invalidApiKey());

        var response = controller.getAccessCode("course-1", "quiz-1", request);

        assertEquals(401, response.getStatusCode().value());
        verifyNoInteractions(quizService);
    }

    @Test
    void getAccessCodeRejectsCourseMismatch() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(apiSecurityService.validateSebApiRequest(request))
                .thenReturn(ApiSecurityService.SecurityValidationResult.success());

        QuizSebSetting setting = new QuizSebSetting();
        setting.setCourseId("course-2");
        setting.setSebRequired(true);
        setting.setEnabled(true);
        setting.setAccessCode("secret-code");
        when(quizService.getSebSettingForQuiz("quiz-1")).thenReturn(setting);

        var response = controller.getAccessCode("course-1", "quiz-1", request);

        assertEquals(404, response.getStatusCode().value());
    }

    @Test
    void getAccessCodeSupportsNewQuizContentSettings() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(apiSecurityService.validateSebApiRequest(request))
                .thenReturn(ApiSecurityService.SecurityValidationResult.success());

        ContentSebSetting setting = new ContentSebSetting();
        setting.setCourseId("course-7");
        setting.setContentType(ContentItem.ContentType.NEW_QUIZ);
        setting.setSebRequired(true);
        setting.setEnabled(true);
        setting.setAccessCode("NQCODE42");
        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(setting);

        var response = controller.getAccessCode("course-7", "newquiz:course-7:99", request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("success"));
        assertEquals("NQCODE42", response.getBody().get("accessCode"));
    }

    @Test
    void getCanvasDetectorScriptEmbedsConfiguredApiKey() {
        when(apiSecurityService.getApiKeyForJavaScript()).thenReturn("test-api-key");

        var response = controller.getCanvasDetectorScript();

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("test-api-key"));
    }
}
