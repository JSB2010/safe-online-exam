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
 * Service for handling Cloud Run deployment details.
 *
 * @deprecated This service previously generated and updated Cloud Run URLs.
 * Now the application uses the URL stored in secrets instead of generating one.
 */
@Service
@Slf4j
@Profile({"dev", "prod"})
@Deprecated
public class CloudRunDeploymentService {

    private final SecretManagerService secretManagerService;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    /**
     * Constructor for CloudRunDeploymentService.
     *
     * @param secretManagerService Service to access secrets from GCP Secret Manager
     */
    @Autowired
    public CloudRunDeploymentService(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
        log.info("CloudRunDeploymentService initialized");
    }

    /**
     * Listens for application startup and logs the current tool URL from secrets.
     * This method no longer attempts to generate or update the Cloud Run URL.
     */
    @EventListener(ApplicationStartedEvent.class)
    public void updateDeploymentInfo() {
        // Check if we're running in Cloud Run
        String k8sService = System.getenv("K_SERVICE");
        String k8sRevision = System.getenv("K_REVISION");

        if (k8sService != null && k8sRevision != null) {
            log.info("Detected Cloud Run environment. Service: {}, Revision: {}", k8sService, k8sRevision);
            log.info("Using tool URL from Secret Manager - not attempting to generate or update URL");

            // Log the configured tool URL for verification
            try {
                String toolUrlSecret = activeProfile.equals("prod") ? "prod_tool_url" : "dev_tool_url";
                String toolUrl = secretManagerService.getSecret(toolUrlSecret, "latest");
                log.info("Current tool URL in Secret Manager: {}", toolUrl);

                // Log important deployment information
                log.info("================================================");
                log.info("CLOUD RUN DEPLOYMENT DETAILS:");
                log.info("Service: {}", k8sService);
                log.info("Revision: {}", k8sRevision);
                log.info("Active Profile: {}", activeProfile);
                log.info("Tool URL from Secret Manager: {}", toolUrl);
                log.info("================================================");
            } catch (IOException e) {
                log.error("Error reading tool URL from Secret Manager", e);
            }
        } else {
            log.info("Not running in Cloud Run environment, skipping deployment info check");
        }
    }
}
