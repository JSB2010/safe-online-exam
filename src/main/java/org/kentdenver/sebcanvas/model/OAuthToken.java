package org.kentdenver.sebcanvas.model;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.annotation.DocumentId;
import com.google.cloud.firestore.annotation.ServerTimestamp;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents an OAuth access token stored in Firestore.
 * This model stores Canvas API access tokens for users to enable persistent authentication.
 */
@Data
@NoArgsConstructor
public class OAuthToken {
    
    /**
     * Unique identifier for the token record.
     * In Firestore, this will be the document ID.
     */
    @DocumentId
    private String id;
    
    /**
     * The user ID this token belongs to.
     * This should match the Canvas user ID from LTI launches.
     */
    private String userId;
    
    /**
     * The OAuth access token value.
     * This is the actual token used to make Canvas API requests.
     */
    private String accessToken;
    
    /**
     * When this token was created in our system.
     * Using Firestore's server timestamp for consistency.
     */
    @ServerTimestamp
    private Timestamp createdAt;
    
    /**
     * When this token was last updated in our system.
     * Using Firestore's server timestamp for consistency.
     */
    @ServerTimestamp
    private Timestamp updatedAt;
    
    /**
     * When this token expires (if known).
     * Canvas tokens typically don't expire, but this field is available for future use.
     */
    private Timestamp expiresAt;
    
    /**
     * The scope(s) this token was granted.
     * Stored as a space-separated string to match OAuth2 standards.
     */
    private String scope;
    
    /**
     * Constructor for creating a new OAuth token.
     * 
     * @param userId The user ID this token belongs to
     * @param accessToken The access token value
     * @param scope The scope(s) granted to this token
     */
    public OAuthToken(String userId, String accessToken, String scope) {
        this.userId = userId;
        this.accessToken = accessToken;
        this.scope = scope;
    }
}
