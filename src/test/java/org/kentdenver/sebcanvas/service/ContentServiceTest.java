package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.repository.FirestoreContentRepository;
import org.kentdenver.sebcanvas.repository.FirestoreContentSebSettingRepository;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.Comparator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ContentServiceTest {

    @Mock
    private CanvasApiService canvasApiService;
    @Mock
    private FirestoreContentRepository contentRepository;
    @Mock
    private FirestoreContentSebSettingRepository contentSebSettingRepository;
    @Mock
    private RestTemplate restTemplate;

    @Test
    void getAllContentForCourseFetchesClassicAndAssignmentBackedNewQuizzes() {
        when(canvasApiService.getAccessToken("user-1")).thenReturn("token-123");
        when(canvasApiService.getCanvasApiBaseUrl()).thenReturn("https://canvas.example.com/api/v1");
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), any(HttpEntity.class), eq(String.class)))
                .thenAnswer(invocation -> {
                    String url = invocation.getArgument(0, String.class);
                    if (url.endsWith("/courses/course-7/quizzes?per_page=100")) {
                        return new ResponseEntity<>(
                                "[{\"id\":42,\"title\":\"Classic Quiz\",\"description\":\"Desc\",\"html_url\":\"https://canvas.example.com/quizzes/42\",\"published\":true}]",
                                HttpStatus.OK);
                    }
                    if (url.endsWith("/courses/course-7/assignments?per_page=100&new_quizzes=true")) {
                        return new ResponseEntity<>(
                                "[{\"id\":99,\"name\":\"Checkpoint Quiz\",\"description\":\"Assignment description\",\"html_url\":\"https://canvas.example.com/courses/7/assignments/99\",\"published\":true,\"points_possible\":15}]",
                                HttpStatus.OK);
                    }
                    if (url.endsWith("/api/quiz/v1/courses/course-7/quizzes/99")) {
                        return new ResponseEntity<>(
                                "{\"id\":501,\"title\":\"Checkpoint Quiz\",\"instructions\":\"New Quiz instructions\",\"assignment_id\":99,\"canvas_launch_url\":\"https://canvas.example.com/courses/7/external_tools/sessionless_launch?id=777\",\"resource_link_uuid\":\"resource-link-1\",\"lookup_uuid\":\"lookup-1\"}",
                                HttpStatus.OK);
                    }
                    throw new AssertionError("Unexpected URL: " + url);
                });

        ContentService contentService = new ContentService(
                canvasApiService,
                contentRepository,
                contentSebSettingRepository,
                restTemplate,
                new ObjectMapper());

        List<ContentItem> contentItems = contentService.getAllContentForCourse("course-7", "user-1");
        contentItems.sort(Comparator.comparing(ContentItem::getId));

        assertEquals(2, contentItems.size());
        assertEquals(ContentItem.ContentType.CLASSIC_QUIZ, contentItems.get(0).getContentType());
        assertEquals("classicquiz_42", contentItems.get(0).getId());
        assertEquals(ContentItem.ContentType.NEW_QUIZ, contentItems.get(1).getContentType());
        assertEquals("newquiz:course-7:99", contentItems.get(1).getId());
        assertEquals("99", contentItems.get(1).getAssignmentId());
        assertEquals("https://canvas.example.com/courses/7/external_tools/sessionless_launch?id=777",
                contentItems.get(1).getCanvasLaunchUrl());

        ArgumentCaptor<String> urlCaptor = ArgumentCaptor.forClass(String.class);
        verify(restTemplate, org.mockito.Mockito.times(3))
                .exchange(urlCaptor.capture(), eq(HttpMethod.GET), any(HttpEntity.class), eq(String.class));
        verify(contentRepository).saveAll(any());
        ArgumentCaptor<List<ContentSebSetting>> settingsCaptor = ArgumentCaptor.forClass(List.class);
        verify(contentSebSettingRepository).saveAll(settingsCaptor.capture());
        assertEquals(1, settingsCaptor.getValue().size());
        assertEquals("newquiz:course-7:99", settingsCaptor.getValue().get(0).getContentId());
        assertFalse(settingsCaptor.getAllValues().isEmpty());
    }

    @Test
    void getAllContentForCourseKeepsNewQuizAssignmentWhenHydrationFails() {
        when(canvasApiService.getAccessToken("user-1")).thenReturn("token-123");
        when(canvasApiService.getCanvasApiBaseUrl()).thenReturn("https://canvas.example.com/api/v1");
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), any(HttpEntity.class), eq(String.class)))
                .thenAnswer(invocation -> {
                    String url = invocation.getArgument(0, String.class);
                    if (url.endsWith("/courses/course-7/quizzes?per_page=100")) {
                        return new ResponseEntity<>("[]", HttpStatus.OK);
                    }
                    if (url.endsWith("/courses/course-7/assignments?per_page=100&new_quizzes=true")) {
                        return new ResponseEntity<>(
                                "[{\"id\":99,\"name\":\"Checkpoint Quiz\",\"description\":\"Assignment description\",\"html_url\":\"https://canvas.example.com/courses/7/assignments/99\",\"published\":false}]",
                                HttpStatus.OK);
                    }
                    if (url.endsWith("/api/quiz/v1/courses/course-7/quizzes/99")) {
                        throw new RuntimeException("new quiz detail lookup failed");
                    }
                    throw new AssertionError("Unexpected URL: " + url);
                });

        ContentService contentService = new ContentService(
                canvasApiService,
                contentRepository,
                contentSebSettingRepository,
                restTemplate,
                new ObjectMapper());

        List<ContentItem> contentItems = contentService.getAllContentForCourse("course-7", "user-1");

        assertEquals(1, contentItems.size());
        ContentItem newQuiz = contentItems.get(0);
        assertEquals(ContentItem.ContentType.NEW_QUIZ, newQuiz.getContentType());
        assertEquals("newquiz:course-7:99", newQuiz.getId());
        assertEquals("Checkpoint Quiz", newQuiz.getTitle());
        assertNull(newQuiz.getCanvasLaunchUrl());
        assertNotNull(newQuiz.getHtmlUrl());

        ArgumentCaptor<List<ContentSebSetting>> settingsCaptor = ArgumentCaptor.forClass(List.class);
        verify(contentSebSettingRepository).saveAll(settingsCaptor.capture());
        assertEquals("99", settingsCaptor.getValue().get(0).getAssignmentId());
    }

    @Test
    void getAllContentForCoursePreservesExistingNewQuizSebSettingsWhenRefreshingMetadata() {
        when(canvasApiService.getAccessToken("user-1")).thenReturn("token-123");
        when(canvasApiService.getCanvasApiBaseUrl()).thenReturn("https://canvas.example.com/api/v1");
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), any(HttpEntity.class), eq(String.class)))
                .thenAnswer(invocation -> {
                    String url = invocation.getArgument(0, String.class);
                    if (url.endsWith("/courses/course-7/quizzes?per_page=100")) {
                        return new ResponseEntity<>("[]", HttpStatus.OK);
                    }
                    if (url.endsWith("/courses/course-7/assignments?per_page=100&new_quizzes=true")) {
                        return new ResponseEntity<>(
                                "[{\"id\":99,\"name\":\"Checkpoint Quiz\",\"description\":\"Assignment description\",\"html_url\":\"https://canvas.example.com/courses/7/assignments/99\",\"published\":true}]",
                                HttpStatus.OK);
                    }
                    if (url.endsWith("/api/quiz/v1/courses/course-7/quizzes/99")) {
                        return new ResponseEntity<>(
                                "{\"id\":501,\"title\":\"Checkpoint Quiz\",\"assignment_id\":99,\"canvas_launch_url\":\"https://canvas.example.com/courses/7/external_tools/sessionless_launch?id=777\"}",
                                HttpStatus.OK);
                    }
                    throw new AssertionError("Unexpected URL: " + url);
                });

        ContentSebSetting existingSetting = new ContentSebSetting();
        existingSetting.setId("newquiz:course-7:99");
        existingSetting.setContentId("newquiz:course-7:99");
        existingSetting.setSebRequired(true);
        existingSetting.setEnabled(true);
        existingSetting.setAccessCode("ACCESS42");
        existingSetting.setBrowserExamKey("browser-key");
        existingSetting.setCustomDomains(List.of("example.com"));
        when(contentSebSettingRepository.findByContentId("newquiz:course-7:99")).thenReturn(existingSetting);

        ContentService contentService = new ContentService(
                canvasApiService,
                contentRepository,
                contentSebSettingRepository,
                restTemplate,
                new ObjectMapper());

        contentService.getAllContentForCourse("course-7", "user-1");

        ArgumentCaptor<List<ContentSebSetting>> settingsCaptor = ArgumentCaptor.forClass(List.class);
        verify(contentSebSettingRepository).saveAll(settingsCaptor.capture());

        ContentSebSetting savedSetting = settingsCaptor.getValue().get(0);
        assertTrue(savedSetting.isSebRequired());
        assertTrue(savedSetting.isEnabled());
        assertEquals("ACCESS42", savedSetting.getAccessCode());
        assertEquals("browser-key", savedSetting.getBrowserExamKey());
        assertEquals(List.of("example.com"), savedSetting.getCustomDomains());
        assertEquals("https://canvas.example.com/courses/7/external_tools/sessionless_launch?id=777", savedSetting.getCanvasLaunchUrl());
        assertEquals("99", savedSetting.getAssignmentId());
    }
}