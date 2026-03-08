package org.kentdenver.sebcanvas.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.config.LtiConfig;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class JwkServiceTest {

    @Mock
    private SecretManagerService secretManagerService;

    @Mock
    private LtiConfig ltiConfig;

    @Test
    void validateLtiConfigInitializesConfigBeforeReadingToolUrl() {
        when(ltiConfig.getSanitizedToolUrl()).thenReturn("https://tool.example.com");

        JwkService jwkService = new JwkService(secretManagerService, ltiConfig);
        ReflectionTestUtils.invokeMethod(jwkService, "validateLtiConfig");

        InOrder inOrder = inOrder(ltiConfig);
        inOrder.verify(ltiConfig).init();
        inOrder.verify(ltiConfig).getSanitizedToolUrl();
    }
}