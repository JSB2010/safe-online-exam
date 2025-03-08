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
 * Service for handling Cloud Run deployment details.
 * This service ensures that Cloud Run deployments are properly configured
 * by updating secrets with current deployment URLs.
 *
 * Only active in dev and prod profiles, not in test.
 */
@Service
@Slf4j
@Profile({"dev", "prod"})
public class CloudRunDeploymentService {

    private final SecretManagerService secretManagerService;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @Value("${spring.cloud.gcp.project-id:}")
    private String projectId;

    /**
     * Constructor for CloudRunDeploymentService.
     *
     * @param secretManagerService Service to access secrets from GCP Secret Manager
     */
    @Autowired
    public CloudRunDeploymentService(SecretManagerService secretManagerService) {
        this.secretManagerService = secretManagerService;
    }

    /**
     * Listens for application startup and updates deployment information.
     * In Cloud Run, the service URL is available via environment variables.
     * This method extracts those values and updates the tool URL in Secret Manager.
     */
    @EventListener(ApplicationStartedEvent.class)
    public void updateDeploymentInfo() {
        // Check if we're running in Cloud Run
        String k8sService = System.getenv("K_SERVICE");
        String k8sRevision = System.getenv("K_REVISION");

        if (k8sService != null && k8sRevision != null) {
            log.info("Detected Cloud Run environment. Service: {}, Revision: {}", k8sService, k8sRevision);

            // Get the service URL from environment variables or construct it
            String serviceUrl = determineServiceUrl(k8sService);

            if (serviceUrl != null && !serviceUrl.isEmpty()) {
                log.info("Cloud Run service URL: {}", serviceUrl);

                // Update the tool URL in Secret Manager
                try {
                    String toolUrlSecret = activeProfile.equals("prod") ? "prod_tool_url" : "dev_tool_url";
                    boolean updated = secretManagerService.updateSecret(toolUrlSecret, serviceUrl);
                    if (updated) {
                        log.info("Successfully updated Tool URL in Secret Manager: {}", serviceUrl);
                    } else {
                        log.warn("Failed to update Tool URL secret in Secret Manager");
                    }
                } catch (IOException e) {
                    log.error("Error updating Tool URL in Secret Manager", e);
                }

                // Log important details for verification
                logDeploymentDetails(serviceUrl);
            } else {
                log.warn("Could not determine service URL for Cloud Run deployment");
            }
        } else {
            log.info("Not running in Cloud Run environment, skipping deployment updates");
        }
    }

    /**
     * Determines the service URL based on the Cloud Run service name.
     *
     * @param serviceName The Cloud Run service name
     * @return The complete service URL
     */
    private String determineServiceUrl(String serviceName) {
        // Check for explicit SERVICE_URL environment variable
        String manualServiceUrl = System.getenv("SERVICE_URL");
        if (manualServiceUrl != null && !manualServiceUrl.isEmpty()) {
            log.info("Using explicit SERVICE_URL from environment: {}", manualServiceUrl);
            return manualServiceUrl;
        }

        // Get the GCP region from environment variables
        String region = System.getenv("GOOGLE_CLOUD_REGION");
        if (region == null || region.isEmpty()) {
            // Cloud Run sets K_REGION
            region = System.getenv("K_REGION");
        }

        if (region == null || region.isEmpty()) {
            region = "us-central1"; // Default region as fallback
        }

        // Check if we have a project ID
        if (projectId != null && !projectId.isEmpty()) {
            // Standard format for Cloud Run URLs
            String cloudRunUrl = "https://" + serviceName + "-" + region + ".run.app";
            log.info("Constructed Cloud Run URL: {}", cloudRunUrl);
            return cloudRunUrl;
        }

        // Try to get the hostname as a last resort
        try {
            String hostName = InetAddress.getLocalHost().getHostName();
            if (hostName != null && !hostName.isEmpty()) {
                String url = "https://" + hostName;
                log.info("Using hostname for URL: {}", url);
                return url;
            }
        } catch (UnknownHostException e) {
            log.warn("Could not determine hostname", e);
        }

        log.error("Could not determine service URL for Cloud Run");
        return null;
    }

    /**
     * Logs important deployment details for verification.
     *
     * @param serviceUrl The determined service URL
     */
    private void logDeploymentDetails(String serviceUrl) {
        log.info("================================================");
        log.info("CLOUD RUN DEPLOYMENT DETAILS:");
        log.info("Service URL: {}", serviceUrl);
        log.info("Active Profile: {}", activeProfile);
        log.info("GCP Project ID: {}", projectId);
        log.info("LTI Login Endpoint: {}/lti/login", serviceUrl);
        log.info("LTI Launch Endpoint: {}/lti/launch", serviceUrl);
        log.info("================================================");

        // Generate reminder about Canvas configuration
        log.info("REMINDER: Ensure your Canvas LTI developer key uses these URLs:");
        log.info("target_link_uri: {}/lti/launch", serviceUrl);
        log.info("oidc_initiation_url: {}/lti/login", serviceUrl);
        log.info("================================================");
    }
}