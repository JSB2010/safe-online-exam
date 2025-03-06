package org.kentdenver.sebcanvas.service;

import org.kentdenver.sebcanvas.model.Quiz;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class CanvasServiceTest {

    @Mock
    private RestTemplate restTemplate;

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private CanvasService canvasService;

    private static final String COURSE_ID = "12345";
    private static final String ACCESS_TOKEN = "test_token";

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(canvasService, "canvasBaseUrl", "https://canvas.example.com/api/v1");
    }

    @Test
    void testGetQuizzesForCourse() throws Exception {
        // Prepare mock response
        String mockJsonResponse = "[{\"id\":\"1\",\"title\":\"Quiz 1\",\"description\":\"Description 1\",\"html_url\":\"https://canvas.example.com/courses/12345/quizzes/1\"}," +
                "{\"id\":\"2\",\"title\":\"Quiz 2\",\"description\":\"Description 2\",\"html_url\":\"https://canvas.example.com/courses/12345/quizzes/2\"}]";

        ResponseEntity<String> mockResponse = new ResponseEntity<>(mockJsonResponse, HttpStatus.OK);

        // Mock RestTemplate exchange call
        when(restTemplate.exchange(
                anyString(),
                eq(HttpMethod.GET),
                any(HttpEntity.class),
                eq(String.class)
        )).thenReturn(mockResponse);

        // Create mock data for ObjectMapper to return
        List<Map<String, Object>> mockQuizData = new ArrayList<>();

        Map<String, Object> quiz1 = new HashMap<>();
        quiz1.put("id", "1");
        quiz1.put("title", "Quiz 1");
        quiz1.put("description", "Description 1");
        quiz1.put("html_url", "https://canvas.example.com/courses/12345/quizzes/1");

        Map<String, Object> quiz2 = new HashMap<>();
        quiz2.put("id", "2");
        quiz2.put("title", "Quiz 2");
        quiz2.put("description", "Description 2");
        quiz2.put("html_url", "https://canvas.example.com/courses/12345/quizzes/2");

        mockQuizData.add(quiz1);
        mockQuizData.add(quiz2);

        // Mock ObjectMapper readValue with TypeReference to avoid ambiguity
        when(objectMapper.readValue(eq(mockJsonResponse), any(TypeReference.class))).thenReturn(mockQuizData);

        // Execute the method
        List<Quiz> quizzes = canvasService.getQuizzesForCourse(COURSE_ID, ACCESS_TOKEN);

        // Verify results
        assertNotNull(quizzes);
        assertEquals(2, quizzes.size());

        Quiz quiz1Result = quizzes.get(0);
        assertEquals("1", quiz1Result.getId());
        assertEquals("Quiz 1", quiz1Result.getTitle());
        assertEquals("Description 1", quiz1Result.getDescription());
        assertEquals(COURSE_ID, quiz1Result.getCourseId());

        Quiz quiz2Result = quizzes.get(1);
        assertEquals("2", quiz2Result.getId());
        assertEquals("Quiz 2", quiz2Result.getTitle());
        assertEquals("Description 2", quiz2Result.getDescription());
        assertEquals(COURSE_ID, quiz2Result.getCourseId());
    }
}