package org.kentdenver.sebcanvas.config;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

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
     */
    @Value("${lti.clientId}")
    private String clientId;

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
     * Used for constructing redirect URIs during the LTI flow.
     */
    @Value("${lti.toolUrl}")
    private String toolUrl;

    /**
     * The deployment ID for this tool.
     * May be different for each installation of the tool.
     */
    @Value("${lti.deploymentId:}")
    private String deploymentId;

    /**
     * Initializes the LTI configuration and logs the values.
     * This helps with debugging LTI integration issues.
     */
    public void init() {
        log.info("LTI configuration initialized:");
        log.info("Issuer: {}", issuer);
        log.info("Client ID: {}", clientId);
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
}