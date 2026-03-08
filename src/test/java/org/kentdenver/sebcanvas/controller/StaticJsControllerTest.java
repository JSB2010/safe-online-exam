package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.service.ApiSecurityService;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class StaticJsControllerTest {

    @Mock
    private ApiSecurityService apiSecurityService;

    @Test
    void getCanvasDetectorScriptEmbedsRuntimeApiKeyAndDisablesCaching() {
        when(apiSecurityService.getApiKeyForJavaScript()).thenReturn("runtime-generated-key");

        StaticJsController controller = new StaticJsController(apiSecurityService);

        var response = controller.getCanvasDetectorScript();

        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("runtime-generated-key"));
        assertEquals("no-cache, no-store, must-revalidate", response.getHeaders().getCacheControl());
        assertEquals("0", response.getHeaders().getFirst("Expires"));
    }
}