package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.Quiz;
import org.kentdenver.sebcanvas.repository.FirestoreContentRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;

/**
 * Service for managing all types of Canvas content (quizzes, assignments, etc.)
 * that can have SEB enforcement.
 *
 * This is the unified service that replaces quiz-specific services for Phase 2.
 */
@Service
@Slf4j
public class ContentService {

    private final CanvasApiService canvasApiService;
    private final FirestoreContentRepository contentRepository;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Autowired
    public ContentService(
            CanvasApiService canvasApiService,
            FirestoreContentRepository contentRepository,
            RestTemplate restTemplate,
            ObjectMapper objectMapper) {
        this.canvasApiService = canvasApiService;
        this.contentRepository = contentRepository;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * Fetches all SEB-compatible content from a Canvas course.
     * This includes:
     * - Classic Quizzes
     * - New Quizzes (as assignments)
     * - Regular Assignments
     * - External Tools (that can be locked down)
     *
     * @param courseId The Canvas course ID
     * @param userId The user ID for Canvas API authentication
     * @return List of all content items that support SEB
     */
    public List<ContentItem> getAllContentForCourse(String courseId, String userId) {
        log.info("Fetching all SEB-compatible content for course: {}", courseId);

        List<ContentItem> allContent = new ArrayList<>();

        try {
            // Fetch Classic Quizzes
            allContent.addAll(getClassicQuizzes(courseId, userId));

            // Fetch Assignments (includes New Quizzes)
            allContent.addAll(getAssignments(courseId, userId));

            log.info("Found {} total content items for course {}", allContent.size(), courseId);

            // Save to Firestore for caching
            contentRepository.saveAll(allContent);

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
                    item.setId("classicquiz_" + item.getCanvasId());
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

    /**
     * Fetches assignments from Canvas (includes New Quizzes and regular assignments).
     */
    private List<ContentItem> getAssignments(String courseId, String userId) {
        List<ContentItem> assignments = new ArrayList<>();

        try {
            String accessToken = canvasApiService.getAccessToken(userId);
            if (accessToken == null) {
                log.warn("No access token for user {}, skipping assignments", userId);
                return assignments;
            }

            String url = String.format("%s/courses/%s/assignments?per_page=100",
                    canvasApiService.getCanvasApiBaseUrl(), courseId);

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            HttpEntity<?> request = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.GET, request, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                JsonNode assignmentsJson = objectMapper.readTree(response.getBody());

                for (JsonNode assignmentJson : assignmentsJson) {
                    ContentItem item = new ContentItem();
                    item.setCourseId(courseId);
                    item.setCanvasId(assignmentJson.get("id").asText());

                    // Determine if this is a New Quiz or regular assignment
                    boolean isNewQuiz = false;
                    if (assignmentJson.has("is_quiz_assignment") &&
                        assignmentJson.get("is_quiz_assignment").asBoolean()) {
                        isNewQuiz = true;
                        item.setContentType(ContentItem.ContentType.NEW_QUIZ);
                        item.setId("newquiz_" + item.getCanvasId());
                    } else if (assignmentJson.has("external_tool_tag_attributes")) {
                        // External tool assignment (could be New Quiz or other LTI tool)
                        JsonNode toolAttrs = assignmentJson.get("external_tool_tag_attributes");
                        if (toolAttrs.has("url")) {
                            String toolUrl = toolAttrs.get("url").asText();
                            if (toolUrl.contains("quiz-lti")) {
                                item.setContentType(ContentItem.ContentType.NEW_QUIZ);
                                item.setId("newquiz_" + item.getCanvasId());
                                isNewQuiz = true;
                            } else {
                                item.setContentType(ContentItem.ContentType.EXTERNAL_TOOL);
                                item.setId("externaltool_" + item.getCanvasId());
                                item.setExternalToolUrl(toolUrl);
                            }
                        }
                    } else {
                        item.setContentType(ContentItem.ContentType.ASSIGNMENT);
                        item.setId("assignment_" + item.getCanvasId());
                    }

                    item.setTitle(assignmentJson.get("name").asText());
                    item.setDescription(assignmentJson.has("description") ?
                            assignmentJson.get("description").asText() : "");
                    item.setHtmlUrl(assignmentJson.get("html_url").asText());
                    item.setPointsPossible(assignmentJson.has("points_possible") ?
                            assignmentJson.get("points_possible").asDouble() : null);
                    item.setPublished(assignmentJson.has("published") &&
                            assignmentJson.get("published").asBoolean());

                    // Get submission types
                    if (assignmentJson.has("submission_types")) {
                        JsonNode submissionTypes = assignmentJson.get("submission_types");
                        List<String> types = new ArrayList<>();
                        for (JsonNode type : submissionTypes) {
                            types.add(type.asText());
                        }
                        item.setSubmissionTypes(types.toArray(new String[0]));
                    }

                    // Get due date
                    if (assignmentJson.has("due_at") && !assignmentJson.get("due_at").isNull()) {
                        // Parse due date if needed
                        // item.setDueAt(...);
                    }

                    assignments.add(item);
                }

                log.info("Fetched {} assignments for course {} ({} New Quizzes)",
                        assignments.size(), courseId,
                        assignments.stream()
                                .filter(a -> a.getContentType() == ContentItem.ContentType.NEW_QUIZ)
                                .count());
            }

        } catch (Exception e) {
            log.error("Error fetching assignments: {}", e.getMessage(), e);
        }

        return assignments;
    }

    /**
     * Gets a single content item by ID.
     */
    public ContentItem getContentItem(String contentId) {
        return contentRepository.findById(contentId);
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
}
