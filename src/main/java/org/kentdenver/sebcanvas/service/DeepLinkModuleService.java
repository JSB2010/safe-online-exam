package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.Quiz;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

/**
 * Service for creating and managing Canvas module items using LTI Deep Linking approach.
 * This eliminates the need for HTML modifications by using LTI Resource Links.
 */
@Service
@Slf4j
public class DeepLinkModuleService {

    private final LtiConfig ltiConfig;
    private final CanvasApiService canvasApiService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Autowired
    public DeepLinkModuleService(
            LtiConfig ltiConfig,
            CanvasApiService canvasApiService,
            RestTemplate restTemplate,
            ObjectMapper objectMapper) {
        this.ltiConfig = ltiConfig;
        this.canvasApiService = canvasApiService;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * Creates or updates a module item to use an LTI Resource Link for SEB enforcement.
     * This method works with any content type (quizzes, assignments, etc.)
     *
     * @param courseId The Canvas course ID
     * @param content The content item to create/update module item for
     * @param userId The user ID for Canvas API authentication
     * @param sebRequired Whether SEB is required for this content
     * @return true if successful, false otherwise
     */
    public boolean createOrUpdateModuleItemForContent(String courseId, ContentItem content, String userId, boolean sebRequired) {
        log.info("Creating/updating module item for content: {} (type: {}, SEB required: {})",
                content.getId(), content.getContentType(), sebRequired);

        try {
            // Find all modules in the course
            JsonNode modules = getModulesInCourse(courseId, userId);
            if (modules == null || !modules.isArray()) {
                log.warn("No modules found in course: {}", courseId);
                return false;
            }

            // Search for existing module item pointing to this content
            ModuleItemInfo existingItem = findModuleItemForContent(courseId, content, userId, modules);

            if (existingItem != null) {
                log.info("Found existing module item for content {} in module {}", content.getId(), existingItem.moduleId);

                if (sebRequired) {
                    // Update existing item to use LTI Resource Link
                    return updateModuleItemToLtiLink(courseId, existingItem, content, userId);
                } else {
                    // Restore to direct Canvas link
                    return restoreModuleItemToDirectLink(courseId, existingItem, content, userId);
                }
            } else {
                log.warn("No existing module item found for content: {}. Instructor should add to module first.", content.getId());
                return false;
            }

        } catch (Exception e) {
            log.error("Error creating/updating module item for content {}: {}", content.getId(), e.getMessage(), e);
            return false;
        }
    }

    /**
     * Legacy method for backward compatibility with Quiz objects.
     * @deprecated Use createOrUpdateModuleItemForContent instead
     */
    @Deprecated
    public boolean createOrUpdateModuleItemForQuiz(String courseId, Quiz quiz, String userId, boolean sebRequired) {
        ContentItem content = ContentItem.fromQuiz(quiz);
        return createOrUpdateModuleItemForContent(courseId, content, userId, sebRequired);
    }

    /**
     * Finds an existing module item that points to the given content.
     */
    private ModuleItemInfo findModuleItemForContent(String courseId, ContentItem content, String userId, JsonNode modules) {
        try {
            for (JsonNode module : modules) {
                String moduleId = module.get("id").asText();

                // Get module items
                JsonNode items = getModuleItems(courseId, moduleId, userId);
                if (items == null || !items.isArray()) {
                    continue;
                }

                // Look for item matching this content
                for (JsonNode item : items) {
                    String itemId = item.get("id").asText();
                    String type = item.has("type") ? item.get("type").asText() : "";
                    String contentId = item.has("content_id") ? item.get("content_id").asText() : "";

                    boolean isMatchingContent = false;

                    // Match based on content type
                    switch (content.getContentType()) {
                        case CLASSIC_QUIZ:
                            if ("Quiz".equalsIgnoreCase(type) && contentId.equals(content.getCanvasId())) {
                                isMatchingContent = true;
                            }
                            break;

                        case ASSIGNMENT:
                            if ("Assignment".equalsIgnoreCase(type) && contentId.equals(content.getCanvasId())) {
                                isMatchingContent = true;
                            }
                            break;

                        case EXTERNAL_TOOL:
                            if ("ExternalTool".equalsIgnoreCase(type)) {
                                String externalUrl = item.has("external_url") ? item.get("external_url").asText() : "";
                                if (externalUrl.contains(content.getCanvasId())) {
                                    isMatchingContent = true;
                                }
                            }
                            break;
                    }

                    // Also check if it's already an LTI link to our app
                    if ("ExternalTool".equalsIgnoreCase(type)) {
                        String externalUrl = item.has("external_url") ? item.get("external_url").asText() : "";
                        if (externalUrl.contains("/seb/launch/" + content.getId())) {
                            isMatchingContent = true;
                        }
                    }

                    if (isMatchingContent) {
                        ModuleItemInfo info = new ModuleItemInfo();
                        info.moduleId = moduleId;
                        info.itemId = itemId;
                        info.title = item.has("title") ? item.get("title").asText() : content.getTitle();
                        info.type = type;
                        return info;
                    }
                }
            }

            return null;
        } catch (Exception e) {
            log.error("Error finding module item for content {}: {}", content.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * Finds an existing module item that points to the given quiz.
     * @deprecated Use findModuleItemForContent instead
     */
    @Deprecated
    private ModuleItemInfo findModuleItemForQuiz(String courseId, Quiz quiz, String userId, JsonNode modules) {
        ContentItem content = ContentItem.fromQuiz(quiz);
        return findModuleItemForContent(courseId, content, userId, modules);
    }

    /**
     * Updates an existing module item to use an LTI Resource Link pointing to our SEB enforcement.
     */
    private boolean updateModuleItemToLtiLink(String courseId, ModuleItemInfo itemInfo, ContentItem content, String userId) {
        try {
            log.info("Updating module item {} to LTI link for content {}", itemInfo.itemId, content.getId());

            // Get access token
            String accessToken = canvasApiService.getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user: {}", userId);
                return false;
            }

            // Build the update request
            Map<String, Object> updatePayload = new HashMap<>();
            Map<String, Object> moduleItem = new HashMap<>();

            // Change to ExternalTool type with our LTI launch URL
            moduleItem.put("type", "ExternalTool");
            moduleItem.put("title", itemInfo.title);
            moduleItem.put("external_url", buildLtiLaunchUrl(content));
            moduleItem.put("new_tab", false); // Launch in same tab

            updatePayload.put("module_item", moduleItem);

            // Make API request to Canvas
            String url = String.format("%s/courses/%s/modules/%s/items/%s",
                    canvasApiService.getCanvasApiBaseUrl(), courseId, itemInfo.moduleId, itemInfo.itemId);

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            headers.setContentType(MediaType.APPLICATION_JSON);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(updatePayload, headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.PUT, request, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully updated module item {} to LTI link", itemInfo.itemId);
                return true;
            } else {
                log.error("Failed to update module item: {}", response.getStatusCode());
                return false;
            }

        } catch (Exception e) {
            log.error("Error updating module item to LTI link: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Restores a module item to point directly to the Canvas content (removes SEB enforcement).
     */
    private boolean restoreModuleItemToDirectLink(String courseId, ModuleItemInfo itemInfo, ContentItem content, String userId) {
        try {
            log.info("Restoring module item {} to direct link for content {}", itemInfo.itemId, content.getId());

            // Get access token
            String accessToken = canvasApiService.getAccessToken(userId);
            if (accessToken == null) {
                log.error("No access token available for user: {}", userId);
                return false;
            }

            // Build the update request
            Map<String, Object> updatePayload = new HashMap<>();
            Map<String, Object> moduleItem = new HashMap<>();

            // Restore to appropriate type based on content
            switch (content.getContentType()) {
                case CLASSIC_QUIZ:
                    moduleItem.put("type", "Quiz");
                    moduleItem.put("content_id", content.getCanvasId());
                    break;

                case ASSIGNMENT:
                    moduleItem.put("type", "Assignment");
                    moduleItem.put("content_id", content.getCanvasId());
                    break;

                case EXTERNAL_TOOL:
                    moduleItem.put("type", "ExternalTool");
                    moduleItem.put("external_url", content.getExternalToolUrl());
                    break;

                default:
                    log.error("Unsupported content type for restoration: {}", content.getContentType());
                    return false;
            }

            moduleItem.put("title", itemInfo.title);
            updatePayload.put("module_item", moduleItem);

            // Make API request to Canvas
            String url = String.format("%s/courses/%s/modules/%s/items/%s",
                    canvasApiService.getCanvasApiBaseUrl(), courseId, itemInfo.moduleId, itemInfo.itemId);

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);
            headers.setContentType(MediaType.APPLICATION_JSON);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(updatePayload, headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.PUT, request, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully restored module item {} to direct link", itemInfo.itemId);
                return true;
            } else {
                log.error("Failed to restore module item: {}", response.getStatusCode());
                return false;
            }

        } catch (Exception e) {
            log.error("Error restoring module item to direct link: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Builds the LTI launch URL for content with SEB enforcement.
     */
    private String buildLtiLaunchUrl(ContentItem content) {
        // This URL will trigger an LTI launch to our app, which will then handle SEB detection
        return ltiConfig.getSanitizedToolUrl() + "/seb/launch/" + content.getId();
    }

    /**
     * Gets all modules in a course.
     */
    private JsonNode getModulesInCourse(String courseId, String userId) {
        try {
            String accessToken = canvasApiService.getAccessToken(userId);
            if (accessToken == null) {
                return null;
            }

            String url = String.format("%s/courses/%s/modules?per_page=100",
                    canvasApiService.getCanvasApiBaseUrl(), courseId);

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);

            HttpEntity<?> request = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.GET, request, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                return objectMapper.readTree(response.getBody());
            }

            return null;
        } catch (Exception e) {
            log.error("Error getting modules for course {}: {}", courseId, e.getMessage());
            return null;
        }
    }

    /**
     * Gets all items in a module.
     */
    private JsonNode getModuleItems(String courseId, String moduleId, String userId) {
        try {
            String accessToken = canvasApiService.getAccessToken(userId);
            if (accessToken == null) {
                return null;
            }

            String url = String.format("%s/courses/%s/modules/%s/items?per_page=100",
                    canvasApiService.getCanvasApiBaseUrl(), courseId, moduleId);

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);

            HttpEntity<?> request = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.GET, request, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                return objectMapper.readTree(response.getBody());
            }

            return null;
        } catch (Exception e) {
            log.error("Error getting module items: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Helper class to store module item information.
     */
    private static class ModuleItemInfo {
        String moduleId;
        String itemId;
        String title;
        String type;
    }
}
