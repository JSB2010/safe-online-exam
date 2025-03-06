package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.Quiz;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
@RequiredArgsConstructor
public class CanvasService {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Value("${canvas.api.baseUrl}")
    private String canvasBaseUrl;

    /**
     * Get quizzes for a specific course
     */
    public List<Quiz> getQuizzesForCourse(String courseId, String accessToken) {
        String url = canvasBaseUrl + "/courses/" + courseId + "/quizzes";

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + accessToken);

        HttpEntity<String> entity = new HttpEntity<>(headers);

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            if (response.getStatusCode() == HttpStatus.OK) {
                List<Map<String, Object>> quizData = objectMapper.readValue(
                        response.getBody(),
                        new TypeReference<List<Map<String, Object>>>() {}
                );

                List<Quiz> quizzes = new ArrayList<>();
                for (Map<String, Object> data : quizData) {
                    Quiz quiz = new Quiz();
                    quiz.setId(data.get("id").toString());
                    quiz.setTitle((String) data.get("title"));
                    quiz.setDescription((String) data.get("description"));
                    quiz.setCourseId(courseId);
                    quiz.setCanvasQuizId(data.get("id").toString());
                    quiz.setHtmlUrl((String) data.get("html_url"));
                    quizzes.add(quiz);
                }

                return quizzes;
            } else {
                log.error("Failed to get quizzes: {}", response.getStatusCode());
                return new ArrayList<>();
            }
        } catch (RestClientException | JsonProcessingException e) {
            log.error("Error fetching quizzes from Canvas", e);
            return new ArrayList<>();
        }
    }

    /**
     * Get quiz details
     */
    public Quiz getQuizDetails(String courseId, String quizId, String accessToken) {
        String url = canvasBaseUrl + "/courses/" + courseId + "/quizzes/" + quizId;

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + accessToken);

        HttpEntity<String> entity = new HttpEntity<>(headers);

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            if (response.getStatusCode() == HttpStatus.OK) {
                Map<String, Object> quizData = objectMapper.readValue(
                        response.getBody(),
                        new TypeReference<Map<String, Object>>() {}
                );

                Quiz quiz = new Quiz();
                quiz.setId(quizData.get("id").toString());
                quiz.setTitle((String) quizData.get("title"));
                quiz.setDescription((String) quizData.get("description"));
                quiz.setCourseId(courseId);
                quiz.setCanvasQuizId(quizData.get("id").toString());
                quiz.setHtmlUrl((String) quizData.get("html_url"));

                return quiz;
            } else {
                log.error("Failed to get quiz details: {}", response.getStatusCode());
                return null;
            }
        } catch (RestClientException | JsonProcessingException e) {
            log.error("Error fetching quiz details from Canvas", e);
            return null;
        }
    }
}