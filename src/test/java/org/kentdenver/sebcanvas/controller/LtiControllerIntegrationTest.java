package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
public class LtiControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private LtiService ltiService;

    @Test
    void testLtiFlow() throws Exception {
        // Step 1: Login request
        MvcResult loginResult = mockMvc.perform(get("/lti/login")
                        .param("iss", "https://canvas.instructure.com")
                        .param("login_hint", "login_hint_123")
                        .param("target_link_uri", "https://app.example.com/target")
                        .param("client_id", "client_123")
                        .param("lti_message_hint", "message_hint_123"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/lti/auth"))
                .andReturn();

        // Get the session ID
        String sessionId = loginResult.getRequest().getSession().getId();

        // Step 2: Auth request should redirect to Canvas
        mockMvc.perform(get("/lti/auth")
                        .sessionAttr("iss", "https://canvas.instructure.com")
                        .sessionAttr("login_hint", "login_hint_123")
                        .sessionAttr("target_link_uri", "https://app.example.com/target")
                        .sessionAttr("client_id", "client_123")
                        .sessionAttr("lti_message_hint", "message_hint_123")
                        .sessionId(sessionId))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrlPattern("https://sso.canvaslms.com/api/lti/authorize_redirect*"));

        // Step 3: Mock an instructor launching the tool
        // Setup the mock LTI service to return an instructor
        LtiLaunchData instructorData = new LtiLaunchData();
        instructorData.setUserId("instructor_123");
        instructorData.setCourseId("course_123");
        instructorData.setRoles(Collections.singletonList(
                "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"));

        when(ltiService.validateToken(anyString())).thenReturn(instructorData);

        // Simulate the launch
        mockMvc.perform(post("/lti/launch")
                        .param("id_token", "mocked_token")
                        .param("state", "state_123")
                        .sessionAttr("state", "state_123")
                        .sessionId(sessionId))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/teacher/dashboard?courseId=course_123"));
    }
}