package org.kentdenver.sebcanvas.controller;

import com.nimbusds.jose.JOSEException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.service.CanvasService;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebService;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.ui.Model;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.view.RedirectView;

import java.text.ParseException;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class LtiControllerTest {

    @Mock
    private LtiService ltiService;

    @Mock
    private LtiConfig ltiConfig;

    @Mock
    private SebDetector sebDetector;

    @Mock
    private CanvasService canvasService;

    @Mock
    private QuizService quizService;

    @Mock
    private SebService sebService;

    @Mock
    private Model model;

    @InjectMocks
    private LtiController ltiController;

    private MockHttpSession session;
    private MockHttpServletRequest request;
    private final String ISS = "https://canvas.instructure.com";
    private final String LOGIN_HINT = "login_hint";
    private final String TARGET_LINK_URI = "https://app.example.com/launch";
    private final String CLIENT_ID = "client_123";
    private final String MESSAGE_HINT = "message_hint";
    private final String DEPLOYMENT_ID = "deployment_123";
    private final String CANVAS_REGION = "us-west-2";
    private final String CANVAS_ENVIRONMENT = "production";
    private final String ID_TOKEN = "id_token_123";
    private final String STATE = "state_123";

    @BeforeEach
    void setUp() {
        session = new MockHttpSession();
        request = new MockHttpServletRequest();

        when(ltiConfig.getIssuer()).thenReturn(ISS);
        when(ltiConfig.getAuthUrl()).thenReturn("https://sso.canvaslms.com/api/lti/authorize_redirect");
        when(ltiConfig.getToolUrl()).thenReturn("https://app.example.com");
    }

    @Test
    void testHandleLogin() {
        // Call the method with all required parameters
        RedirectView result = ltiController.handleLogin(
                ISS, LOGIN_HINT, TARGET_LINK_URI, CLIENT_ID, MESSAGE_HINT,
                DEPLOYMENT_ID, CANVAS_REGION, CANVAS_ENVIRONMENT, session);

        // Verify redirect URL
        assertNotNull(result);
        String redirectUrl = result.getUrl();
        assertTrue(redirectUrl.startsWith("https://sso.canvaslms.com/api/lti/authorize_redirect"));

        // Verify session attributes were set
        assertEquals(LOGIN_HINT, session.getAttribute("login_hint"));
        assertEquals(TARGET_LINK_URI, session.getAttribute("target_link_uri"));
        assertEquals(CLIENT_ID, session.getAttribute("client_id"));
        assertEquals(MESSAGE_HINT, session.getAttribute("lti_message_hint"));
        assertNotNull(session.getAttribute("oidc_state"));
        assertNotNull(session.getAttribute("oidc_nonce"));
    }

    @Test
    void testHandleLaunch_instructor() throws Exception {
        // Setup mock data
        LtiLaunchData mockLaunchData = new LtiLaunchData();
        mockLaunchData.setUserId("user123");
        mockLaunchData.setCourseId("course123");
        mockLaunchData.setRoles(Collections.singletonList(
                "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"));

        // Setup session with state
        session.setAttribute("oidc_state", STATE);

        // Configure mocks
        when(ltiService.validateToken(anyString())).thenReturn(mockLaunchData);
        when(sebDetector.isSebBrowser(any())).thenReturn(false);
        when(quizService.getQuizzesForCourse(anyString())).thenReturn(Collections.emptyList());

        // Call the method with HttpServletRequest
        String result = ltiController.handleLaunch(ID_TOKEN, STATE, session, model, request);

        // Verify
        assertEquals("teacherView", result);
        verify(ltiService).validateToken(ID_TOKEN);
        verify(model).addAttribute(eq("launchData"), eq(mockLaunchData));
        verify(model).addAttribute(eq("isUsingSeb"), eq(false));
        verify(quizService).getQuizzesForCourse("course123");
    }

    @Test
    void testHandleLaunch_student_sebRequired_notUsingSeb() throws Exception {
        // Setup mock data
        LtiLaunchData mockLaunchData = new LtiLaunchData();
        mockLaunchData.setUserId("user123");
        mockLaunchData.setCourseId("course123");
        mockLaunchData.setResourceLinkId("resource123");
        mockLaunchData.setRoles(Collections.singletonList(
                "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"));

        // Setup session with state
        session.setAttribute("oidc_state", STATE);

        // Configure mocks
        when(ltiService.validateToken(anyString())).thenReturn(mockLaunchData);
        when(sebDetector.isSebBrowser(any())).thenReturn(false);
        when(quizService.isSebRequired("resource123")).thenReturn(true);

        // Call the method with HttpServletRequest
        String result = ltiController.handleLaunch(ID_TOKEN, STATE, session, model, request);

        // Verify
        assertEquals("sebRequired", result);
        verify(ltiService).validateToken(ID_TOKEN);
        verify(model).addAttribute(eq("launchData"), eq(mockLaunchData));
        verify(model).addAttribute(eq("isUsingSeb"), eq(false));
        verify(model).addAttribute(eq("sebRequired"), eq(true));
    }

    @Test
    void testHandleLaunch_invalidState() throws ParseException, JOSEException {
        // Setup session with different state
        session.setAttribute("oidc_state", "different_state");

        // Call the method and expect exception
        ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                () -> ltiController.handleLaunch(ID_TOKEN, STATE, session, model, request));

        // Verify - FIXED: Use getStatus() instead of getStatusCode()
        assertEquals(HttpStatus.BAD_REQUEST, exception.getStatus());
        verify(ltiService, never()).validateToken(anyString());
    }

    @Test
    void testHandleLaunch_tokenValidationError() throws Exception {
        // Setup session with state
        session.setAttribute("oidc_state", STATE);

        // Configure mock to throw exception
        when(ltiService.validateToken(anyString())).thenThrow(new ParseException("Invalid token", 0));

        // Call the method
        String result = ltiController.handleLaunch(ID_TOKEN, STATE, session, model, request);

        // Verify
        assertEquals("error", result);
        verify(model).addAttribute(eq("error"), anyString());
    }

    @Test
    void testGetSebConfig() throws Exception {
        // Setup mock data
        LtiLaunchData mockLaunchData = new LtiLaunchData();
        mockLaunchData.setUserId("user123");
        mockLaunchData.setCourseId("course123");
        session.setAttribute("launchData", mockLaunchData);

        String quizId = "quiz123";
        byte[] mockConfig = "test config data".getBytes();

        // Configure mocks
        when(quizService.getQuizUrl(quizId)).thenReturn("https://example.com/quiz");
        when(sebService.generateSebConfig(eq(quizId), anyString())).thenReturn(mockConfig);

        // Call the method
        byte[] result = ltiController.getSebConfig(quizId, session);

        // Verify
        assertNotNull(result);
        assertArrayEquals(mockConfig, result);
    }

    @Test
    void testGetSebConfig_noLaunchData() {
        // No launch data in session
        String quizId = "quiz123";

        // Call the method and expect exception
        ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                () -> ltiController.getSebConfig(quizId, session));

        // Verify - FIXED: Use getStatus() instead of getStatusCode()
        assertEquals(HttpStatus.UNAUTHORIZED, exception.getStatus());
    }

    @Test
    void testHandleError() {
        // Setup mock error
        ResponseStatusException ex = new ResponseStatusException(HttpStatus.BAD_REQUEST, "Test error");

        // Call the method
        String result = ltiController.handleError(ex, model);

        // Verify
        assertEquals("error", result);
        verify(model).addAttribute("error", "Test error");
        verify(model).addAttribute("status", 400);
    }
}