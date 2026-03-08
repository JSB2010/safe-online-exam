package org.kentdenver.sebcanvas.repository;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.CollectionReference;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.WriteBatch;
import com.google.cloud.firestore.WriteResult;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
@Slf4j
public class FirestoreContentSebSettingRepository {

    private final Firestore firestore;
    private final String collectionName;

    @Autowired
    public FirestoreContentSebSettingRepository(
            Firestore firestore,
            @Value("${firestore.collection.content-seb-settings:contentSebSettings}") String collectionName) {
        this.firestore = firestore;
        this.collectionName = collectionName;
        log.info("Initialized FirestoreContentSebSettingRepository with collection: {}", collectionName);
    }

    private CollectionReference getCollection() {
        return firestore.collection(collectionName);
    }

    public ContentSebSetting save(ContentSebSetting setting) {
        try {
            String docId = resolveDocumentId(setting);
            setting.setId(docId);

            ApiFuture<WriteResult> result = getCollection().document(docId).set(setting);
            result.get();
            return setting;

        } catch (Exception e) {
            log.error("Error saving content SEB setting {}: {}", setting.getContentId(), e.getMessage(), e);
            throw new RuntimeException("Failed to save content SEB setting", e);
        }
    }

    public void saveAll(List<ContentSebSetting> settings) {
        if (settings == null || settings.isEmpty()) {
            return;
        }

        try {
            WriteBatch batch = firestore.batch();
            int count = 0;

            for (ContentSebSetting setting : settings) {
                String docId = resolveDocumentId(setting);
                setting.setId(docId);

                DocumentReference docRef = getCollection().document(docId);
                batch.set(docRef, setting);
                count++;

                if (count >= 500) {
                    batch.commit().get();
                    batch = firestore.batch();
                    count = 0;
                }
            }

            if (count > 0) {
                batch.commit().get();
            }

            log.info("Saved {} content SEB settings in batch", settings.size());

        } catch (Exception e) {
            log.error("Error saving content SEB settings in batch: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to save content SEB settings in batch", e);
        }
    }

    public ContentSebSetting findById(String id) {
        try {
            DocumentSnapshot document = getCollection().document(id).get().get();
            if (!document.exists()) {
                return null;
            }

            ContentSebSetting setting = document.toObject(ContentSebSetting.class);
            if (setting != null) {
                setting.setId(document.getId());
            }
            return setting;

        } catch (Exception e) {
            log.error("Error finding content SEB setting {}: {}", id, e.getMessage(), e);
            return null;
        }
    }

    public ContentSebSetting findByContentId(String contentId) {
        return findById(contentId);
    }

    private String resolveDocumentId(ContentSebSetting setting) {
        if (setting.getId() != null && !setting.getId().isBlank()) {
            return setting.getId();
        }
        if (setting.getContentId() != null && !setting.getContentId().isBlank()) {
            return setting.getContentId();
        }
        throw new IllegalArgumentException("ContentSebSetting requires an id or contentId");
    }
}