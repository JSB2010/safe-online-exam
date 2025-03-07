package org.kentdenver.sebcanvas.config;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.service.SecretManagerService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;

/**
 * Configuration for LTI 1.3 integration with Canvas.
 * Contains all necessary endpoints and identifiers for the LTI flow.
 */
@Configuration
@Slf4j
@Getter
public class LtiConfig {

    /**
     * The issuer identifier for Canvas.
     * This is always https://canvas.instructure.com regardless of the institution's Canvas domain.
     */
    @Value("${lti.issuer}")
    private String issuer;

    /**
     * The client ID from the Canvas Developer Key.
     * Now loaded from Secret Manager.
     */
    private String clientId = "lti-client-id-placeholder";

    /**
     * The URL to the Canvas JSON Web Key Set (JWKS).
     * Used to verify JWT tokens from Canvas.
     */
    @Value("${lti.keySetUrl}")
    private String keySetUrl;

    /**
     * The URL to the Canvas OAuth2 token endpoint.
     * Used for obtaining access tokens for Canvas API services.
     */
    @Value("${lti.tokenUrl}")
    private String tokenUrl;

    /**
     * The URL to the Canvas OpenID Connect authorization endpoint.
     * Used during the LTI launch flow for authentication.
     */
    @Value("${lti.authUrl}")
    private String authUrl;

    /**
     * The base URL of this tool.
     * Now loaded from Secret Manager.
     */
    private String toolUrl = "http://localhost:8080";

    /**
     * The deployment ID for this tool.
     * May be different for each installation of the tool.
     */
    @Value("${lti.deploymentId:}")
    private String deploymentId;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    private final SecretManagerService secretManagerService;

    @Autowired
    public LtiConfig(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
    }

    /**
     * Initializes the LTI configuration and logs the values.
     * Now loads secrets from Secret Manager when available.
     */
    public void init() {
        // Try to load secrets from Secret Manager
        loadSecrets();

        log.info("LTI configuration initialized:");
        log.info("Issuer: {}", issuer);

        if ("lti-client-id-placeholder".equals(clientId)) {
            log.warn("Using placeholder client ID - this is not suitable for production!");
        } else {
            log.info("Client ID: {}", clientId);
        }

        log.info("Key Set URL: {}", keySetUrl);
        log.info("Token URL: {}", tokenUrl);
        log.info("Auth URL: {}", authUrl);
        log.info("Tool URL: {}", toolUrl);

        if (deploymentId != null && !deploymentId.isEmpty()) {
            log.info("Deployment ID: {}", deploymentId);
        } else {
            log.info("No deployment ID configured - will use deployment ID from launch");
        }
    }

    /**
     * Loads secrets from Secret Manager.
     * Falls back to environment variables if secrets are not available.
     */
    private void loadSecrets() {
        if (projectId == null || projectId.isEmpty()) {
            log.warn("GCP project ID not set. Falling back to environment variables.");
            loadFromEnvironment();
            return;
        }

        try {
            // Determine secret names based on active profile
            String ltiClientIdSecret = activeProfile.equals("prod") ? "prod_lti_client_id" : "dev_lti_client_id";
            String toolUrlSecret = activeProfile.equals("prod") ? "prod_tool_url" : "dev_tool_url";

            // Load LTI Client ID
            String loadedClientId = secretManagerService.getSecret(ltiClientIdSecret, "latest");
            if (loadedClientId != null && !loadedClientId.isEmpty()) {
                this.clientId = loadedClientId;
                log.info("Loaded LTI Client ID from Secret Manager");
            } else {
                log.warn("LTI Client ID not found in Secret Manager, checking environment");
                loadClientIdFromEnvironment();
            }

            // Load Tool URL
            String loadedToolUrl = secretManagerService.getSecret(toolUrlSecret, "latest");
            if (loadedToolUrl != null && !loadedToolUrl.isEmpty()) {
                this.toolUrl = loadedToolUrl;
                log.info("Loaded Tool URL from Secret Manager: {}", toolUrl);
            } else {
                log.warn("Tool URL not found in Secret Manager, checking environment");
                loadToolUrlFromEnvironment();
            }
        } catch (IOException e) {
            log.error("Error accessing Secret Manager", e);
            loadFromEnvironment();
        }
    }

    /**
     * Loads configuration from environment variables.
     */
    private void loadFromEnvironment() {
        loadClientIdFromEnvironment();
        loadToolUrlFromEnvironment();
    }

    /**
     * Loads the LTI Client ID from environment variables.
     */
    private void loadClientIdFromEnvironment() {
        String envClientId = System.getenv("LTI_CLIENT_ID");
        if (envClientId != null && !envClientId.isEmpty()) {
            this.clientId = envClientId;
            log.info("Loaded LTI Client ID from environment");
        }
    }

    /**
     * Loads the Tool URL from environment variables.
     */
    private void loadToolUrlFromEnvironment() {
        String envToolUrl = System.getenv("TOOL_URL");
        if (envToolUrl != null && !envToolUrl.isEmpty()) {
            this.toolUrl = envToolUrl;
            log.info("Loaded Tool URL from environment: {}", toolUrl);
        } else {
            log.info("Using default Tool URL: {}", toolUrl);
        }
    }
}
