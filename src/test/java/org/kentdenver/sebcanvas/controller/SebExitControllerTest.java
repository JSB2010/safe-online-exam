package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.QuizService;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.ui.ConcurrentModel;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SebExitControllerTest {

    @Test
    void exitPageProvidesAbsoluteDedicatedQuitLinkForSebInterception() {
        QuizService quizService = mock(QuizService.class);
        QuizSebSetting setting = new QuizSebSetting();
        setting.setSebRequired(true);
        when(quizService.getSebSettingForQuiz("23455")).thenReturn(setting);
        CanvasApiConfig canvasApiConfig = mock(CanvasApiConfig.class);

        SebExitController controller = new SebExitController(quizService, canvasApiConfig);
        ConcurrentModel model = new ConcurrentModel();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/seb/exit/11825/classicquiz_23455");
        request.setScheme("https");
        request.setServerName("canvas-seb-dev-184075650720.us-central1.run.app");
        request.setServerPort(443);

        String view = controller.showExitPage("11825", "classicquiz_23455", "7288", null, model, request);

        assertEquals("sebExit", view);
        assertEquals(
                "https://canvas-seb-dev-184075650720.us-central1.run.app/seb/exit/quit/11825/23455",
                model.getAttribute("quitUrl")
        );
        assertEquals(
                "https://canvas-seb-dev-184075650720.us-central1.run.app/seb/exit/11825/classicquiz_23455",
                model.getAttribute("exitPageUrl")
        );
    }

    @Test
    void exitPageUsesApplicationBaseUrlInsteadOfForwardedInternalPort() {
        QuizService quizService = mock(QuizService.class);
        CanvasApiConfig canvasApiConfig = mock(CanvasApiConfig.class);
        when(canvasApiConfig.getApplicationBaseUrl()).thenReturn("https://canvas-seb-dev-184075650720.us-central1.run.app");

        SebExitController controller = new SebExitController(quizService, canvasApiConfig);
        ConcurrentModel model = new ConcurrentModel();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/seb/exit/11825/classicquiz_23455");
        request.setScheme("https");
        request.setServerName("canvas-seb-dev-184075650720.us-central1.run.app");
        request.setServerPort(80);

        String view = controller.showExitPage("11825", "classicquiz_23455", "7288", null, model, request);

        assertEquals("sebExit", view);
        assertEquals(
                "https://canvas-seb-dev-184075650720.us-central1.run.app/seb/exit/quit/11825/23455",
                model.getAttribute("quitUrl")
        );
    }
}
