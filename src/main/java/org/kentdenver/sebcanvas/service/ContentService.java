package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.repository.FirestoreContentRepository;
import org.kentdenver.sebcanvas.repository.FirestoreContentSebSettingRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;

/**
 * Classic-quiz content cache used by the launch/module flow during Wave 1 cleanup.
 */
@Service
@Slf4j
public class ContentService {

    private static final String CANVAS_API_SUFFIX = "/api/v1";

    private final CanvasApiService canvasApiService;
    private final FirestoreContentRepository contentRepository;
    private final FirestoreContentSebSettingRepository contentSebSettingRepository;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Autowired
    public ContentService(
            CanvasApiService canvasApiService,
            FirestoreContentRepository contentRepository,
            FirestoreContentSebSettingRepository contentSebSettingRepository,
            RestTemplate restTemplate,
            ObjectMapper objectMapper) {
        this.canvasApiService = canvasApiService;
        this.contentRepository = contentRepository;
        this.contentSebSettingRepository = contentSebSettingRepository;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * Fetches classic quizzes from a Canvas course for launch/cache compatibility.
     *
     * @param courseId The Canvas course ID
     * @param userId The user ID for Canvas API authentication
     * @return List of classic quiz content items
     */
    public List<ContentItem> getAllContentForCourse(String courseId, String userId) {
        log.info("Fetching content for course: {}", courseId);

        try {
            List<ContentItem> allContent = new ArrayList<>();
            List<ContentItem> classicQuizzes = getClassicQuizzes(courseId, userId);
            List<ContentItem> newQuizzes = getNewQuizzes(courseId, userId);

            allContent.addAll(classicQuizzes);
            allContent.addAll(newQuizzes);

            log.info("Found {} classic and {} New Quiz content items for course {}",
                    classicQuizzes.size(), newQuizzes.size(), courseId);

            // Save to Firestore for caching
            contentRepository.saveAll(allContent);
            if (!newQuizzes.isEmpty()) {
                contentSebSettingRepository.saveAll(seedNewQuizSettings(newQuizzes));
            }

            return allContent;

        } catch (Exception e) {
            log.error("Error fetching content for course {}: {}", courseId, e.getMessage(), e);

            // Fallback to cached data from Firestore
            List<ContentItem> cachedContent = contentRepository.findByCourseId(courseId);
            log.warn("Using {} cached content items for course {}", cachedContent.size(), courseId);
            return cachedContent;
        }
    }

    /**
     * Fetches classic quizzes from Canvas.
     */
    private List<ContentItem> getClassicQuizzes(String courseId, String userId) {
        List<ContentItem> quizzes = new ArrayList<>();

        try {
            String accessToken = canvasApiService.getAccessToken(userId);
            if (accessToken == null) {
                log.warn("No access token for user {}, skipping classic quizzes", userId);
                return quizzes;
            }

            String url = String.format("%s/courses/%s/quizzes?per_page=100",
                    canvasApiService.getCanvasApiBaseUrl(), courseId);

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            HttpEntity<?> request = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.GET, request, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                JsonNode quizzesJson = objectMapper.readTree(response.getBody());

                for (JsonNode quizJson : quizzesJson) {
                    ContentItem item = new ContentItem();
                    item.setContentType(ContentItem.ContentType.CLASSIC_QUIZ);
                    item.setCourseId(courseId);
                    item.setCanvasId(quizJson.get("id").asText());
                    item.setId(ContentItem.classicQuizContentId(item.getCanvasId()));
                    item.setTitle(quizJson.get("title").asText());
                    item.setDescription(quizJson.has("description") ?
                            quizJson.get("description").asText() : "");
                    item.setHtmlUrl(quizJson.get("html_url").asText());
                    item.setPointsPossible(quizJson.has("points_possible") ?
                            quizJson.get("points_possible").asDouble() : null);
                    item.setPublished(quizJson.has("published") &&
                            quizJson.get("published").asBoolean());

                    quizzes.add(item);
                }

                log.info("Fetched {} classic quizzes for course {}", quizzes.size(), courseId);
            }

        } catch (Exception e) {
            log.error("Error fetching classic quizzes: {}", e.getMessage(), e);
        }

        return quizzes;
    }

    private List<ContentItem> getNewQuizzes(String courseId, String userId) {
        List<ContentItem> newQuizzes = new ArrayList<>();

        try {
            String accessToken = canvasApiService.getAccessToken(userId);
            if (accessToken == null) {
                log.warn("No access token for user {}, skipping New Quizzes", userId);
                return newQuizzes;
            }

            String url = String.format("%s/courses/%s/assignments?per_page=100&new_quizzes=true",
                    canvasApiService.getCanvasApiBaseUrl(), courseId);

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.GET, buildAuthenticatedRequest(accessToken), String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                JsonNode assignmentsJson = objectMapper.readTree(response.getBody());

                for (JsonNode assignmentJson : assignmentsJson) {
                    ContentItem item = createNewQuizItem(courseId, assignmentJson);
                    hydrateNewQuizItem(item, accessToken);
                    newQuizzes.add(item);
                }

                log.info("Fetched {} New Quizzes for course {}", newQuizzes.size(), courseId);
            }

        } catch (Exception e) {
            log.error("Error fetching New Quizzes: {}", e.getMessage(), e);
        }

        return newQuizzes;
    }

    private ContentItem createNewQuizItem(String courseId, JsonNode assignmentJson) {
        String assignmentId = assignmentJson.get("id").asText();

        ContentItem item = new ContentItem();
        item.setId(ContentItem.newQuizContentId(courseId, assignmentId));
        item.setCourseId(courseId);
        item.setCanvasId(assignmentId);
        item.setAssignmentId(assignmentId);
        item.setContentType(ContentItem.ContentType.NEW_QUIZ);
        item.setTitle(getTextValue(assignmentJson, "name"));
        item.setDescription(getTextValue(assignmentJson, "description"));
        item.setHtmlUrl(getTextValue(assignmentJson, "html_url"));
        item.setPointsPossible(assignmentJson.has("points_possible") && !assignmentJson.get("points_possible").isNull()
                ? assignmentJson.get("points_possible").asDouble()
                : null);
        item.setPublished(assignmentJson.has("published") && assignmentJson.get("published").asBoolean());
        return item;
    }

    private void hydrateNewQuizItem(ContentItem item, String accessToken) {
        try {
            String url = String.format("%s/courses/%s/quizzes/%s",
                    getNewQuizApiBaseUrl(), item.getCourseId(), item.getAssignmentId());

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.GET, buildAuthenticatedRequest(accessToken), String.class);

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                return;
            }

            JsonNode newQuizJson = objectMapper.readTree(response.getBody());
            String assignmentId = getTextValue(newQuizJson, "assignment_id");
            if (assignmentId != null && !assignmentId.isBlank()) {
                item.setAssignmentId(assignmentId);
                item.setCanvasId(assignmentId);
                item.setId(ContentItem.newQuizContentId(item.getCourseId(), assignmentId));
            }

            String title = getTextValue(newQuizJson, "title");
            if (title != null) {
                item.setTitle(title);
            }

            String instructions = getTextValue(newQuizJson, "instructions");
            if (instructions != null) {
                item.setDescription(instructions);
            }

            item.setCanvasLaunchUrl(getTextValue(newQuizJson, "canvas_launch_url"));
            item.setResourceLinkUuid(getTextValue(newQuizJson, "resource_link_uuid"));
            item.setLookupUuid(getTextValue(newQuizJson, "lookup_uuid"));
            item.setApiUrl(url);

        } catch (Exception e) {
            log.warn("Error hydrating New Quiz {} for course {}: {}",
                    item.getAssignmentId(), item.getCourseId(), e.getMessage());
        }
    }

    private HttpEntity<?> buildAuthenticatedRequest(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        return new HttpEntity<>(headers);
    }

    private String getNewQuizApiBaseUrl() {
        String apiBaseUrl = canvasApiService.getCanvasApiBaseUrl();
        if (apiBaseUrl.endsWith(CANVAS_API_SUFFIX)) {
            return apiBaseUrl.substring(0, apiBaseUrl.length() - CANVAS_API_SUFFIX.length()) + "/api/quiz/v1";
        }
        return apiBaseUrl + "/api/quiz/v1";
    }

    private String getTextValue(JsonNode node, String fieldName) {
        if (!node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        return node.get(fieldName).asText();
    }

    /**
     * Gets a single content item by ID.
     */
    public ContentItem getContentItem(String contentId) {
        return contentRepository.findById(contentId);
    }

    /**
     * Gets the SEB setting for a content item by content-scoped ID.
     */
    public ContentSebSetting getSebSetting(String contentId) {
        return contentSebSettingRepository.findByContentId(contentId);
    }

    public ContentSebSetting saveSebSetting(ContentSebSetting setting) {
        return contentSebSettingRepository.save(setting);
    }

    /**
     * Gets content item by Canvas ID and type.
     */
    public ContentItem getContentByCanvasId(String canvasId, ContentItem.ContentType type) {
        return contentRepository.findByCanvasIdAndType(canvasId, type);
    }

    /**
     * Converts a Quiz to ContentItem for backward compatibility.
     */
    public ContentItem fromQuiz(Quiz quiz) {
        return ContentItem.fromQuiz(quiz);
    }

    /**
     * Gets all content items from Firestore cache.
     */
    public List<ContentItem> getCachedContentForCourse(String courseId) {
        return contentRepository.findByCourseId(courseId);
    }

    /**
     * Refreshes content from Canvas and updates cache.
     */
    public List<ContentItem> refreshContentForCourse(String courseId, String userId) {
        log.info("Refreshing content for course: {}", courseId);

        // Delete old cache
        contentRepository.deleteByCourseId(courseId);

        // Fetch fresh data
        return getAllContentForCourse(courseId, userId);
    }

    private List<ContentSebSetting> seedNewQuizSettings(List<ContentItem> newQuizzes) {
        List<ContentSebSetting> newQuizSettings = new ArrayList<>();
        for (ContentItem newQuiz : newQuizzes) {
            ContentSebSetting existingSetting = contentSebSettingRepository.findByContentId(newQuiz.getId());
            ContentSebSetting settingToSave = existingSetting != null
                    ? refreshContentMetadata(existingSetting, newQuiz)
                    : ContentSebSetting.fromContentItem(newQuiz);
            newQuizSettings.add(settingToSave);
        }
        return newQuizSettings;
    }

    private ContentSebSetting refreshContentMetadata(ContentSebSetting setting, ContentItem contentItem) {
        setting.setId(contentItem.getId());
        setting.setContentId(contentItem.getId());
        setting.setCanvasId(contentItem.getCanvasId());
        setting.setAssignmentId(contentItem.getAssignmentId());
        setting.setContentType(contentItem.getContentType());
        setting.setCourseId(contentItem.getCourseId());
        setting.setHtmlUrl(contentItem.getHtmlUrl());
        setting.setCanvasLaunchUrl(contentItem.getCanvasLaunchUrl());
        setting.setResourceLinkUuid(contentItem.getResourceLinkUuid());
        setting.setLookupUuid(contentItem.getLookupUuid());
        setting.setMetadata(contentItem.getMetadata());
        return setting;
    }
}
