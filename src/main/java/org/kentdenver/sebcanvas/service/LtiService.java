package org.kentdenver.sebcanvas.service;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSObject;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.text.ParseException;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Service for handling LTI 1.3 authentication and token validation.
 * Implements the OpenID Connect validation flow according to the Canvas LTI documentation.
 */
@Service
@Slf4j
public class LtiService {

    // Constant for JWK refresh interval (24 hours)
    private static final long JWK_REFRESH_INTERVAL = TimeUnit.HOURS.toMillis(24);

    private final LtiConfig ltiConfig;
    private final RestTemplate restTemplate;
    private JWKSet jwkSet;
    private final JwkService jwkService;
    private long jwkSetLastRefreshed = 0;

    /**
     * Constructor that initializes the JWKSet from the Canvas JWKS URL.
     * Uses the URL from the LtiConfig.
     *
     * @param ltiConfig Configuration for LTI connections
     * @param restTemplate RestTemplate for HTTP requests
     * @param jwkService Service for managing JWKs
     * @throws RuntimeException If there's an error loading the JWK Set
     */
    @Autowired
    public LtiService(LtiConfig ltiConfig, RestTemplate restTemplate, JwkService jwkService) {
        this.ltiConfig = ltiConfig;
        this.restTemplate = restTemplate;
        this.jwkService = jwkService;

        // Load the JWK Set from Canvas
        refreshJwkSet();
    }

    /**
     * Refreshes the JWKSet from Canvas.
     * This is important to handle key rotations.
     */
    @Scheduled(fixedRate = 86400000) // 24 hours in milliseconds
    public void refreshJwkSet() {
        try {
            URI jwksUri = new URI(ltiConfig.getKeySetUrl());
            this.jwkSet = JWKSet.load(jwksUri.toURL());
            this.jwkSetLastRefreshed = System.currentTimeMillis();
            log.info("Successfully loaded JWK Set from {}", ltiConfig.getKeySetUrl());
        } catch (IOException | ParseException | URISyntaxException e) {
            log.error("Failed to load JWK Set from {}", ltiConfig.getKeySetUrl(), e);
            throw new RuntimeException("Failed to initialize JWK Set", e);
        }
    }

    /**
     * Validates an LTI 1.3 JWT token according to the Canvas LTI documentation.
     *
     * @param token The JWT token from Canvas
     * @param expectedNonce The nonce that should be in the token (for security)
     * @return The LTI launch data extracted from the token
     * @throws ParseException If there's an error parsing the token
     * @throws JOSEException If there's an error validating the token signature
     */
    @SuppressWarnings("unchecked")
    public LtiLaunchData validateToken(String token, String expectedNonce) throws ParseException, JOSEException {
        // Check if JWK Set needs refreshing (older than 24 hours)
        if (System.currentTimeMillis() - jwkSetLastRefreshed > JWK_REFRESH_INTERVAL) {
            log.debug("JWK Set is stale, refreshing from Canvas");
            refreshJwkSet();
        }

        // Parse the JWT
        JWSObject jwsObject = JWSObject.parse(token);

        // Get the key ID from the header
        String keyId = jwsObject.getHeader().getKeyID();
        log.debug("Token key ID: {}", keyId);

        // Find the key with the matching ID
        JWK jwk = jwkSet.getKeyByKeyId(keyId);
        if (jwk == null) {
            throw new JOSEException("Key not found: " + keyId);
        }

        // Verify the signature
        JWSVerifier verifier = new RSASSAVerifier((RSAKey) jwk);
        boolean verified = jwsObject.verify(verifier);
        if (!verified) {
            throw new JOSEException("Invalid token signature");
        }

        // Extract claims
        Map<String, Object> claims = jwsObject.getPayload().toJSONObject();

        // Log all claims for debugging (be careful with sensitive data)
        log.debug("LTI Token Claims Debug:");
        for (Map.Entry<String, Object> entry : claims.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            // Don't log sensitive information
            if (key.contains("email") || key.contains("name") || key.equals("sub")) {
                log.debug("  {}: [REDACTED]", key);
            } else {
                log.debug("  {}: {}", key, value);
            }
        }

        // Verify required properties according to Canvas LTI documentation
        validateClaims(claims, expectedNonce);

        // Extract the LTI claim data
        LtiLaunchData launchData = new LtiLaunchData();

        // Extract user identity
        launchData.setUserId((String) claims.get("sub"));
        launchData.setFullName((String) claims.get("name"));
        launchData.setEmail((String) claims.get("email"));

        // Extract context information
        Map<String, Object> context = (Map<String, Object>) claims.get("https://purl.imsglobal.org/spec/lti/claim/context");
        if (context != null) {
            launchData.setCourseId((String) context.get("id"));
            launchData.setCourseName((String) context.get("title"));

            if (context.get("type") instanceof List) {
                launchData.setContextTypes((List<String>) context.get("type"));
            }
        }

        // Extract resource link information
        Map<String, Object> resourceLink = (Map<String, Object>) claims.get("https://purl.imsglobal.org/spec/lti/claim/resource_link");
        if (resourceLink != null) {
            launchData.setResourceLinkId((String) resourceLink.get("id"));
            launchData.setResourceLinkTitle((String) resourceLink.get("title"));
            launchData.setResourceLinkDescription((String) resourceLink.get("description"));
        }

        // Extract roles
        launchData.setRoles((List<String>) claims.get("https://purl.imsglobal.org/spec/lti/claim/roles"));

        // Extract deployment ID - required by Canvas to identify the specific deployment
        launchData.setDeploymentId((String) claims.get("https://purl.imsglobal.org/spec/lti/claim/deployment_id"));

        // Extract target link URI - where the user should be directed
        launchData.setTargetLinkUri((String) claims.get("https://purl.imsglobal.org/spec/lti/claim/target_link_uri"));

        // Extract message type
        launchData.setMessageType((String) claims.get("https://purl.imsglobal.org/spec/lti/claim/message_type"));

        // Extract LTI version
        launchData.setLtiVersion((String) claims.get("https://purl.imsglobal.org/spec/lti/claim/version"));

        // Extract custom parameters if available
        Map<String, String> custom = (Map<String, String>) claims.get("https://purl.imsglobal.org/spec/lti/claim/custom");
        if (custom != null) {
            launchData.setCustomParameters(custom);
        }

        // Extract deep linking settings if available (for content item selection)
        Map<String, Object> deepLinkingSettings = (Map<String, Object>) claims.get("https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings");
        if (deepLinkingSettings != null) {
            launchData.setDeepLinkReturnUrl((String) deepLinkingSettings.get("deep_link_return_url"));
            launchData.setDeepLinkAcceptTypes((List<String>) deepLinkingSettings.get("accept_types"));
            launchData.setDeepLinkAcceptMedia((List<String>) deepLinkingSettings.get("accept_media_types"));
            launchData.setDeepLinkDocumentTargets((List<String>) deepLinkingSettings.get("accept_presentation_document_targets"));
            launchData.setDeepLinkData((String) deepLinkingSettings.get("data"));
        }

        // Extract platform instance information
        Map<String, Object> platform = (Map<String, Object>) claims.get("https://purl.imsglobal.org/spec/lti/claim/tool_platform");
        if (platform != null) {
            launchData.setPlatformName((String) platform.get("name"));
            launchData.setPlatformGuid((String) platform.get("guid"));
            launchData.setPlatformVersion((String) platform.get("version"));
            launchData.setPlatformProductFamilyCode((String) platform.get("product_family_code"));
        }

        log.debug("Successfully validated LTI token for user: {}, course: {}, resource: {}",
                launchData.getUserId(), launchData.getCourseId(), launchData.getResourceLinkId());

        return launchData;
    }

    /**
     * Legacy method without nonce validation - for backward compatibility
     */
    public LtiLaunchData validateToken(String token) throws ParseException, JOSEException {
        log.warn("Using deprecated validateToken method without nonce validation");
        return validateToken(token, null);
    }

    /**
     * Validates the claims in the token according to the Canvas LTI documentation.
     *
     * @param claims The claims from the token
     * @param expectedNonce The nonce expected in the token
     * @throws JOSEException If the claims are invalid
     */
    @SuppressWarnings("unchecked")
    private void validateClaims(Map<String, Object> claims, String expectedNonce) throws JOSEException {
        // Verify issuer
        if (!claims.get("iss").equals(ltiConfig.getIssuer())) {
            throw new JOSEException("Invalid issuer: " + claims.get("iss"));
        }

        // Verify audience
        Object audObj = claims.get("aud");
        if (audObj == null) {
            throw new JOSEException("Missing audience");
        }

        boolean validAudience = false;
        if (audObj instanceof String) {
            validAudience = ltiConfig.getClientId().equals(audObj);
        } else if (audObj instanceof List) {
            List<String> audiences = (List<String>) audObj;
            validAudience = audiences.contains(ltiConfig.getClientId());
        }

        if (!validAudience) {
            throw new JOSEException("Invalid audience: " + audObj);
        }

        // Verify nonce if provided
        if (expectedNonce != null) {
            String tokenNonce = (String) claims.get("nonce");
            log.info("Nonce validation - Expected: {}, Token: {}", expectedNonce, tokenNonce);
            if (tokenNonce == null || !tokenNonce.equals(expectedNonce)) {
                log.error("Nonce mismatch - Expected: {}, Token: {}", expectedNonce, tokenNonce);
                throw new JOSEException("Invalid nonce - expected: " + expectedNonce + ", got: " + tokenNonce);
            }
            log.info("Nonce validation successful");
        }

        // Verify not expired
        Date now = new Date();
        if (claims.containsKey("exp")) {
            long exp = ((Number) claims.get("exp")).longValue() * 1000L; // Convert to milliseconds
            if (now.getTime() > exp) {
                throw new JOSEException("Token expired");
            }
        }

        // Verify not used before issuance
        if (claims.containsKey("iat")) {
            long iat = ((Number) claims.get("iat")).longValue() * 1000L; // Convert to milliseconds
            if (now.getTime() < iat) {
                throw new JOSEException("Token used before issuance");
            }
        }

        // Verify LTI specific claims
        // LTI version
        String ltiVersion = (String) claims.get("https://purl.imsglobal.org/spec/lti/claim/version");
        if (ltiVersion == null || !ltiVersion.equals("1.3.0")) {
            throw new JOSEException("Invalid or missing LTI version");
        }

        // Message type
        String messageType = (String) claims.get("https://purl.imsglobal.org/spec/lti/claim/message_type");
        if (messageType == null) {
            throw new JOSEException("Missing LTI message type");
        }

        // Deployment ID
        String deploymentId = (String) claims.get("https://purl.imsglobal.org/spec/lti/claim/deployment_id");
        if (deploymentId == null || deploymentId.isEmpty()) {
            throw new JOSEException("Missing deployment ID");
        }

        // Target link URI
        String targetLinkUri = (String) claims.get("https://purl.imsglobal.org/spec/lti/claim/target_link_uri");
        if (targetLinkUri == null || targetLinkUri.isEmpty()) {
            throw new JOSEException("Missing target link URI");
        }
    }

    /**
     * Creates a signed JWT for LTI client credentials.
     * This is used when your app needs to make requests to Canvas APIs.
     *
     * @param targetAudience The audience claim for the JWT (typically Canvas token URL)
     * @return A signed JWT string
     * @throws JOSEException If there's an error signing the JWT
     */
    public String createSignedJwt(String targetAudience) throws JOSEException {
        // Prepare JWT with claims
        JWTClaimsSet claimsSet = new JWTClaimsSet.Builder()
                .subject(ltiConfig.getClientId())
                .issuer(ltiConfig.getToolUrl())
                .audience(targetAudience)
                .jwtID(UUID.randomUUID().toString())
                .issueTime(new Date())
                .expirationTime(new Date(System.currentTimeMillis() + 300 * 1000)) // 5 min expiry
                .build();

        // Create JWS header with key ID
        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(jwkService.getKeyId())
                .build();

        // Sign the JWT
        SignedJWT signedJWT = new SignedJWT(header, claimsSet);
        signedJWT.sign(jwkService.getSigner());

        // Return the serialized JWT
        return signedJWT.serialize();
    }

    /**
     * Data class for LTI launch information extracted from the token.
     * This class uses Lombok's @Data annotation to automatically generate
     * getters, setters, equals, hashCode, and toString methods.
     */
    @Data
    public static class LtiLaunchData {
        // User identity
        private String userId;
        private String fullName;
        private String email;

        // Context information
        private String courseId;
        private String courseName;
        private List<String> contextTypes;

        // Resource link information
        private String resourceLinkId;
        private String resourceLinkTitle;
        private String resourceLinkDescription;

        // LTI specific information
        private List<String> roles;
        private String deploymentId;
        private String targetLinkUri;
        private String messageType;
        private String ltiVersion;

        // Custom parameters
        private Map<String, String> customParameters;

        // Platform information
        private String platformName;
        private String platformGuid;
        private String platformVersion;
        private String platformProductFamilyCode;

        // Deep linking information (for content selection)
        private String deepLinkReturnUrl;
        private List<String> deepLinkAcceptTypes;
        private List<String> deepLinkAcceptMedia;
        private List<String> deepLinkDocumentTargets;
        private String deepLinkData;

        /**
         * Checks if the user is an instructor based on their roles.
         *
         * @return true if the user has an instructor role
         */
        public boolean isInstructor() {
            if (roles == null) return false;

            for (String role : roles) {
                if (role.contains("Instructor") ||
                        role.contains("http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor") ||
                        role.contains("TeachingAssistant") ||
                        role.contains("ContentDeveloper") ||
                        role.contains("Administrator")) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Checks if the user is a student based on their roles.
         *
         * @return true if the user has a student role
         */
        public boolean isStudent() {
            if (roles == null) return false;

            for (String role : roles) {
                if (role.contains("Learner") ||
                        role.contains("http://purl.imsglobal.org/vocab/lis/v2/membership#Learner") ||
                        role.contains("Student")) {
                    return true;
                }
            }
            return false;
        }
    }
}