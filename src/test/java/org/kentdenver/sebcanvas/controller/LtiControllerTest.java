package org.kentdenver.sebcanvas.controller;

import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.ui.Model;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class LtiControllerTest {

    @Mock
    private LtiService ltiService;

    @Mock
    private Model model;

    @InjectMocks
    private LtiController ltiController;

    private MockHttpSession session;
    private final String ISS = "https://canvas.instructure.com";
    private final String LOGIN_HINT = "login_hint";
    private final String TARGET_LINK_URI = "https://app.example.com/launch";
    private final String CLIENT_ID = "client_123";
    private final String MESSAGE_HINT = "message_hint";
    private final String ID_TOKEN = "id_token_123";
    private final String STATE = "state_123";

    @BeforeEach
    void setUp() {
        session = new MockHttpSession();
    }

    @Test
    void testHandleLogin() {
        String result = ltiController.handleLogin(
                ISS, LOGIN_HINT, TARGET_LINK_URI, CLIENT_ID, MESSAGE_HINT, session);

        assertEquals("redirect:/lti/auth", result);
        assertEquals(ISS, session.getAttribute("iss"));
        assertEquals(LOGIN_HINT, session.getAttribute("login_hint"));
        assertEquals(TARGET_LINK_URI, session.getAttribute("target_link_uri"));
        assertEquals(CLIENT_ID, session.getAttribute("client_id"));
        assertEquals(MESSAGE_HINT, session.getAttribute("lti_message_hint"));
    }

    @Test
    void testHandleAuth() {
        // Setup session data
        session.setAttribute("iss", ISS);
        session.setAttribute("login_hint", LOGIN_HINT);
        session.setAttribute("client_id", CLIENT_ID);
        session.setAttribute("target_link_uri", TARGET_LINK_URI);
        session.setAttribute("lti_message_hint", MESSAGE_HINT);

        String result = ltiController.handleAuth(session);

        // Verify it constructs the proper redirect URL
        assertTrue(result.startsWith("redirect:https://sso.canvaslms.com/api/lti/authorize_redirect"));
        assertTrue(result.contains("client_id=" + CLIENT_ID));
        assertTrue(result.contains("login_hint=" + LOGIN_HINT));
        assertTrue(result.contains("lti_message_hint=" + MESSAGE_HINT));

        // Verify a state was set in the session
        assertNotNull(session.getAttribute("state"));
    }

    @Test
    void testHandleLaunch_instructor() throws Exception {
        // Setup mock data
        LtiLaunchData mockLaunchData = new LtiLaunchData();
        mockLaunchData.setUserId("user123");
        mockLaunchData.setCourseId("course123");
        mockLaunchData.setRoles(Collections.singletonList(
                "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"));

        // Setup session
        session.setAttribute("state", STATE);

        // Configure mock
        when(ltiService.validateToken(anyString())).thenReturn(mockLaunchData);

        // Call the method
        String result = ltiController.handleLaunch(ID_TOKEN, STATE, session, model);

        // Verify
        verify(ltiService).validateToken(ID_TOKEN);
        assertEquals("redirect:/teacher/dashboard?courseId=course123", result);
        assertEquals(mockLaunchData, session.getAttribute("ltiLaunchData"));
    }

    @Test
    void testHandleLaunch_student() throws Exception {
        // Setup mock data
        LtiLaunchData mockLaunchData = new LtiLaunchData();
        mockLaunchData.setUserId("user123");
        mockLaunchData.setCourseId("course123");
        mockLaunchData.setResourceLinkId("resource123");
        mockLaunchData.setRoles(Collections.singletonList(
                "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"));

        // Setup session
        session.setAttribute("state", STATE);

        // Configure mock
        when(ltiService.validateToken(anyString())).thenReturn(mockLaunchData);

        // Call the method
        String result = ltiController.handleLaunch(ID_TOKEN, STATE, session, model);

        // Verify
        verify(ltiService).validateToken(ID_TOKEN);
        assertEquals("redirect:/student/quiz?courseId=course123&resourceId=resource123", result);
        assertEquals(mockLaunchData, session.getAttribute("ltiLaunchData"));
    }

    @Test
    void testHandleLaunch_invalidState() throws Exception {
        // Setup session with different state
        session.setAttribute("state", "different_state");

        // Call the method
        String result = ltiController.handleLaunch(ID_TOKEN, STATE, session, model);

        // Verify
        verify(ltiService, never()).validateToken(anyString());
        assertEquals("error", result);
    }
}