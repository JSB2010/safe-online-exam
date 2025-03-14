package org.kentdenver.sebcanvas.service;

import org.kentdenver.sebcanvas.model.Quiz;
import java.util.List;
import java.util.Map;

/**
 * Interface for Canvas API interactions.
 * This defines the contract for different Canvas API service implementations.
 */
public interface CanvasService {

    /**
     * Gets a list of quizzes for a specific course from Canvas.
     *
     * @param courseId The Canvas course ID
     * @param userId The Canvas user ID for authentication context
     * @return List of quizzes in the course
     */
    List<Quiz> getQuizzesForCourse(String courseId, String userId);

    /**
     * Gets a temporary session token for direct access to Canvas.
     * This can be used to generate secure, time-limited URLs for quiz access.
     *
     * @param userId The Canvas user ID for authentication context
     * @param targetUrl The URL to access with the session token
     * @return A session token URL that redirects to the target URL, or null if not available
     */
    String getSessionToken(String userId, String targetUrl);

    /**
     * Checks if this service has valid credentials for the user.
     *
     * @param userId The Canvas user ID to check
     * @return true if the service can make API calls for this user
     */
    boolean hasValidCredentials(String userId);

    /**
     * Clear any cached credentials for a user.
     *
     * @param userId The Canvas user ID, or null to clear all credentials
     */
    void clearCredentials(String userId);

    /**
     * Makes a direct API request to the Canvas API.
     * This is a utility method for debugging API access.
     *
     * @param path The API path to request
     * @param accessToken The access token to use
     * @return The response as a map
     */
    default Map<String, Object> makeApiRequest(String path, String accessToken) {
        throw new UnsupportedOperationException("makeApiRequest is not implemented in this service");
    }

    /**
     * Makes a token request to the specified URL with the given parameters.
     * This is a utility method for debugging token acquisition.
     *
     * @param tokenUrl The token URL to request from
     * @param params The parameters to include in the request
     * @return The response as a map
     */
    default Map<String, Object> makeTokenRequest(String tokenUrl, Map<String, String> params) {
        throw new UnsupportedOperationException("makeTokenRequest is not implemented in this service");
    }

    /**
     * Gets an access token using a specific scope.
     * This method is exposed for debugging purposes.
     *
     * @param userId The user ID for token caching
     * @param scope The scope to request
     * @return The access token, or null if not obtained
     */
    default String getAccessTokenWithScope(String userId, String scope) {
        throw new UnsupportedOperationException("getAccessTokenWithScope is not implemented in this service");
    }

    /**
     * Builds a properly formatted API path.
     * This is a public utility method for debug controllers.
     *
     * @param path The API path to format
     * @return The formatted API path
     */
    default String buildApiPathPublic(String path) {
        throw new UnsupportedOperationException("buildApiPathPublic is not implemented in this service");
    }
}