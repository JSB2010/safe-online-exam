package org.kentdenver.sebcanvas.config;

import org.junit.jupiter.api.Test;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;

class AppConfigTest {

    @Test
    void restTemplateUsesJdkRequestFactoryForPatchSupport() {
        RestTemplate restTemplate = new AppConfig().restTemplate();

        assertInstanceOf(JdkClientHttpRequestFactory.class, restTemplate.getRequestFactory());
    }
}