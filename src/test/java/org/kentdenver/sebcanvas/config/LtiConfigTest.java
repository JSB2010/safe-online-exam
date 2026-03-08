package org.kentdenver.sebcanvas.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.service.SecretManagerService;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LtiConfigTest {

    @Mock
    private SecretManagerService secretManagerService;

    @Test
    void getSanitizedToolUrlInitializesConfiguredFallbackBeforeApplicationReady() throws Exception {
        when(secretManagerService.getSecret(anyString(), eq("latest"))).thenReturn("");

        LtiConfig ltiConfig = new LtiConfig(secretManagerService);
        ReflectionTestUtils.setField(ltiConfig, "activeProfile", "dev");
        ReflectionTestUtils.setField(ltiConfig, "configuredClientId", "client-123");
        ReflectionTestUtils.setField(ltiConfig, "configuredToolUrl", "tool.example.com/");

        assertEquals("client-123", ltiConfig.getClientId());
        assertEquals("https://tool.example.com", ltiConfig.getToolUrl());
        assertEquals("https://tool.example.com", ltiConfig.getSanitizedToolUrl());

        verify(secretManagerService).getSecret("dev_lti_client_id", "latest");
        verify(secretManagerService).getSecret("dev_tool_url", "latest");
    }

    @Test
    void repeatedBootstrapReadsDoNotReloadSecrets() throws Exception {
        when(secretManagerService.getSecret(anyString(), eq("latest"))).thenReturn("");

        LtiConfig ltiConfig = new LtiConfig(secretManagerService);
        ReflectionTestUtils.setField(ltiConfig, "activeProfile", "dev");
        ReflectionTestUtils.setField(ltiConfig, "configuredClientId", "client-123");
        ReflectionTestUtils.setField(ltiConfig, "configuredToolUrl", "https://tool.example.com");

        ltiConfig.getSanitizedToolUrl();
        ltiConfig.getToolUrl();
        ltiConfig.getClientId();

        verify(secretManagerService, times(2)).getSecret(anyString(), eq("latest"));
    }
}