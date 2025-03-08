package org.kentdenver.sebcanvas.config;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.service.SecretManagerService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;

import java.io.IOException;

/**
 * Configuration for LTI 1.3 integration with Canvas.
 * Contains all necessary endpoints and identifiers for the LTI flow.
 *
 * The @Getter annotation ensures all private fields have getter methods automatically generated.
 * This addresses the compilation errors related to missing getters.
 */
@Configuration
@Slf4j
@Getter
public class LtiConfig {

    /**
     * The issuer identifier for Canvas.
     * This is always https://canvas.instructure.com regardless of the institution's Canvas domain.
     */
    @Value("${lti.issuer:https://canvas.instructure.com}")
    private String issuer;

    /**
     * The client ID from the Canvas Developer Key.
     * Loaded from Secret Manager or environment variable.
     */
    private String clientId;

    /**
     * The URL to the Canvas JSON Web Key Set (JWKS).
     * Used to verify JWT tokens from Canvas.
     */
    @Value("${lti.keySetUrl:https://sso.canvaslms.com/api/lti/security/jwks}")
    private String keySetUrl;

    /**
     * The URL to the Canvas OAuth2 token endpoint.
     * Used for obtaining access tokens for Canvas API services.
     */
    @Value("${lti.tokenUrl:https://sso.canvaslms.com/login/oauth2/token}")
    private String tokenUrl;

    /**
     * The URL to the Canvas OpenID Connect authorization endpoint.
     * Used during the LTI launch flow for authentication.
     */
    @Value("${lti.authUrl:https://sso.canvaslms.com/api/lti/authorize_redirect}")
    private String authUrl;

    /**
     * The base URL of this tool.
     * Loaded from Secret Manager or environment variable.
     */
    private String toolUrl;

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

    /**
     * Constructor with dependency injection for SecretManagerService.
     * Sets default values for clientId and toolUrl.
     *
     * @param secretManagerService Service to access secrets from Secret Manager
     */
    @Autowired
    public LtiConfig(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
        // Set default values
        this.clientId = "lti-client-id-placeholder";
        this.toolUrl = "http://localhost:8080";
    }

    /**
     * Initializes the LTI configuration by loading secrets from Secret Manager.
     * This method is automatically called after application startup.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void init() {
        // Try to load secrets from Secret Manager
        loadSecrets();

        log.info("LTI configuration initialized:");
        log.info("Issuer: {}", issuer);
        log.info("Key Set URL: {}", keySetUrl);
        log.info("Token URL: {}", tokenUrl);
        log.info("Auth URL: {}", authUrl);
        log.info("Tool URL: {}", toolUrl);

        if ("lti-client-id-placeholder".equals(clientId)) {
            log.warn("Using placeholder client ID - this is not suitable for production!");
        } else {
            log.info("Client ID: {}", clientId);
        }

        if (deploymentId != null && !deploymentId.isEmpty()) {
            log.info("Deployment ID: {}", deploymentId);
        } else {
            log.info("No deployment ID configured - will use deployment ID from launch");
        }
    }

    /**
     * Loads secrets from Secret Manager or environment variables.
     * Follows a consistent naming convention for secrets based on the active profile.
     */
    private void loadSecrets() {
        // Determine secret names based on active profile
        String ltiClientIdSecret = activeProfile.equals("prod") ? "prod_lti_client_id" : "dev_lti_client_id";
        String toolUrlSecret = activeProfile.equals("prod") ? "prod_tool_url" : "dev_tool_url";

        try {
            // Load LTI Client ID from Secret Manager or fallback to environment variable
            String loadedClientId = secretManagerService.getSecret(ltiClientIdSecret, "latest");
            if (loadedClientId != null && !loadedClientId.isEmpty()) {
                this.clientId = loadedClientId;
                log.info("Loaded LTI Client ID from Secret Manager");
            } else {
                log.warn("LTI Client ID not found in Secret Manager, checking environment");
                loadClientIdFromEnvironment();
            }

            // Load Tool URL from Secret Manager or fallback to environment variable
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
            log.info("Falling back to environment variables");
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
     * Checks both standard and uppercase variable names.
     */
    private void loadClientIdFromEnvironment() {
        String envClientId = System.getenv("LTI_CLIENT_ID");
        if (envClientId == null || envClientId.isEmpty()) {
            // Try alternate environment variable format
            envClientId = System.getenv("PROD_LTI_CLIENT_ID");
            if (activeProfile.equals("dev")) {
                envClientId = System.getenv("DEV_LTI_CLIENT_ID");
            }
        }

        if (envClientId != null && !envClientId.isEmpty()) {
            this.clientId = envClientId;
            log.info("Loaded LTI Client ID from environment");
        }
    }

    /**
     * Loads the Tool URL from environment variables.
     * Checks both standard and profile-specific variable names.
     */
    private void loadToolUrlFromEnvironment() {
        String envToolUrl = System.getenv("TOOL_URL");
        if (envToolUrl == null || envToolUrl.isEmpty()) {
            // Try alternate environment variable format
            envToolUrl = System.getenv("PROD_TOOL_URL");
            if (activeProfile.equals("dev")) {
                envToolUrl = System.getenv("DEV_TOOL_URL");
            }
        }

        if (envToolUrl != null && !envToolUrl.isEmpty()) {
            this.toolUrl = envToolUrl;
            log.info("Loaded Tool URL from environment: {}", toolUrl);
        } else {
            log.info("Using default Tool URL: {}", toolUrl);
        }
    }
}