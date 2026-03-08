package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.OAuthToken;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.repository.FirestoreOAuthTokenRepository;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CanvasApiServiceTest {

    @Mock
    private RestTemplate restTemplate;
    @Mock
    private CanvasApiConfig canvasApiConfig;
    @Mock
    private OAuth2AuthorizedClientService clientService;
    @Mock
    private FirestoreOAuthTokenRepository tokenRepository;

    @InjectMocks
    private CanvasApiService canvasApiService;

    @Test
    void getQuizzesForCourseReturnsOnlyClassicQuizResults() {
        when(canvasApiConfig.getApiBaseUrl()).thenReturn("https://canvas.example.com/api/v1");
        when(tokenRepository.findByUserId("user-1"))
                .thenReturn(Optional.of(new OAuthToken("user-1", "token-123", "scope")));
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), any(HttpEntity.class), eq(String.class)))
                .thenReturn(new ResponseEntity<>(
                        "[{\"id\":42,\"title\":\"Classic Quiz\",\"description\":\"Desc\",\"html_url\":\"https://canvas.example.com/quizzes/42\"}]",
                        HttpStatus.OK));

        canvasApiService = new CanvasApiService(
                restTemplate,
                new ObjectMapper(),
                canvasApiConfig,
                clientService,
                tokenRepository
        );

        List<Quiz> quizzes = canvasApiService.getQuizzesForCourse("course-7", "user-1");

        assertEquals(1, quizzes.size());
        assertEquals("Classic Quiz", quizzes.get(0).getTitle());
        assertEquals("classic", quizzes.get(0).getQuizEngine());
        assertEquals("Classic Quiz", quizzes.get(0).getQuizTypeDisplay());

        ArgumentCaptor<String> urlCaptor = ArgumentCaptor.forClass(String.class);
        verify(restTemplate).exchange(urlCaptor.capture(), eq(HttpMethod.GET), any(HttpEntity.class), eq(String.class));
        assertTrue(urlCaptor.getValue().contains("/courses/course-7/quizzes"));
        assertTrue(!urlCaptor.getValue().contains("/api/quiz/v1/"));
    }

    @Test
    void setNewQuizAccessCodeUsesQuizV1PatchPayload() {
        when(canvasApiConfig.getApiBaseUrl()).thenReturn("https://canvas.example.com/api/v1");
        when(tokenRepository.findByUserId("user-1"))
                .thenReturn(Optional.of(new OAuthToken("user-1", "token-123", "scope")));
        when(restTemplate.exchange(anyString(), eq(HttpMethod.PATCH), any(HttpEntity.class), eq(String.class)))
                .thenReturn(new ResponseEntity<>("{}", HttpStatus.OK));

        canvasApiService = new CanvasApiService(
                restTemplate,
                new ObjectMapper(),
                canvasApiConfig,
                clientService,
                tokenRepository
        );

        boolean updated = canvasApiService.setNewQuizAccessCode("course-7", "99", "CODE123", "user-1");

        assertTrue(updated);

        ArgumentCaptor<String> urlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<HttpEntity> entityCaptor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(urlCaptor.capture(), eq(HttpMethod.PATCH), entityCaptor.capture(), eq(String.class));

        assertEquals("https://canvas.example.com/api/quiz/v1/courses/course-7/quizzes/99", urlCaptor.getValue());
        assertEquals(MediaType.APPLICATION_FORM_URLENCODED, entityCaptor.getValue().getHeaders().getContentType());

        @SuppressWarnings("unchecked")
        MultiValueMap<String, String> body = (MultiValueMap<String, String>) entityCaptor.getValue().getBody();
        assertNotNull(body);
        assertEquals("true", body.getFirst("quiz[quiz_settings][require_student_access_code]"));
        assertEquals("CODE123", body.getFirst("quiz[quiz_settings][student_access_code]"));
    }

    @Test
    void removeNewQuizAccessCodeUsesQuizV1PatchPayload() {
        when(canvasApiConfig.getApiBaseUrl()).thenReturn("https://canvas.example.com/api/v1");
        when(tokenRepository.findByUserId("user-1"))
                .thenReturn(Optional.of(new OAuthToken("user-1", "token-123", "scope")));
        when(restTemplate.exchange(anyString(), eq(HttpMethod.PATCH), any(HttpEntity.class), eq(String.class)))
                .thenReturn(new ResponseEntity<>("{}", HttpStatus.OK));

        canvasApiService = new CanvasApiService(
                restTemplate,
                new ObjectMapper(),
                canvasApiConfig,
                clientService,
                tokenRepository
        );

        boolean updated = canvasApiService.removeNewQuizAccessCode("course-7", "99", "user-1");

        assertTrue(updated);

        ArgumentCaptor<HttpEntity> entityCaptor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(eq("https://canvas.example.com/api/quiz/v1/courses/course-7/quizzes/99"),
                eq(HttpMethod.PATCH), entityCaptor.capture(), eq(String.class));

        @SuppressWarnings("unchecked")
        MultiValueMap<String, String> body = (MultiValueMap<String, String>) entityCaptor.getValue().getBody();
        assertNotNull(body);
        assertEquals("false", body.getFirst("quiz[quiz_settings][require_student_access_code]"));
        assertEquals("", body.getFirst("quiz[quiz_settings][student_access_code]"));
    }

    @Test
    void getNewQuizDetailsUsesQuizV1Endpoint() {
        when(canvasApiConfig.getApiBaseUrl()).thenReturn("https://canvas.example.com/api/v1");
        when(tokenRepository.findByUserId("user-1"))
                .thenReturn(Optional.of(new OAuthToken("user-1", "token-123", "scope")));
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), any(HttpEntity.class), eq(String.class)))
                .thenReturn(new ResponseEntity<>("{\"assignment_id\":99,\"title\":\"Checkpoint Quiz\"}", HttpStatus.OK));

        canvasApiService = new CanvasApiService(
                restTemplate,
                new ObjectMapper(),
                canvasApiConfig,
                clientService,
                tokenRepository
        );

        assertEquals("99", canvasApiService.getNewQuizDetails("course-7", "99", "user-1").get("assignment_id").asText());

        verify(restTemplate).exchange(eq("https://canvas.example.com/api/quiz/v1/courses/course-7/quizzes/99"),
                eq(HttpMethod.GET), any(HttpEntity.class), eq(String.class));
    }
}