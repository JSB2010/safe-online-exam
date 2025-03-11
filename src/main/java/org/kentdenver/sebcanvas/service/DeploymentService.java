package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationStartedEvent;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.io.IOException;

/**
 * Service that handles post-deployment tasks.
 *
 * @deprecated This service previously generated and updated URLs in Secret Manager.
 * Now the application uses the URL stored in secrets instead of generating one.
 */
@Service
@Slf4j
@Profile({"dev", "prod"})
@Deprecated
public class DeploymentService {

    private final SecretManagerService secretManagerService;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    /**
     * Constructor for DeploymentService.
     *
     * @param secretManagerService Service to access secrets from GCP Secret Manager
     */
    @Autowired
    public DeploymentService(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
        log.info("DeploymentService initialized");
    }

    /**
     * Listens for application startup and logs the current tool URL from secrets.
     * This method no longer attempts to generate or update the tool URL.
     */
    @EventListener(ApplicationStartedEvent.class)
    public void updateToolUrlAfterDeployment() {
        // Check if we're running in Cloud Run
        String k8sService = System.getenv("K_SERVICE");

        if (k8sService != null && !k8sService.isEmpty()) {
            log.info("Detected Cloud Run environment. Service: {}", k8sService);
            log.info("Using tool URL from Secret Manager - not attempting to generate or update URL");

            // Log the configured tool URL for verification
            try {
                String toolUrlSecret = activeProfile.equals("prod") ? "prod_tool_url" : "dev_tool_url";
                String toolUrl = secretManagerService.getSecret(toolUrlSecret, "latest");
                log.info("Current tool URL in Secret Manager: {}", toolUrl);
            } catch (IOException e) {
                log.error("Error reading tool URL from Secret Manager", e);
            }
        } else {
            log.info("Not running in Cloud Run environment, no URL updates needed");
        }
    }
}
