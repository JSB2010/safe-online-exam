package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ModuleItemUpdate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;


/**
 * Service for managing Canvas module items.
 * Handles finding and updating module items that link to quizzes.
 */
@Service
@Slf4j
public class ModuleItemService {

    @Autowired
    private CanvasApiService canvasApiService;

    @Autowired
    private ModuleItemUpdateService moduleItemUpdateService;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Finds all module items in a course that link to a specific quiz.
     *
     * @param courseId The Canvas course ID
     * @param quizId The Canvas quiz ID
     * @param userId The user ID for authentication
     * @return List of module items that link to the quiz
     */
    public List<ModuleItemUpdate> findModuleItemsForQuiz(String courseId, String quizId, String userId) {
        log.info("Finding module items for quiz {} in course {}", quizId, courseId);
        
        List<ModuleItemUpdate> quizModuleItems = new ArrayList<>();
        
        try {
            // Get all modules in the course
            List<JsonNode> modules = getModulesInCourse(courseId, userId);
            
            for (JsonNode module : modules) {
                String moduleId = module.get("id").asText();
                String moduleName = module.get("name").asText();
                
                log.debug("Checking module: {} ({})", moduleName, moduleId);
                
                // Get all items in this module
                List<JsonNode> moduleItems = getModuleItems(courseId, moduleId, userId);
                
                for (JsonNode item : moduleItems) {
                    if (isQuizModuleItem(item, quizId)) {
                        ModuleItemUpdate moduleItemUpdate = createModuleItemUpdate(item, moduleId, moduleName, courseId, quizId);
                        quizModuleItems.add(moduleItemUpdate);
                        log.info("Found quiz module item: {} in module {}", item.get("title").asText(), moduleName);
                    }
                }
            }
            
        } catch (Exception e) {
            log.error("Error finding module items for quiz {}: {}", quizId, e.getMessage(), e);
        }
        
        log.info("Found {} module items for quiz {}", quizModuleItems.size(), quizId);
        return quizModuleItems;
    }

    /**
     * Updates module items to use SEB redirect URLs.
     *
     * @param moduleItems List of module items to update
     * @param sebRedirectUrl The SEB redirect URL to use
     * @param userId The user ID for authentication
     * @return Number of successfully updated items
     */
    public int updateModuleItemsToSeb(List<ModuleItemUpdate> moduleItems, String sebRedirectUrl, String userId) {
        log.info("Updating {} module items to use SEB redirect URL", moduleItems.size());
        
        int successCount = 0;
        
        for (ModuleItemUpdate item : moduleItems) {
            try {
                boolean success = updateModuleItemUrl(item, sebRedirectUrl, userId);
                if (success) {
                    // Store the update in our database
                    moduleItemUpdateService.saveModuleItemUpdate(item);
                    successCount++;
                    log.info("Successfully updated module item: {}", item.getTitle());
                } else {
                    log.warn("Failed to update module item: {}", item.getTitle());
                }
            } catch (Exception e) {
                log.error("Error updating module item {}: {}", item.getTitle(), e.getMessage(), e);
            }
        }
        
        log.info("Successfully updated {}/{} module items", successCount, moduleItems.size());
        return successCount;
    }

    /**
     * Reverts module items back to their original quiz URLs.
     *
     * @param quizId The quiz ID to revert module items for
     * @param userId The user ID for authentication
     * @return Number of successfully reverted items
     */
    public int revertModuleItemsForQuiz(String quizId, String userId) {
        log.info("Reverting module items for quiz {}", quizId);
        
        List<ModuleItemUpdate> updates = moduleItemUpdateService.getModuleItemUpdatesForQuiz(quizId);
        int successCount = 0;
        
        for (ModuleItemUpdate update : updates) {
            try {
                boolean success = updateModuleItemUrl(update, update.getOriginalUrl(), userId);
                if (success) {
                    // Remove the update record since it's been reverted
                    moduleItemUpdateService.deleteModuleItemUpdate(update.getId());
                    successCount++;
                    log.info("Successfully reverted module item: {}", update.getTitle());
                } else {
                    log.warn("Failed to revert module item: {}", update.getTitle());
                }
            } catch (Exception e) {
                log.error("Error reverting module item {}: {}", update.getTitle(), e.getMessage(), e);
            }
        }
        
        log.info("Successfully reverted {}/{} module items", successCount, updates.size());
        return successCount;
    }

    /**
     * Gets all modules in a course.
     */
    private List<JsonNode> getModulesInCourse(String courseId, String userId) throws Exception {
        String url = String.format("https://kentdenver.instructure.com/api/v1/courses/%s/modules", courseId);
        
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + canvasApiService.getAccessToken(userId));
        
        HttpEntity<String> entity = new HttpEntity<>(headers);
        ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);
        
        JsonNode jsonResponse = objectMapper.readTree(response.getBody());
        List<JsonNode> modules = new ArrayList<>();
        
        if (jsonResponse.isArray()) {
            for (JsonNode module : jsonResponse) {
                modules.add(module);
            }
        }
        
        return modules;
    }

    /**
     * Gets all items in a specific module.
     */
    private List<JsonNode> getModuleItems(String courseId, String moduleId, String userId) throws Exception {
        String url = String.format("https://kentdenver.instructure.com/api/v1/courses/%s/modules/%s/items", courseId, moduleId);
        
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + canvasApiService.getAccessToken(userId));
        
        HttpEntity<String> entity = new HttpEntity<>(headers);
        ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);
        
        JsonNode jsonResponse = objectMapper.readTree(response.getBody());
        List<JsonNode> items = new ArrayList<>();
        
        if (jsonResponse.isArray()) {
            for (JsonNode item : jsonResponse) {
                items.add(item);
            }
        }
        
        return items;
    }

    /**
     * Checks if a module item links to a specific quiz.
     */
    private boolean isQuizModuleItem(JsonNode item, String quizId) {
        if (!item.has("type") || !item.has("content_id")) {
            return false;
        }
        
        String type = item.get("type").asText();
        String contentId = item.get("content_id").asText();
        
        // Check if it's a quiz type and matches our quiz ID
        return "Quiz".equals(type) && quizId.equals(contentId);
    }

    /**
     * Creates a ModuleItemUpdate object from a Canvas module item.
     */
    private ModuleItemUpdate createModuleItemUpdate(JsonNode item, String moduleId, String moduleName, 
                                                   String courseId, String quizId) {
        ModuleItemUpdate update = new ModuleItemUpdate();
        update.setCourseId(courseId);
        update.setQuizId(quizId);
        update.setModuleId(moduleId);
        update.setModuleName(moduleName);
        update.setModuleItemId(item.get("id").asText());
        update.setTitle(item.get("title").asText());
        
        // Store the original URL
        if (item.has("html_url")) {
            update.setOriginalUrl(item.get("html_url").asText());
        } else if (item.has("url")) {
            update.setOriginalUrl(item.get("url").asText());
        }
        
        return update;
    }

    /**
     * Updates a module item's URL.
     */
    private boolean updateModuleItemUrl(ModuleItemUpdate item, String newUrl, String userId) {
        try {
            String url = String.format("https://kentdenver.instructure.com/api/v1/courses/%s/modules/%s/items/%s", 
                item.getCourseId(), item.getModuleId(), item.getModuleItemId());
            
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + canvasApiService.getAccessToken(userId));
            headers.set("Content-Type", "application/json");
            
            Map<String, Object> requestBody = new HashMap<>();
            Map<String, String> moduleItem = new HashMap<>();
            moduleItem.put("external_url", newUrl);
            moduleItem.put("type", "ExternalUrl");
            requestBody.put("module_item", moduleItem);
            
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.PUT, entity, String.class);
            
            return response.getStatusCode().is2xxSuccessful();
            
        } catch (Exception e) {
            log.error("Error updating module item URL: {}", e.getMessage(), e);
            return false;
        }
    }
}
