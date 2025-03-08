package org.kentdenver.sebcanvas.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationStartedEvent;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;

/**
 * Service that handles post-deployment tasks like updating the Tool URL in Secret Manager.
 * Only active in dev and prod profiles, not in test.
 */
@Service
@Slf4j
@Profile({"dev", "prod"})
public class DeploymentService {

    private final SecretManagerService secretManagerService;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    @Autowired
    public DeploymentService(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
    }

    /**
     * Listens for application startup and attempts to update the tool URL in Secret Manager.
     * In Cloud Run, the service URL is available via environment variables.
     */
    @EventListener(ApplicationStartedEvent.class)
    public void updateToolUrlAfterDeployment() {
        // Check if we're running in Cloud Run
        String k8sService = System.getenv("K_SERVICE");

        if (k8sService != null && !k8sService.isEmpty()) {
            log.info("Detected Cloud Run environment. Service: {}", k8sService);

            // Get the service URL from environment variables or construct it
            String serviceUrl = determineServiceUrl(k8sService);

            if (serviceUrl != null && !serviceUrl.isEmpty()) {
                log.info("Updating Tool URL to: {}", serviceUrl);
                try {
                    // Determine which secret to update based on the active profile
                    String toolUrlSecret = activeProfile.equals("prod") ? "prod_tool_url" : "dev_tool_url";
                    boolean updated = secretManagerService.updateSecret(toolUrlSecret, serviceUrl);
                    if (updated) {
                        log.info("Successfully updated Tool URL secret in Secret Manager");
                    } else {
                        log.warn("Failed to update Tool URL secret");
                    }
                } catch (IOException e) {
                    log.error("Error updating Tool URL secret", e);
                }
            } else {
                log.warn("Could not determine service URL for updating Tool URL secret");
            }
        } else {
            log.info("Not running in Cloud Run environment, skipping Tool URL update");
        }
    }

    /**
     * Determines the service URL based on the Cloud Run service name.
     * This method tries multiple strategies to determine the URL:
     * 1. Check for an explicit SERVICE_URL environment variable
     * 2. Use the K_SERVICE and Google Cloud region to construct the URL
     * 3. Try to get the host name from the system
     *
     * @param serviceName The Cloud Run service name
     * @return The service URL
     */
    private String determineServiceUrl(String serviceName) {
        // Check for explicit SERVICE_URL environment variable
        String manualServiceUrl = System.getenv("SERVICE_URL");
        if (manualServiceUrl != null && !manualServiceUrl.isEmpty()) {
            log.info("Using explicit SERVICE_URL from environment: {}", manualServiceUrl);
            // Ensure HTTPS protocol
            if (!manualServiceUrl.startsWith("https://")) {
                manualServiceUrl = "https://" + manualServiceUrl.replaceFirst("^http://", "");
                log.info("Converted service URL to HTTPS: {}", manualServiceUrl);
            }
            return manualServiceUrl;
        }

        // Use K_SERVICE environment variable directly to ensure we get the full hostname
        // K_SERVICE is always set in Cloud Run environment
        String k8sService = System.getenv("K_SERVICE");

        // Retrieve the actual URL from the environment
        // This environment variable is set by Cloud Run and includes the project ID in the URL
        String rawUrl = System.getenv("CLOUD_RUN_CONTAINER_URL");
        if (rawUrl != null && !rawUrl.isEmpty()) {
            // Ensure HTTPS protocol
            if (!rawUrl.startsWith("https://")) {
                rawUrl = "https://" + rawUrl.replaceFirst("^http://", "");
            }
            log.info("Using CLOUD_RUN_CONTAINER_URL: {}", rawUrl);
            return rawUrl;
        }

        // Fallback: Construct URL using service name, project ID and region
        String region = System.getenv("K_REGION") != null ? System.getenv("K_REGION") : "us-central1";
        String projectId = this.projectId != null ? this.projectId : "securityapis";

        // Include the project ID in the URL to match the actual deployment URL
        String cloudRunUrl = "https://" + serviceName + "-" + projectId + "." + region + ".run.app";
        log.info("Constructed Cloud Run URL with project ID: {}", cloudRunUrl);
        return cloudRunUrl;
    }
}
