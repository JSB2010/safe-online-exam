package org.kentdenver.sebcanvas.repository;

import com.google.api.core.ApiFuture;
import com.google.cloud.Timestamp;
import com.google.cloud.firestore.*;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.OAuthToken;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.concurrent.ExecutionException;

/**
 * Repository for accessing OAuth token documents in Firestore.
 * This provides persistent storage for Canvas API access tokens.
 */
@Repository
@Slf4j
public class FirestoreOAuthTokenRepository {

    private final Firestore firestore;
    private final CollectionReference tokensCollection;

    /**
     * Constructor that initializes the collection reference.
     *
     * @param firestore The Firestore instance injected by Spring
     */
    @Autowired
    public FirestoreOAuthTokenRepository(Firestore firestore) {
        this.firestore = firestore;
        this.tokensCollection = firestore.collection("oauthTokens");
    }

    /**
     * Finds an OAuth token by user ID.
     *
     * @param userId The user ID to search for
     * @return Optional containing the token if found, empty otherwise
     */
    public Optional<OAuthToken> findByUserId(String userId) {
        try {
            log.debug("Searching for OAuth token for user: {}", userId);
            
            ApiFuture<QuerySnapshot> future = tokensCollection
                    .whereEqualTo("userId", userId)
                    .limit(1)
                    .get();
            
            QuerySnapshot querySnapshot = future.get();
            
            if (!querySnapshot.isEmpty()) {
                DocumentSnapshot document = querySnapshot.getDocuments().get(0);
                OAuthToken token = document.toObject(OAuthToken.class);
                log.debug("Found OAuth token for user: {}", userId);
                return Optional.ofNullable(token);
            } else {
                log.debug("No OAuth token found for user: {}", userId);
                return Optional.empty();
            }
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error finding OAuth token for user: {}", userId, e);
            return Optional.empty();
        }
    }

    /**
     * Saves an OAuth token to Firestore.
     * If a token for this user already exists, it will be updated.
     * Otherwise, a new token document will be created.
     *
     * @param token The OAuth token to save
     * @return The saved OAuth token with ID updated if it was new
     */
    public OAuthToken save(OAuthToken token) {
        try {
            log.debug("Saving OAuth token for user: {}", token.getUserId());
            
            // Check if a token already exists for this user
            Optional<OAuthToken> existingToken = findByUserId(token.getUserId());
            
            if (existingToken.isPresent()) {
                // Update existing token
                String existingId = existingToken.get().getId();
                token.setId(existingId);
                token.setUpdatedAt(Timestamp.now());
                
                ApiFuture<WriteResult> future = tokensCollection.document(existingId).set(token);
                future.get(); // Wait for write to complete
                
                log.info("Updated OAuth token for user: {}", token.getUserId());
            } else {
                // Create new token
                token.setCreatedAt(Timestamp.now());
                token.setUpdatedAt(Timestamp.now());
                
                ApiFuture<DocumentReference> future = tokensCollection.add(token);
                DocumentReference docRef = future.get();
                token.setId(docRef.getId());
                
                log.info("Created new OAuth token for user: {}", token.getUserId());
            }
            
            return token;
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error saving OAuth token for user: {}", token.getUserId(), e);
            throw new RuntimeException("Error saving OAuth token", e);
        }
    }

    /**
     * Deletes an OAuth token for a specific user.
     *
     * @param userId The user ID whose token should be deleted
     * @return true if a token was deleted, false if no token was found
     */
    public boolean deleteByUserId(String userId) {
        try {
            log.debug("Deleting OAuth token for user: {}", userId);
            
            Optional<OAuthToken> existingToken = findByUserId(userId);
            if (existingToken.isPresent()) {
                String tokenId = existingToken.get().getId();
                ApiFuture<WriteResult> future = tokensCollection.document(tokenId).delete();
                future.get(); // Wait for delete to complete
                
                log.info("Deleted OAuth token for user: {}", userId);
                return true;
            } else {
                log.debug("No OAuth token found to delete for user: {}", userId);
                return false;
            }
        } catch (ExecutionException | InterruptedException e) {
            log.error("Error deleting OAuth token for user: {}", userId, e);
            return false;
        }
    }

    /**
     * Checks if an OAuth token exists for a specific user.
     *
     * @param userId The user ID to check
     * @return true if a token exists, false otherwise
     */
    public boolean existsByUserId(String userId) {
        return findByUserId(userId).isPresent();
    }
}
