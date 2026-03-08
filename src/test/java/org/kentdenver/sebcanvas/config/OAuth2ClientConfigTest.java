package org.kentdenver.sebcanvas.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OAuth2ClientConfigTest {

    @Mock
    private CanvasApiConfig canvasApiConfig;

    @Test
    void clientRegistrationRepositoryIncludesNewQuizScopes() {
        when(canvasApiConfig.getClientId()).thenReturn("client-123");
        when(canvasApiConfig.getClientSecret()).thenReturn("secret-123");
        when(canvasApiConfig.getRedirectUri()).thenReturn("https://tool.example.com/oauth2callback");
        when(canvasApiConfig.getCanvasDomain()).thenReturn("https://canvas.example.com");

        OAuth2ClientConfig config = new OAuth2ClientConfig();
        ClientRegistrationRepository repository = config.clientRegistrationRepository(canvasApiConfig);
        ClientRegistration registration = repository.findByRegistrationId("canvas-api");

        assertNotNull(registration);
        assertTrue(registration.getScopes().contains("url:PUT|/api/v1/courses/:course_id/quizzes/:id"));
        assertTrue(registration.getScopes().contains("url:GET|/api/quiz/v1/courses/:course_id/quizzes"));
        assertTrue(registration.getScopes().contains("url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id"));
        assertTrue(registration.getScopes().contains("url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id"));
        assertFalse(registration.getScopes().isEmpty());
    }
}