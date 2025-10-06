package org.kentdenver.sebcanvas.repository;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.*;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutionException;

/**
 * Firestore repository for ContentItem entities.
 * Handles CRUD operations for all Canvas content types (quizzes, assignments, etc.)
 */
@Repository
@Slf4j
public class FirestoreContentRepository {

    private final Firestore firestore;
    private final String collectionName;

    @Autowired
    public FirestoreContentRepository(
            Firestore firestore,
            @Value("${firestore.collection.content-items:contentItems}") String collectionName) {
        this.firestore = firestore;
        this.collectionName = collectionName;
        log.info("Initialized FirestoreContentRepository with collection: {}", collectionName);
    }

    /**
     * Gets the Firestore collection for content items.
     */
    private CollectionReference getCollection() {
        return firestore.collection(collectionName);
    }

    /**
     * Saves a content item to Firestore.
     */
    public ContentItem save(ContentItem contentItem) {
        try {
            String docId = contentItem.getId() != null ? contentItem.getId() :
                    generateContentId(contentItem);
            contentItem.setId(docId);

            DocumentReference docRef = getCollection().document(docId);
            ApiFuture<WriteResult> result = docRef.set(contentItem);
            result.get(); // Wait for completion

            log.debug("Saved content item: {}", docId);
            return contentItem;

        } catch (Exception e) {
            log.error("Error saving content item: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to save content item", e);
        }
    }

    /**
     * Finds a content item by ID.
     */
    public ContentItem findById(String id) {
        try {
            DocumentReference docRef = getCollection().document(id);
            ApiFuture<DocumentSnapshot> future = docRef.get();
            DocumentSnapshot document = future.get();

            if (document.exists()) {
                ContentItem item = document.toObject(ContentItem.class);
                if (item != null) {
                    item.setId(document.getId());
                }
                return item;
            }

            return null;

        } catch (Exception e) {
            log.error("Error finding content item {}: {}", id, e.getMessage(), e);
            return null;
        }
    }

    /**
     * Finds all content items for a specific course.
     */
    public List<ContentItem> findByCourseId(String courseId) {
        try {
            ApiFuture<QuerySnapshot> future = getCollection()
                    .whereEqualTo("courseId", courseId)
                    .get();

            List<QueryDocumentSnapshot> documents = future.get().getDocuments();
            List<ContentItem> items = new ArrayList<>();

            for (QueryDocumentSnapshot document : documents) {
                ContentItem item = document.toObject(ContentItem.class);
                item.setId(document.getId());
                items.add(item);
            }

            log.debug("Found {} content items for course: {}", items.size(), courseId);
            return items;

        } catch (Exception e) {
            log.error("Error finding content items for course {}: {}", courseId, e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * Finds content items by course and type.
     */
    public List<ContentItem> findByCourseIdAndType(String courseId, ContentItem.ContentType type) {
        try {
            ApiFuture<QuerySnapshot> future = getCollection()
                    .whereEqualTo("courseId", courseId)
                    .whereEqualTo("contentType", type.name())
                    .get();

            List<QueryDocumentSnapshot> documents = future.get().getDocuments();
            List<ContentItem> items = new ArrayList<>();

            for (QueryDocumentSnapshot document : documents) {
                ContentItem item = document.toObject(ContentItem.class);
                item.setId(document.getId());
                items.add(item);
            }

            log.debug("Found {} {} items for course: {}", items.size(), type, courseId);
            return items;

        } catch (Exception e) {
            log.error("Error finding {} items for course {}: {}", type, courseId, e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * Finds a content item by Canvas ID and type.
     */
    public ContentItem findByCanvasIdAndType(String canvasId, ContentItem.ContentType type) {
        try {
            String expectedId = generateContentId(type, canvasId);
            return findById(expectedId);

        } catch (Exception e) {
            log.error("Error finding content by Canvas ID {} and type {}: {}", canvasId, type, e.getMessage());
            return null;
        }
    }

    /**
     * Deletes a content item.
     */
    public void delete(String id) {
        try {
            ApiFuture<WriteResult> result = getCollection().document(id).delete();
            result.get();
            log.debug("Deleted content item: {}", id);

        } catch (Exception e) {
            log.error("Error deleting content item {}: {}", id, e.getMessage(), e);
        }
    }

    /**
     * Deletes all content items for a course.
     */
    public void deleteByCourseId(String courseId) {
        try {
            List<ContentItem> items = findByCourseId(courseId);
            for (ContentItem item : items) {
                delete(item.getId());
            }
            log.info("Deleted {} content items for course: {}", items.size(), courseId);

        } catch (Exception e) {
            log.error("Error deleting content items for course {}: {}", courseId, e.getMessage(), e);
        }
    }

    /**
     * Checks if a content item exists.
     */
    public boolean exists(String id) {
        try {
            DocumentSnapshot doc = getCollection().document(id).get().get();
            return doc.exists();
        } catch (Exception e) {
            log.error("Error checking if content item exists: {}", e.getMessage());
            return false;
        }
    }

    /**
     * Generates a content ID from a ContentItem.
     */
    private String generateContentId(ContentItem item) {
        return generateContentId(item.getContentType(), item.getCanvasId());
    }

    /**
     * Generates a content ID from type and Canvas ID.
     * Format: {type}_{canvasId}
     */
    private String generateContentId(ContentItem.ContentType type, String canvasId) {
        String typePrefix = type.name().toLowerCase().replace("_", "");
        return typePrefix + "_" + canvasId;
    }

    /**
     * Saves multiple content items in batch.
     */
    public void saveAll(List<ContentItem> items) {
        try {
            WriteBatch batch = firestore.batch();
            int count = 0;

            for (ContentItem item : items) {
                String docId = item.getId() != null ? item.getId() : generateContentId(item);
                item.setId(docId);

                DocumentReference docRef = getCollection().document(docId);
                batch.set(docRef, item);
                count++;

                // Firestore batch limit is 500 operations
                if (count >= 500) {
                    batch.commit().get();
                    batch = firestore.batch();
                    count = 0;
                }
            }

            if (count > 0) {
                batch.commit().get();
            }

            log.info("Saved {} content items in batch", items.size());

        } catch (Exception e) {
            log.error("Error saving content items in batch: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to save content items in batch", e);
        }
    }
}
