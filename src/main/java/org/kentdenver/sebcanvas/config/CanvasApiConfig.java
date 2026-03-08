package org.kentdenver.sebcanvas.config;

import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.service.SecretManagerService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration for Canvas API OAuth2 integration.
 * This class handles loading credentials from Secret Manager and making them available
 * to the OAuth2ClientConfig class.
 *
 * The critical configuration values like clientId, clientSecret, and redirectUri
 * are loaded from Secret Manager or environment variables to ensure they're available
 * at runtime without requiring them in the application properties.
 */
@Configuration
@Slf4j
@Getter
public class CanvasApiConfig {

    @Value("${canvas.api.baseUrl}")
    private String apiBaseUrl;

    @Value("${canvas.api.redirect-uri:}")
    private String redirectUri;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    // Client credentials loaded from Secret Manager
    private String clientId;
    private String clientSecret;

    private final SecretManagerService secretManagerService;

    @Autowired
    public CanvasApiConfig(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
        // Set initial default values
        this.clientId = "";
        this.clientSecret = "";
        this.redirectUri = "";
    }

    /**
     * Initializes the configuration by loading secrets from Secret Manager
     * and validating required properties.
     */
    @PostConstruct
    public void init() {
        log.info("Initializing Canvas API OAuth2 configuration");

        // Load client credentials from Secret Manager
        loadSecrets();

        // Ensure we have a valid redirect URI
        ensureRedirectUri();

        // Validate configuration
        log.info("Canvas API OAuth2 configuration initialized with the following values:");
        log.info("API Base URL: {}", apiBaseUrl);
        log.info("Redirect URI: {}", redirectUri);

        // Log client ID (partially masked) if available
        if (clientId != null && !clientId.isEmpty()) {
            // Mask most of the client ID for security
            String maskedId = clientId;
            if (clientId.length() > 8) {
                maskedId = clientId.substring(0, 4) + "..." +
                        clientId.substring(clientId.length() - 4);
            }
            log.info("Client ID: {}", maskedId);
        } else {
            log.warn("Client ID is not set! OAuth2 flows will not work.");
        }

        // Check client secret (without revealing it)
        if (clientSecret == null || clientSecret.isEmpty()) {
            log.warn("Client Secret is not set! OAuth2 flows will not work.");
        } else {
            log.info("Client Secret: [SECURED]");
        }
    }

    /**
     * Ensures we have a valid redirect URI by:
     * 1. Using the property value if available
     * 2. Generating from tool URL if available in Secret Manager
     * 3. Creating a fallback value based on API URL if neither is available
     */
    private void ensureRedirectUri() {
        // If redirect URI is already set in properties, use it
        if (redirectUri != null && !redirectUri.isEmpty()) {
            redirectUri = sanitizeUrl(redirectUri);
            log.info("Using redirect URI from properties: {}", redirectUri);
            return;
        }

        log.warn("Redirect URI is not set in properties. Attempting to derive it...");

        String toolUrl = resolveToolUrl();
        if (toolUrl != null && !toolUrl.isBlank()) {
            this.redirectUri = toolUrl + "/api/oauth2callback";
            log.info("Derived redirect URI from tool URL: {}", this.redirectUri);
            return;
        }

        log.error("Canvas OAuth redirect URI is not configured and could not be derived from tool URL settings");
        this.redirectUri = "";
    }

    /**
     * Loads client credentials from Secret Manager.
     * Falls back to environment variables if Secret Manager fails.
     */
    private void loadSecrets() {
        // Use dedicated API client ID for OAuth API calls (it has full Canvas API scopes)
        String clientIdSecretName = activeProfile.equals("prod") ?
                "prod_api_client_id" : "dev_api_client_id";
        String clientSecretSecretName = activeProfile.equals("prod") ?
                "prod_api_client_secret" : "dev_api_client_secret";

        try {
            log.info("Attempting to load Canvas API OAuth2 secrets from Secret Manager");
            log.info("Using dedicated API client ID for OAuth API calls (it has full Canvas API scopes)");

            // Load client ID
            String loadedClientId = secretManagerService.getSecret(clientIdSecretName, "latest");
            if (loadedClientId != null && !loadedClientId.isEmpty()) {
                this.clientId = loadedClientId;
                log.info("Successfully loaded Canvas API client ID from Secret Manager");
            } else {
                log.warn("Canvas API client ID not found in Secret Manager, checking environment");
                loadClientIdFromEnvironment();
            }

            // Load client secret
            String loadedClientSecret = secretManagerService.getSecret(clientSecretSecretName, "latest");
            if (loadedClientSecret != null && !loadedClientSecret.isEmpty()) {
                this.clientSecret = loadedClientSecret;
                log.info("Successfully loaded Canvas API client secret from Secret Manager");
            } else {
                log.warn("Canvas API client secret not found in Secret Manager, checking environment");
                loadClientSecretFromEnvironment();
            }
        } catch (Exception e) {
            log.error("Error accessing Secret Manager", e);
            log.info("Falling back to environment variables for Canvas API OAuth2 credentials");
            loadFromEnvironment();
        }
    }

    /**
     * Loads both client ID and client secret from environment variables.
     */
    private void loadFromEnvironment() {
        loadClientIdFromEnvironment();
        loadClientSecretFromEnvironment();
    }

    /**
     * Loads the client ID from environment variables.
     * Tries various naming patterns to be flexible.
     */
    private void loadClientIdFromEnvironment() {
        // Try various patterns for environment variable names (prioritize API client ID)
        String[] patterns = {
                activeProfile.equals("prod") ? "PROD_API_CLIENT_ID" : "DEV_API_CLIENT_ID",
                activeProfile.equals("prod") ? "prod_api_client_id" : "dev_api_client_id",
                "CANVAS_API_CLIENT_ID",
                "canvas_api_client_id",
                activeProfile.equals("prod") ? "PROD_LTI_CLIENT_ID" : "DEV_LTI_CLIENT_ID",
                activeProfile.equals("prod") ? "prod_lti_client_id" : "dev_lti_client_id"
        };

        for (String pattern : patterns) {
            String envValue = System.getenv(pattern);
            if (envValue != null && !envValue.isEmpty()) {
                this.clientId = envValue;
                log.info("Loaded Canvas API client ID from environment variable: {}", pattern);
                return;
            }
        }

        log.warn("Could not find Canvas API client ID in environment variables");
    }

    /**
     * Loads the client secret from environment variables.
     * Tries various naming patterns to be flexible.
     */
    private void loadClientSecretFromEnvironment() {
        // Try various patterns for environment variable names
        String[] patterns = {
                "CANVAS_API_CLIENT_SECRET",
                activeProfile.equals("prod") ? "PROD_API_CLIENT_SECRET" : "DEV_API_CLIENT_SECRET",
                "canvas_api_client_secret",
                activeProfile.equals("prod") ? "prod_api_client_secret" : "dev_api_client_secret"
        };

        for (String pattern : patterns) {
            String envValue = System.getenv(pattern);
            if (envValue != null && !envValue.isEmpty()) {
                this.clientSecret = envValue;
                log.info("Loaded Canvas API client secret from environment variable: {}", pattern);
                return;
            }
        }

        log.warn("Could not find Canvas API client secret in environment variables");
    }

    /**
     * Extracts the Canvas domain from the API base URL.
     * This is used for building OAuth endpoints.
     */
    public String getCanvasDomain() {
        // Assuming apiBaseUrl is something like https://kentdenver.instructure.com/api/v1
        String domain = apiBaseUrl;

        // Remove the /api/v1 part if present
        if (domain.endsWith("/api/v1")) {
            domain = domain.substring(0, domain.length() - 7);
        }

        return domain;
    }

    public String getApplicationBaseUrl() {
        if (redirectUri == null || redirectUri.isBlank()) {
            return "";
        }

        if (redirectUri.endsWith("/api/oauth2callback")) {
            return redirectUri.substring(0, redirectUri.length() - "/api/oauth2callback".length());
        }

        return sanitizeUrl(redirectUri);
    }

    private String resolveToolUrl() {
        try {
            String toolUrl = secretManagerService.getSecret(
                    activeProfile.equals("prod") ? "prod_tool_url" : "dev_tool_url", "latest");
            if (toolUrl != null && !toolUrl.isBlank()) {
                return sanitizeUrl(toolUrl);
            }
        } catch (Exception e) {
            log.error("Error accessing tool URL from Secret Manager", e);
        }

        String[] envNames = {
                "TOOL_URL",
                activeProfile.equals("prod") ? "PROD_TOOL_URL" : "DEV_TOOL_URL",
                "SERVICE_URL"
        };

        for (String envName : envNames) {
            String value = System.getenv(envName);
            if (value != null && !value.isBlank()) {
                return sanitizeUrl(value);
            }
        }

        return "";
    }

    private String sanitizeUrl(String url) {
        String sanitized = url.trim();
        if (sanitized.endsWith("/")) {
            sanitized = sanitized.substring(0, sanitized.length() - 1);
        }
        if (!sanitized.startsWith("https://") && !sanitized.contains("localhost")) {
            sanitized = "https://" + sanitized.replaceFirst("^http://", "");
        }
        return sanitized;
    }
}