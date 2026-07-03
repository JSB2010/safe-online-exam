package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StaticJsControllerTest {

    @Test
    void getCanvasDetectorScriptInjectsBaseUrlWithoutSecretsAndDisablesCaching() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("https://app.example.com"));
        assertTrue(response.getBody().contains("/seb/config/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}.seb"));
        assertFalse(response.getBody().contains("/seb/launch/${encodeURIComponent(quizId)}"));
        assertFalse(response.getBody().contains("${SEB_BASE_URL}"));
        assertFalse(response.getBody().contains("${SEB_API_KEY}"));
        assertEquals("no-cache, no-store, must-revalidate", response.getHeaders().getCacheControl());
        assertEquals("0", response.getHeaders().getFirst("Expires"));
    }

    @Test
    void getCanvasDetectorScriptUsesForwardedHttpsBaseUrlBehindProxy() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
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

    @Test
    void getCanvasDetectorScriptRefreshesSebSecurityKeysBeforeCreatingProof() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("SafeExamBrowser.security.updateKeys"));
        assertTrue(response.getBody().contains("const configKeyHash = await getSebConfigKeyHash()"));
    }

    @Test
    void getCanvasDetectorScriptDoesNotForceDebugPanelOnDevDomain() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
        request.setScheme("https");
        request.setServerName("canvas-seb-dev-184075650720.us-central1.run.app");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("function isSebDebugOverrideEnabled()"));
        assertTrue(response.getBody().contains("seb_debug=1"));
        assertFalse(response.getBody().contains("SEB_DOWNLOAD_BASE_URL.includes('canvas-seb-dev')"));
    }

    @Test
    void getCanvasDetectorScriptDoesNotRenderSebDebugOverlay() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertFalse(response.getBody().contains("seb-debug-panel"));
        assertFalse(response.getBody().contains("SEB Debug Panel"));
        assertFalse(response.getBody().contains("TEST EXIT"));
        assertFalse(response.getBody().contains("testSebRedirect"));
        assertFalse(response.getBody().contains("forceRedirect"));
    }

    @Test
    void getCanvasDetectorScriptDoesNotForceExitFromGenericSubmitClicks() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertFalse(response.getBody().contains("Executing redirect to SEB exit page from button click"));
        assertFalse(response.getBody().contains("FALLBACK: Forcing redirect after timeout"));
        assertFalse(response.getBody().contains("clickedText.includes('submit')"));
        assertFalse(response.getBody().contains("targetText.includes('submit') || targetText.includes('finish') || targetText.includes('complete')"));
    }

    @Test
    void getCanvasDetectorScriptIgnoresAccessCodeFormsForCompletionRedirects() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("function isAccessCodeForm(form)"));
        assertTrue(response.getBody().contains("Ignoring access code form submission"));
    }

    @Test
    void getCanvasDetectorScriptDoesNotRejectFinalSubmitBecauseQuizFormHasNavigationButtons() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertFalse(response.getBody().contains("nonFinalSignals.some(signal => combined.includes(signal))"));
        assertTrue(response.getBody().contains("nonFinalSignals.some(signal => buttonSummary.includes(signal))"));
        assertTrue(response.getBody().contains("strongFinalSignals.some(signal => buttonSummary.includes(signal))"));
    }

    @Test
    void getCanvasDetectorScriptMarksVerifiedFinalSubmitClicksWithoutForcedGenericExit() {
        StaticJsController controller = new StaticJsController();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/js/canvas-seb-detector.js");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        var response = controller.getCanvasDetectorScript(request);

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("function handlePotentialFinalSubmitClick(event)"));
        assertTrue(response.getBody().contains("Verified final quiz submit click detected"));
        assertFalse(response.getBody().contains("Executing redirect to SEB exit page from button click"));
        assertFalse(response.getBody().contains("FALLBACK: Forcing redirect after timeout"));
    }
}
