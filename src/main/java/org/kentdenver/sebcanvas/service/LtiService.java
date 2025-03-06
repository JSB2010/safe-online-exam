package org.kentdenver.sebcanvas.service;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSObject;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.net.URL;
import java.text.ParseException;
import java.util.Map;

@Service
@Slf4j
@RequiredArgsConstructor
public class LtiService {

    @Value("${lti.issuer}")
    private String issuer;

    @Value("${lti.clientId}")
    private String clientId;

    @Value("${lti.keySetUrl}")
    private String keySetUrl;

    private final RestTemplate restTemplate;

    /**
     * Validate an LTI 1.3 launch JWT token
     */
    @SuppressWarnings("unchecked")
    public LtiLaunchData validateToken(String token) throws ParseException, JOSEException, IOException {
        // Parse the JWS
        JWSObject jwsObject = JWSObject.parse(token);

        // Load JWK Set from Canvas
        JWKSet jwkSet = JWKSet.load(new URL(keySetUrl));

        // Get the key ID from the header
        String keyId = jwsObject.getHeader().getKeyID();

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

        // Verify token properties
        if (!claims.get("iss").equals(issuer)) {
            throw new JOSEException("Invalid issuer");
        }

        if (!claims.containsKey("aud") ||
                (claims.get("aud") instanceof String && !claims.get("aud").equals(clientId)) ||
                (claims.get("aud") instanceof Iterable && !((Iterable<?>) claims.get("aud")).iterator().hasNext())) {
            throw new JOSEException("Invalid audience");
        }

        // Extract the LTI claim data
        LtiLaunchData launchData = new LtiLaunchData();
        launchData.setUserId((String) claims.get("sub"));

        Map<String, Object> context = (Map<String, Object>) claims.get("https://purl.imsglobal.org/spec/lti/claim/context");
        if (context != null) {
            launchData.setCourseId((String) context.get("id"));
            launchData.setCourseName((String) context.get("title"));
        }

        Map<String, Object> resourceLink = (Map<String, Object>) claims.get("https://purl.imsglobal.org/spec/lti/claim/resource_link");
        if (resourceLink != null) {
            launchData.setResourceLinkId((String) resourceLink.get("id"));
            launchData.setResourceLinkTitle((String) resourceLink.get("title"));
        }

        launchData.setRoles((Iterable<String>) claims.get("https://purl.imsglobal.org/spec/lti/claim/roles"));
        launchData.setFullName((String) claims.get("name"));
        launchData.setEmail((String) claims.get("email"));

        return launchData;
    }

    @Data
    public static class LtiLaunchData {
        private String userId;
        private String courseId;
        private String courseName;
        private String resourceLinkId;
        private String resourceLinkTitle;
        private Iterable<String> roles;
        private String fullName;
        private String email;

        public boolean isInstructor() {
            if (roles == null) return false;

            for (String role : roles) {
                if (role.contains("Instructor") || role.contains("Administrator") ||
                        role.contains("TeachingAssistant") || role.contains("ContentDeveloper")) {
                    return true;
                }
            }
            return false;
        }

        public boolean isStudent() {
            if (roles == null) return false;

            for (String role : roles) {
                if (role.contains("Learner") || role.contains("Student")) {
                    return true;
                }
            }
            return false;
        }
    }
}