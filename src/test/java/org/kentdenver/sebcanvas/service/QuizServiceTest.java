package org.kentdenver.sebcanvas.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.config.CanvasApiConfig;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.FirestoreQuizRepository;
import org.kentdenver.sebcanvas.repository.FirestoreSebSettingRepository;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class QuizServiceTest {

    @Mock
    private FirestoreQuizRepository quizRepository;
    @Mock
    private FirestoreSebSettingRepository sebSettingRepository;
    @Mock
    private HybridCanvasAuthService hybridAuthService;
    @Mock
    private CanvasApiService canvasApiService;
    @Mock
    private CanvasApiConfig canvasApiConfig;

    @InjectMocks
    private QuizService quizService;

    @Test
    void enableSebWithAccessCodeUsesClassicCanvasApiPath() {
        when(canvasApiService.setQuizAccessCode(eq("course-1"), eq("quiz-1"), anyString(), eq("user-1")))
                .thenReturn(true);
        when(sebSettingRepository.findByQuizId("quiz-1")).thenReturn(Optional.empty());
        when(sebSettingRepository.save(any(QuizSebSetting.class))).thenAnswer(invocation -> invocation.getArgument(0));

        boolean enabled = quizService.enableSebWithAccessCode("course-1", "quiz-1", "user-1", Map.of());

        assertTrue(enabled);

        ArgumentCaptor<QuizSebSetting> settingCaptor = ArgumentCaptor.forClass(QuizSebSetting.class);
        verify(canvasApiService).setQuizAccessCode(eq("course-1"), eq("quiz-1"), anyString(), eq("user-1"));
        verify(sebSettingRepository).save(settingCaptor.capture());
        QuizSebSetting savedSetting = settingCaptor.getValue();
        assertTrue(savedSetting.isSebRequired());
        assertTrue(savedSetting.isEnabled());
        assertNotNull(savedSetting.getAccessCode());
        assertEquals(16, savedSetting.getAccessCode().length());
    }

    @Test
    void disableSebWithAccessCodeUsesClassicCanvasApiPath() {
        QuizSebSetting existingSetting = new QuizSebSetting();
        existingSetting.setQuizId("quiz-1");
        existingSetting.setCourseId("course-1");
        existingSetting.setEnabled(true);
        existingSetting.setSebRequired(true);
        existingSetting.setAccessCode("access-123");

        when(sebSettingRepository.findByQuizId("quiz-1")).thenReturn(Optional.of(existingSetting));
        when(canvasApiService.removeQuizAccessCode("course-1", "quiz-1", "user-1")).thenReturn(true);
        when(sebSettingRepository.save(any(QuizSebSetting.class))).thenAnswer(invocation -> invocation.getArgument(0));

        boolean disabled = quizService.disableSebWithAccessCode("course-1", "quiz-1", "user-1");

        assertTrue(disabled);

        ArgumentCaptor<QuizSebSetting> settingCaptor = ArgumentCaptor.forClass(QuizSebSetting.class);
        verify(canvasApiService).removeQuizAccessCode("course-1", "quiz-1", "user-1");
        verify(sebSettingRepository).save(settingCaptor.capture());
        QuizSebSetting savedSetting = settingCaptor.getValue();
        assertFalse(savedSetting.isSebRequired());
        assertFalse(savedSetting.isEnabled());
        assertNull(savedSetting.getAccessCode());
    }

    @Test
    void updateSebConfigurationStructuredPersistsQuitPassword() {
        when(sebSettingRepository.findByQuizId("quiz-1")).thenReturn(Optional.empty());
        when(sebSettingRepository.save(any(QuizSebSetting.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(canvasApiConfig.getCanvasDomain()).thenReturn("https://canvas.example.com");

        QuizSebSetting saved = quizService.updateSebConfigurationStructured(
                "quiz-1",
                List.of("accounts.google.com"),
                List.of("www.desmos.com"),
                List.of("example.com"),
                "https://app.example.com/seb/launch/classicquiz_1",
                true,
                "classic-exit");

        assertEquals("classic-exit", saved.getQuitPassword());

        ArgumentCaptor<QuizSebSetting> settingCaptor = ArgumentCaptor.forClass(QuizSebSetting.class);
        verify(sebSettingRepository).save(settingCaptor.capture());
        assertEquals("classic-exit", settingCaptor.getValue().getQuitPassword());
    }
}
