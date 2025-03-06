package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.mock.web.MockHttpSession;
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
                        .param("lti_message_hint", "message_hint_123")
                        .param("lti_deployment_id", "deployment_123")
                        .param("canvas_region", "us-west-2")
                        .param("canvas_environment", "production"))
                .andExpect(status().is3xxRedirection())
                .andReturn();

        // Get the session from the result
        MockHttpSession session = (MockHttpSession) loginResult.getRequest().getSession();

        // Step 3: Mock an instructor launching the tool
        // Setup the mock LTI service to return an instructor
        LtiLaunchData instructorData = new LtiLaunchData();
        instructorData.setUserId("instructor_123");
        instructorData.setCourseId("course_123");
        instructorData.setRoles(Collections.singletonList(
                "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"));

        when(ltiService.validateToken(anyString())).thenReturn(instructorData);

        // Set the state in session
        String state = "state_123";
        session.setAttribute("oidc_state", state);

        // Simulate the launch
        mockMvc.perform(post("/lti/launch")
                        .param("id_token", "mocked_token")
                        .param("state", state)
                        .session(session))
                .andExpect(status().isOk())
                .andExpect(view().name("teacherView"));
    }
}