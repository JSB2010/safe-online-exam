package org.kentdenver.sebcanvas.service;

import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.text.ParseException;
import java.time.Instant;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class LtiServiceTest {

    @Mock
    private RestTemplate restTemplate;

    @InjectMocks
    private LtiService ltiService;

    private RSAKey rsaKey;
    private String token;
    private final String ISSUER = "https://canvas.instructure.com";
    private final String CLIENT_ID = "test_client_id";

    @BeforeEach
    void setUp() throws JOSEException, ParseException {
        // Generate a random RSA key for testing
        rsaKey = new RSAKeyGenerator(2048)
                .keyID("test-key-id")
                .generate();

        // Set the required properties
        ReflectionTestUtils.setField(ltiService, "issuer", ISSUER);
        ReflectionTestUtils.setField(ltiService, "clientId", CLIENT_ID);
        ReflectionTestUtils.setField(ltiService, "keySetUrl", "https://example.com/jwks");

        // Create a mock JWK set
        JWKSet mockJwkSet = new JWKSet(rsaKey.toPublicJWK());

        // Generate a test JWT token
        JWSSigner signer = new RSASSASigner(rsaKey);

        // Build claims
        JWTClaimsSet claimsSet = new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .audience(CLIENT_ID)
                .subject("test_user_id")
                .claim("name", "Test User")
                .claim("email", "testuser@example.com")
                .claim("https://purl.imsglobal.org/spec/lti/claim/context",
                        Map.of("id", "test_course_id", "title", "Test Course"))
                .claim("https://purl.imsglobal.org/spec/lti/claim/resource_link",
                        Map.of("id", "test_resource_id", "title", "Test Resource"))
                .claim("https://purl.imsglobal.org/spec/lti/claim/roles",
                        Arrays.asList("http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"))
                .issueTime(Date.from(Instant.now()))
                .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                .jwtID(UUID.randomUUID().toString())
                .build();

        // Create the signed JWT
        SignedJWT signedJWT = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256)
                        .keyID(rsaKey.getKeyID())
                        .build(),
                claimsSet);

        signedJWT.sign(signer);
        token = signedJWT.serialize();

        // Mock the JWKSet loading
        when(restTemplate.getForObject(anyString(), any())).thenReturn(mockJwkSet.toString());
    }

    @Test
    void testValidateLtiToken() throws Exception {
        // Configure the mock to return our test RSA key
        Mockito.lenient().when(restTemplate.getForObject(anyString(), any())).thenReturn(
                new JWKSet(rsaKey.toPublicJWK()).toString());

        // Test the token validation
        LtiLaunchData launchData = ltiService.validateToken(token);

        // Verify the data
        assertNotNull(launchData);
        assertEquals("test_user_id", launchData.getUserId());
        assertEquals("test_course_id", launchData.getCourseId());
        assertEquals("Test Course", launchData.getCourseName());
        assertEquals("test_resource_id", launchData.getResourceLinkId());
        assertTrue(launchData.isInstructor());
        assertFalse(launchData.isStudent());
    }
}