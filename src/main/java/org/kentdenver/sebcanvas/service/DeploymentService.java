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
        // Strategy 1: Check for manually set URL in environment
        String manualServiceUrl = System.getenv("SERVICE_URL");
        if (manualServiceUrl != null && !manualServiceUrl.isEmpty()) {
            log.info("Using SERVICE_URL environment variable: {}", manualServiceUrl);
            return manualServiceUrl;
        }

        // Strategy 2: Construct URL based on Cloud Run service name and region
        // Get the GCP region
        String region = System.getenv("GOOGLE_CLOUD_REGION");
        if (region == null || region.isEmpty()) {
            region = "us-central1"; // Default region
        }

        // Check if we have a project ID
        if (projectId != null && !projectId.isEmpty()) {
            // Standard format for Cloud Run URLs
            String cloudRunUrl = "https://" + serviceName + "-" + region + ".run.app";
            log.info("Constructed Cloud Run URL: {}", cloudRunUrl);
            return cloudRunUrl;
        }

        // Strategy 3: Try to get the hostname from the system
        try {
            String hostName = InetAddress.getLocalHost().getHostName();
            if (hostName != null && !hostName.isEmpty()) {
                String url = "https://" + hostName;
                log.info("Using system hostname for URL: {}", url);
                return url;
            }
        } catch (UnknownHostException e) {
            log.warn("Could not determine hostname", e);
        }

        log.error("All strategies failed to determine service URL");
        return null;
    }
}
