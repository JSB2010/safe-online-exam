package org.kentdenver.sebcanvas.repository;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.*;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.springframework.stereotype.Repository;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import lombok.extern.slf4j.Slf4j;

/**
 * Repository for accessing QuizSebSetting documents in Firestore.
 * This replaces the JPA-based SebSettingRepository with Firestore operations.
 */
@Repository
@Slf4j
public class FirestoreSebSettingRepository {

    private final Firestore firestore;
    private final CollectionReference sebSettingsCollection;

    /**
     * Constructor that initializes the collection reference.
     *
     * @param firestore The Firestore instance injected by Spring
     */
    @Autowired
    public FirestoreSebSettingRepository(Firestore firestore) {
        this.firestore = firestore;
        this.sebSettingsCollection = firestore.collection("sebSettings");
    }

    /**
     * Finds a SEB setting for a specific quiz.
     *
     * @param quizId The quiz ID
     * @return An Optional containing the SEB setting, or empty if not found
     */
    public Optional<QuizSebSetting> findByQuizId(String quizId) {
        try {
            Query query = sebSettingsCollection.whereEqualTo("quizId", quizId).limit(1);
            ApiFuture<QuerySnapshot> querySnapshot = query.get();
            List<QueryDocumentSnapshot> documents = querySnapshot.get().getDocuments();

            if (documents.isEmpty()) {
                return Optional.empty();
            }

            QueryDocumentSnapshot document = documents.get(0);
            QuizSebSetting setting = document.toObject(QuizSebSetting.class);
            return Optional.of(setting);
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error fetching SEB setting for quiz: {}", quizId, e);
            throw new RuntimeException("Error fetching SEB setting", e);
        }
    }

    /**
     * Finds all SEB settings for a list of quiz IDs.
     * This is used to efficiently retrieve settings for multiple quizzes at once.
     *
     * Note: Firestore IN queries are limited to 10 items, so we batch larger requests.
     *
     * @param quizIds The list of quiz IDs
     * @return The list of SEB settings found
     */
    public List<QuizSebSetting> findAllByQuizIdIn(List<String> quizIds) {
        if (quizIds == null || quizIds.isEmpty()) {
            return new ArrayList<>();
        }

        try {
            List<QuizSebSetting> results = new ArrayList<>();

            // Firestore IN queries are limited to 10 items, so we batch them
            for (int i = 0; i < quizIds.size(); i += 10) {
                int endIndex = Math.min(i + 10, quizIds.size());
                List<String> batchIds = quizIds.subList(i, endIndex);

                Query query = sebSettingsCollection.whereIn("quizId", batchIds);
                ApiFuture<QuerySnapshot> querySnapshot = query.get();

                for (DocumentSnapshot document : querySnapshot.get().getDocuments()) {
                    QuizSebSetting setting = document.toObject(QuizSebSetting.class);
                    results.add(setting);
                }
            }

            return results;
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error fetching multiple SEB settings: {}", Arrays.toString(quizIds.toArray()), e);
            throw new RuntimeException("Error fetching multiple SEB settings", e);
        }
    }

    /**
     * Saves a SEB setting to Firestore.
     * If the setting has no ID, a new document is created.
     * If it has an ID, the existing document is updated.
     *
     * @param setting The SEB setting to save
     * @return The saved SEB setting with ID updated if it was new
     */
    public QuizSebSetting save(QuizSebSetting setting) {
        try {
            if (setting.getId() == null || setting.getId().isEmpty()) {
                // New setting - generate ID
                ApiFuture<DocumentReference> future = sebSettingsCollection.add(setting);
                DocumentReference docRef = future.get();
                setting.setId(docRef.getId());
            } else {
                // Existing setting - update by ID
                ApiFuture<WriteResult> future = sebSettingsCollection.document(setting.getId()).set(setting);
                future.get(); // Wait for write to complete
            }

            return setting;
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error saving SEB setting for quiz: {}", setting.getQuizId(), e);
            throw new RuntimeException("Error saving SEB setting", e);
        }
    }

    /**
     * Deletes a SEB setting by its ID.
     *
     * @param id The setting ID to delete
     */
    public void deleteById(String id) {
        try {
            ApiFuture<WriteResult> future = sebSettingsCollection.document(id).delete();
            future.get(); // Wait for deletion to complete
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error deleting SEB setting: {}", id, e);
            throw new RuntimeException("Error deleting SEB setting", e);
        }
    }

    /**
     * Finds a SEB setting by its ID.
     *
     * @param id The setting ID
     * @return Optional containing the setting if found, empty otherwise
     */
    public Optional<QuizSebSetting> findById(String id) {
        try {
            DocumentReference docRef = sebSettingsCollection.document(id);
            ApiFuture<DocumentSnapshot> future = docRef.get();
            DocumentSnapshot document = future.get();

            if (document.exists()) {
                QuizSebSetting setting = document.toObject(QuizSebSetting.class);
                return Optional.ofNullable(setting);
            } else {
                return Optional.empty();
            }
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error finding SEB setting by ID: {}", id, e);
            throw new RuntimeException("Error finding SEB setting", e);
        }
    }

    /**
     * Finds all SEB settings.
     *
     * @return List of all SEB settings
     */
    public List<QuizSebSetting> findAll() {
        try {
            ApiFuture<QuerySnapshot> future = sebSettingsCollection.get();
            List<QuizSebSetting> settings = new ArrayList<>();

            for (DocumentSnapshot document : future.get().getDocuments()) {
                QuizSebSetting setting = document.toObject(QuizSebSetting.class);
                settings.add(setting);
            }

            return settings;
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error retrieving all SEB settings", e);
            throw new RuntimeException("Error retrieving all SEB settings", e);
        }
    }
}