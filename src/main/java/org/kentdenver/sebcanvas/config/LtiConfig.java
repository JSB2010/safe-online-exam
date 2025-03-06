package org.kentdenver.sebcanvas.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

@Configuration
@Slf4j
public class LtiConfig {

    @Value("${lti.issuer}")
    private String issuer;

    @Value("${lti.clientId}")
    private String clientId;

    @Value("${lti.keySetUrl}")
    private String keySetUrl;

    @Value("${lti.tokenUrl}")
    private String tokenUrl;

    @Value("${lti.authUrl}")
    private String authUrl;

    public String getIssuer() {
        return issuer;
    }

    public String getClientId() {
        return clientId;
    }

    public String getKeySetUrl() {
        return keySetUrl;
    }

    public String getTokenUrl() {
        return tokenUrl;
    }

    public String getAuthUrl() {
        return authUrl;
    }
}