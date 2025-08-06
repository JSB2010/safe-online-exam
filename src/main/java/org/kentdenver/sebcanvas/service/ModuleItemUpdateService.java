package org.kentdenver.sebcanvas.service;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.*;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ModuleItemUpdate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;


/**
 * Service for managing ModuleItemUpdate records in Firestore.
 */
@Service
@Slf4j
public class ModuleItemUpdateService {

    @Autowired
    private Firestore firestore;

    private static final String COLLECTION_NAME = "module_item_updates";

    /**
     * Saves a module item update to Firestore.
     *
     * @param update The module item update to save
     * @return The saved update with generated ID
     */
    public ModuleItemUpdate saveModuleItemUpdate(ModuleItemUpdate update) {
        try {
            log.info("Saving module item update for quiz {} in course {}", update.getQuizId(), update.getCourseId());
            
            CollectionReference collection = firestore.collection(COLLECTION_NAME);
            
            // Use unique key as document ID to prevent duplicates
            String documentId = update.getUniqueKey();
            DocumentReference docRef = collection.document(documentId);
            
            // Set the ID in the object
            update.setId(documentId);
            update.setUsingSebUrl(true);
            
            ApiFuture<WriteResult> result = docRef.set(update);
            result.get(); // Wait for completion
            
            log.info("Successfully saved module item update: {}", update.getDescription());
            return update;
            
        } catch (Exception e) {
            log.error("Error saving module item update: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to save module item update", e);
        }
    }

    /**
     * Gets all module item updates for a specific quiz.
     *
     * @param quizId The quiz ID to search for
     * @return List of module item updates for the quiz
     */
    public List<ModuleItemUpdate> getModuleItemUpdatesForQuiz(String quizId) {
        try {
            log.info("Getting module item updates for quiz: {}", quizId);
            
            CollectionReference collection = firestore.collection(COLLECTION_NAME);
            Query query = collection.whereEqualTo("quizId", quizId)
                                  .whereEqualTo("usingSebUrl", true);
            
            ApiFuture<QuerySnapshot> future = query.get();
            QuerySnapshot querySnapshot = future.get();
            
            List<ModuleItemUpdate> updates = new ArrayList<>();
            for (DocumentSnapshot document : querySnapshot.getDocuments()) {
                ModuleItemUpdate update = document.toObject(ModuleItemUpdate.class);
                if (update != null) {
                    update.setId(document.getId());
                    updates.add(update);
                }
            }
            
            log.info("Found {} module item updates for quiz {}", updates.size(), quizId);
            return updates;
            
        } catch (Exception e) {
            log.error("Error getting module item updates for quiz {}: {}", quizId, e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * Gets all module item updates for a specific course.
     *
     * @param courseId The course ID to search for
     * @return List of module item updates for the course
     */
    public List<ModuleItemUpdate> getModuleItemUpdatesForCourse(String courseId) {
        try {
            log.info("Getting module item updates for course: {}", courseId);
            
            CollectionReference collection = firestore.collection(COLLECTION_NAME);
            Query query = collection.whereEqualTo("courseId", courseId)
                                  .whereEqualTo("usingSebUrl", true);
            
            ApiFuture<QuerySnapshot> future = query.get();
            QuerySnapshot querySnapshot = future.get();
            
            List<ModuleItemUpdate> updates = new ArrayList<>();
            for (DocumentSnapshot document : querySnapshot.getDocuments()) {
                ModuleItemUpdate update = document.toObject(ModuleItemUpdate.class);
                if (update != null) {
                    update.setId(document.getId());
                    updates.add(update);
                }
            }
            
            log.info("Found {} module item updates for course {}", updates.size(), courseId);
            return updates;
            
        } catch (Exception e) {
            log.error("Error getting module item updates for course {}: {}", courseId, e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * Deletes a module item update by ID.
     *
     * @param updateId The ID of the update to delete
     */
    public void deleteModuleItemUpdate(String updateId) {
        try {
            log.info("Deleting module item update: {}", updateId);
            
            DocumentReference docRef = firestore.collection(COLLECTION_NAME).document(updateId);
            ApiFuture<WriteResult> result = docRef.delete();
            result.get(); // Wait for completion
            
            log.info("Successfully deleted module item update: {}", updateId);
            
        } catch (Exception e) {
            log.error("Error deleting module item update {}: {}", updateId, e.getMessage(), e);
            throw new RuntimeException("Failed to delete module item update", e);
        }
    }

    /**
     * Deletes all module item updates for a specific quiz.
     *
     * @param quizId The quiz ID to delete updates for
     * @return Number of updates deleted
     */
    public int deleteModuleItemUpdatesForQuiz(String quizId) {
        try {
            log.info("Deleting all module item updates for quiz: {}", quizId);
            
            List<ModuleItemUpdate> updates = getModuleItemUpdatesForQuiz(quizId);
            int deletedCount = 0;
            
            for (ModuleItemUpdate update : updates) {
                try {
                    deleteModuleItemUpdate(update.getId());
                    deletedCount++;
                } catch (Exception e) {
                    log.warn("Failed to delete module item update {}: {}", update.getId(), e.getMessage());
                }
            }
            
            log.info("Deleted {} module item updates for quiz {}", deletedCount, quizId);
            return deletedCount;
            
        } catch (Exception e) {
            log.error("Error deleting module item updates for quiz {}: {}", quizId, e.getMessage(), e);
            return 0;
        }
    }

    /**
     * Checks if a module item update exists for a specific module item.
     *
     * @param courseId The course ID
     * @param moduleId The module ID
     * @param moduleItemId The module item ID
     * @return True if an update exists, false otherwise
     */
    public boolean moduleItemUpdateExists(String courseId, String moduleId, String moduleItemId) {
        try {
            String uniqueKey = String.format("%s_%s_%s", courseId, moduleId, moduleItemId);
            DocumentReference docRef = firestore.collection(COLLECTION_NAME).document(uniqueKey);
            
            ApiFuture<DocumentSnapshot> future = docRef.get();
            DocumentSnapshot document = future.get();
            
            return document.exists();
            
        } catch (Exception e) {
            log.error("Error checking if module item update exists: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Updates the SEB URL for an existing module item update.
     *
     * @param updateId The update ID
     * @param newSebUrl The new SEB URL
     */
    public void updateSebUrl(String updateId, String newSebUrl) {
        try {
            log.info("Updating SEB URL for module item update: {}", updateId);
            
            DocumentReference docRef = firestore.collection(COLLECTION_NAME).document(updateId);
            ApiFuture<WriteResult> result = docRef.update("sebUrl", newSebUrl);
            result.get(); // Wait for completion
            
            log.info("Successfully updated SEB URL for module item update: {}", updateId);
            
        } catch (Exception e) {
            log.error("Error updating SEB URL for module item update {}: {}", updateId, e.getMessage(), e);
            throw new RuntimeException("Failed to update SEB URL", e);
        }
    }
}
