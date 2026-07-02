package org.kentdenver.sebcanvas.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.dto.StructuredSebConfigRequest;
import org.kentdenver.sebcanvas.model.ContentItem;
import org.kentdenver.sebcanvas.model.ContentSebSetting;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.service.CanvasApiService;
import org.kentdenver.sebcanvas.service.ContentService;
import org.kentdenver.sebcanvas.service.DeepLinkModuleService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.kentdenver.sebcanvas.service.ModuleItemService;
import org.kentdenver.sebcanvas.service.QuizService;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpSession;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class QuizControllerTest {

    @Mock private QuizService quizService;
    @Mock private CanvasApiConfig canvasApiConfig;
    @Mock private CanvasApiService canvasApiService;
    @Mock private ContentService contentService;
    @Mock private ModuleItemService moduleItemService;
    @Mock private DeepLinkModuleService deepLinkModuleService;

    private QuizController controller;

    @BeforeEach
    void setUp() {
        controller = new QuizController(
                quizService,
                canvasApiConfig,
                canvasApiService,
                contentService,
                moduleItemService,
                deepLinkModuleService);
    }

    @Test
    void refreshQuizzesRejectsMissingSessionUser() {
        var response = controller.refreshQuizzes("course-1", null, new MockHttpSession());

        assertEquals(401, response.getStatusCode().value());
        verifyNoInteractions(quizService);
    }

    @Test
    void saveSebConfigurationStructuredRejectsMismatchedUserId() {
        MockHttpSession session = new MockHttpSession();
        LtiLaunchData launchData = new LtiLaunchData();
        launchData.setUserId("session-user");
        session.setAttribute("launchData", launchData);

        StructuredSebConfigRequest request = new StructuredSebConfigRequest();
        request.setQuizId("quiz-1");

        var response = controller.saveSebConfigurationStructured(request, "other-user", session);

        assertEquals(403, response.getStatusCode().value());
        verifyNoInteractions(quizService);
    }

    @Test
    void saveSebConfigurationStructuredUsesAuthenticatedSessionUser() {
        MockHttpSession session = new MockHttpSession();
        LtiLaunchData launchData = new LtiLaunchData();
        launchData.setUserId("session-user");
        session.setAttribute("launchData", launchData);

        StructuredSebConfigRequest request = new StructuredSebConfigRequest();
        request.setQuizId("quiz-1");
        request.setSsoDomains(List.of("accounts.google.com"));
        request.setEducationalToolDomains(List.of("www.desmos.com"));
        request.setCustomDomains(List.of("example.com"));

        QuizSebSetting expected = new QuizSebSetting();
        when(quizService.updateSebConfigurationStructured(
                "quiz-1",
                request.getSsoDomains(),
                request.getEducationalToolDomains(),
                request.getCustomDomains(),
                request.getExternalToolUrl(),
                true)).thenReturn(expected);

        var response = controller.saveSebConfigurationStructured(request, "session-user", session);

        assertEquals(200, response.getStatusCode().value());
        assertSame(expected, response.getBody());
        verify(quizService).updateSebConfigurationStructured(
                "quiz-1",
                request.getSsoDomains(),
                request.getEducationalToolDomains(),
                request.getCustomDomains(),
                request.getExternalToolUrl(),
                true);
    }

    @Test
    void saveSebConfigurationStructuredPersistsNewQuizContentSetting() {
        MockHttpSession session = authenticatedSession("session-user");

        StructuredSebConfigRequest request = new StructuredSebConfigRequest();
        request.setContentId("newquiz:course-7:99");
        request.setSsoDomains(List.of("accounts.google.com"));
        request.setEducationalToolDomains(List.of("www.desmos.com"));
        request.setCustomDomains(List.of("example.com"));
        request.setQuitPassword("quit-me");

        ContentSebSetting existing = new ContentSebSetting();
        existing.setId("newquiz:course-7:99");
        existing.setContentId("newquiz:course-7:99");
        existing.setAccessCode("ACCESS42");
        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(existing);
        when(contentService.saveSebSetting(any(ContentSebSetting.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var response = controller.saveSebConfigurationStructured(request, "session-user", session);

        assertEquals(200, response.getStatusCode().value());
        ContentSebSetting saved = assertInstanceOf(ContentSebSetting.class, response.getBody());
        assertEquals("newquiz:course-7:99", saved.getContentId());
        assertEquals("ACCESS42", saved.getAccessCode());
        assertEquals(List.of("accounts.google.com"), saved.getSsoDomains());
        assertEquals(List.of("www.desmos.com"), saved.getEducationalToolDomains());
        assertEquals(List.of("example.com"), saved.getCustomDomains());
        assertEquals("quit-me", saved.getQuitPassword());
        assertTrue(saved.isSebRequired());
        assertNotNull(saved.getBrowserExamKey());
        verifyNoInteractions(quizService);
    }

    @Test
    void enableSebWithAccessCodeRoutesNewQuizThroughContentSettingAndQuizV1Helpers() {
        MockHttpSession session = authenticatedSession("user-1");

        ContentSebSetting existing = new ContentSebSetting();
        existing.setId("newquiz:course-7:99");
        existing.setContentId("newquiz:course-7:99");
        existing.setCustomDomains(List.of("example.com"));
        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(existing);
        when(contentService.saveSebSetting(any(ContentSebSetting.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(canvasApiConfig.getApplicationBaseUrl()).thenReturn("https://app.example.com");
        when(canvasApiService.setNewQuizAccessCode(eq("course-7"), eq("99"), anyString(), eq("user-1"))).thenReturn(true);
        when(deepLinkModuleService.createOrUpdateModuleItemForContent(
                eq("course-7"), any(ContentItem.class), eq("user-1"), eq(true))).thenReturn(true);

        var response = controller.enableSebWithAccessCode("course-7", "newquiz:course-7:99", null, session);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("success"));
        assertEquals(true, response.getBody().get("moduleItemUpdated"));
        verify(canvasApiService).setNewQuizAccessCode(eq("course-7"), eq("99"), anyString(), eq("user-1"));
        verify(contentService).saveSebSetting(any(ContentSebSetting.class));
        verify(deepLinkModuleService).createOrUpdateModuleItemForContent(
                eq("course-7"), any(ContentItem.class), eq("user-1"), eq(true));
        verifyNoInteractions(quizService);
    }

    @Test
    void disableSebWithAccessCodeRoutesNewQuizThroughContentSettingAndQuizV1Helpers() {
        MockHttpSession session = authenticatedSession("user-1");

        ContentSebSetting existing = new ContentSebSetting();
        existing.setId("newquiz:course-7:99");
        existing.setContentId("newquiz:course-7:99");
        existing.setAccessCode("ACCESS42");
        existing.setSebRequired(true);
        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(existing);
        when(contentService.saveSebSetting(any(ContentSebSetting.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(canvasApiService.removeNewQuizAccessCode("course-7", "99", "user-1")).thenReturn(true);
        when(deepLinkModuleService.createOrUpdateModuleItemForContent(
                eq("course-7"), any(ContentItem.class), eq("user-1"), eq(false))).thenReturn(true);

        var response = controller.disableSebWithAccessCode("course-7", "newquiz:course-7:99", session);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("success"));
        assertEquals(true, response.getBody().get("moduleItemRestored"));
        verify(canvasApiService).removeNewQuizAccessCode("course-7", "99", "user-1");
        verify(contentService).saveSebSetting(any(ContentSebSetting.class));
        verify(deepLinkModuleService).createOrUpdateModuleItemForContent(
                eq("course-7"), any(ContentItem.class), eq("user-1"), eq(false));
        verifyNoInteractions(quizService);
    }

    @Test
    void getSebStatusUsesContentScopedSettingsForNewQuiz() {
        MockHttpSession session = authenticatedSession("user-1");

        ContentSebSetting setting = new ContentSebSetting();
        setting.setContentId("newquiz:course-7:99");
        setting.setSebRequired(true);
        setting.setAccessCode("ACCESS42");
        setting.setBrowserExamKey("browser-key");
        setting.setCustomDomains(List.of("example.com"));
        when(contentService.getSebSetting("newquiz:course-7:99")).thenReturn(setting);
        when(canvasApiConfig.getCanvasDomain()).thenReturn("https://canvas.example.com");

        var response = controller.getSebStatus("course-7", "newquiz:course-7:99", session);

        assertEquals(200, response.getStatusCode().value());
        Map<String, Object> body = response.getBody();
        assertEquals(true, body.get("authenticated"));
        assertEquals(true, body.get("sebEnabled"));
        assertEquals(true, body.get("configValid"));
        assertEquals("canvas.example.com", body.get("canvasDomain"));
        assertEquals(List.of("example.com"), body.get("customDomains"));
        verifyNoInteractions(quizService);
    }

    private MockHttpSession authenticatedSession(String userId) {
        MockHttpSession session = new MockHttpSession();
        LtiLaunchData launchData = new LtiLaunchData();
        launchData.setUserId(userId);
        session.setAttribute("launchData", launchData);
        return session;
    }
}
