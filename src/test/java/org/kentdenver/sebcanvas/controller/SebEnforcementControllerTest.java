package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.kentdenver.sebcanvas.service.SebConfigService;
import org.kentdenver.sebcanvas.service.SebConfigurationService;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SebEnforcementControllerTest {

    @Mock
    private QuizService quizService;
    @Mock
    private SebConfigService sebConfigService;
    @Mock
    private SebConfigurationService sebConfigurationService;
    @Mock
    private ContentService contentService;

    @InjectMocks
    private SebEnforcementController controller;

    @Test
    void downloadSebConfigUsesLauncherUrlForNewQuizContentId() {
        ContentSebSetting setting = new ContentSebSetting();
        setting.setContentId("newquiz:course-7:99");
        setting.setSebRequired(true);
        setting.setAccessCode("CODE123");

        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(setting);
        when(sebConfigurationService.generateSebConfiguration(
                "course-7",
                "newquiz:course-7:99",
                "https://app.example.com/seb/launch/newquiz:course-7:99",
                "CODE123"))
                .thenReturn(new byte[]{1, 2, 3});

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/seb/config/course-7/newquiz:course-7:99.seb");
        request.setScheme("https");
        request.setServerName("app.example.com");
        request.setServerPort(443);

        ResponseEntity<byte[]> response = controller.downloadSebConfig(
                "course-7",
                "newquiz:course-7:99",
                null,
                null,
                request);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertArrayEquals(new byte[]{1, 2, 3}, response.getBody());
        assertTrue(response.getHeaders().getContentDisposition().getFilename().contains("newquiz_course-7_99"));
        verify(sebConfigurationService).generateSebConfiguration(
                "course-7",
                "newquiz:course-7:99",
                "https://app.example.com/seb/launch/newquiz:course-7:99",
                "CODE123");
    }
}