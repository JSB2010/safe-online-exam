package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebAccessProofService;
import org.kentdenver.sebcanvas.service.SebConfigKeyService;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SebApiControllerTest {

    @Mock private QuizService quizService;
    @Mock private ContentService contentService;
    @Mock private SebConfigKeyService sebConfigKeyService;
    @Mock private SebAccessProofService sebAccessProofService;

    private SebApiController controller;

    @BeforeEach
    void setUp() {
        controller = new SebApiController(quizService, contentService, sebConfigKeyService, sebAccessProofService);
    }

    @Test
    void getAccessCodeAcceptsConfigKeyProofTokenWithoutLaunchSession() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-SEB-Proof-Token", "proof-1");
        when(sebAccessProofService.consumeProof("proof-1", "course-1", "quiz-1"))
                .thenReturn(true);

        QuizSebSetting setting = new QuizSebSetting();
        setting.setCourseId("course-1");
        setting.setSebRequired(true);
        setting.setEnabled(true);
        setting.setAccessCode("secret-code");
        when(quizService.getSebSettingForQuiz("quiz-1")).thenReturn(setting);

        var response = controller.getAccessCode("course-1", "quiz-1", request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("success"));
        assertEquals("secret-code", response.getBody().get("accessCode"));
    }

    @Test
    void getAccessCodeRejectsCourseMismatch() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-SEB-Proof-Token", "proof-1");
        when(sebAccessProofService.consumeProof("proof-1", "course-1", "quiz-1"))
                .thenReturn(true);

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
        request.addHeader("X-SEB-Proof-Token", "proof-1");
        when(sebAccessProofService.consumeProof("proof-1", "course-7", "newquiz:course-7:99"))
                .thenReturn(true);

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
    void createAccessProofValidatesConfigKeyAndMintsTokenWithoutLaunchSession() {
        MockHttpServletRequest request = new MockHttpServletRequest();

        QuizSebSetting setting = new QuizSebSetting();
        setting.setCourseId("course-1");
        setting.setSebRequired(true);
        setting.setEnabled(true);
        setting.setAccessCode("secret-code");
        setting.setConfigKey("stored-config-key");
        when(quizService.getSebSettingForQuiz("quiz-1")).thenReturn(setting);
        when(sebConfigKeyService.validateConfigKeyHashForUrl("hash", "https://canvas.example.com/courses/1/quizzes/1", "stored-config-key"))
                .thenReturn(true);
        when(sebAccessProofService.mintProof("course-1", "quiz-1"))
                .thenReturn("proof-token");
        when(sebAccessProofService.getTokenTtlSeconds()).thenReturn(120L);

        var response = controller.createAccessProof(
                "course-1",
                "quiz-1",
                new SebApiController.ConfigKeyProofRequest("hash", "https://canvas.example.com/courses/1/quizzes/1"),
                request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("success"));
        assertEquals("proof-token", response.getBody().get("proofToken"));
    }

    @Test
    void getCanvasDetectorScriptInjectsBaseUrlWithoutApiKey() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/seb/canvas-detector.js");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("https://app.example.com"));
        assertFalse(response.getBody().contains("${SEB_API_KEY}"));
    }

    @Test
    void getCanvasDetectorScriptUsesForwardedHttpsBaseUrlBehindProxy() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/seb/canvas-detector.js");
        request.setScheme("http");
        request.setServerName("canvas-seb-dev-184075650720.us-central1.run.app");
        request.setServerPort(8080);
        request.addHeader("X-Forwarded-Proto", "https");
        request.addHeader("X-Forwarded-Host", "canvas-seb-dev-184075650720.us-central1.run.app");

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("https://canvas-seb-dev-184075650720.us-central1.run.app"));
        assertFalse(response.getBody().contains("https://canvas-seb-dev-184075650720.us-central1.run.app:80"));
        assertFalse(response.getBody().contains("http://canvas-seb-dev-184075650720.us-central1.run.app"));
    }
}
