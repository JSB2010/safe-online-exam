package org.kentdenver.sebcanvas.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.util.SebConfigGenerator;
import org.kentdenver.sebcanvas.util.SebDetector;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;

import java.io.IOException;
import java.security.NoSuchAlgorithmException;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class SebServiceTest {

    @Mock
    private SebSettingRepository sebSettingRepository;

    @Mock
    private SebConfigGenerator sebConfigGenerator;

    @Mock
    private SebDetector sebDetector;

    @InjectMocks
    private SebService sebService;

    private MockHttpServletRequest request;
    private static final String QUIZ_ID = "12345";
    private static final String QUIZ_URL = "https://canvas.instructure.com/courses/67890/quizzes/12345";
    private static final String BROWSER_EXAM_KEY = "test_browser_exam_key";

    @BeforeEach
    void setUp() {
        request = new MockHttpServletRequest();
    }

    @Test
    void testIsUsingSeb_withUserAgent() {
        // Set SEB User-Agent
        request.addHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SEB/3.0.0 Chrome/71.0.3578.98 Safari/537.36");

        // Mock the detector
        when(sebDetector.isSebBrowser(any())).thenReturn(true);

        // Test detection
        boolean result = sebService.isUsingSeb(request);

        // Verify
        assertTrue(result);
    }

    @Test
    void testIsUsingSeb_withConfigKeyHash() {
        // Set SEB Config Key Hash header
        request.addHeader("X-SafeExamBrowser-ConfigKeyHash", "some-hash-value");

        // Mock the detector
        when(sebDetector.isSebBrowser(any())).thenReturn(true);

        // Test detection
        boolean result = sebService.isUsingSeb(request);

        // Verify
        assertTrue(result);
    }

    @Test
    void testIsUsingSeb_notUsingSeb() {
        // Set regular User-Agent
        request.addHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");

        // Mock the detector
        when(sebDetector.isSebBrowser(any())).thenReturn(false);

        // Test detection
        boolean result = sebService.isUsingSeb(request);

        // Verify
        assertFalse(result);
    }

    @Test
    void testGenerateSebConfig() throws IOException, NoSuchAlgorithmException {
        // Setup mock generator
        byte[] mockSebFile = "test seb file content".getBytes();
        when(sebConfigGenerator.generateSebFile(any(), anyString())).thenReturn(mockSebFile);

        // Setup mock repository
        QuizSebSetting mockSetting = new QuizSebSetting();
        mockSetting.setQuizId(QUIZ_ID);
        when(sebSettingRepository.findByQuizId(QUIZ_ID)).thenReturn(Optional.of(mockSetting));

        // Call the method
        byte[] result = sebService.generateSebConfig(QUIZ_ID, QUIZ_URL);

        // Verify
        assertNotNull(result);
        assertArrayEquals(mockSebFile, result);
        verify(sebSettingRepository).save(any(QuizSebSetting.class));
    }

    @Test
    void testValidateBrowserExamKey_valid() {
        // Setup mock repository
        QuizSebSetting mockSetting = new QuizSebSetting();
        mockSetting.setQuizId(QUIZ_ID);
        mockSetting.setBrowserExamKey(BROWSER_EXAM_KEY);
        when(sebSettingRepository.findByQuizId(QUIZ_ID)).thenReturn(Optional.of(mockSetting));

        // Call the method with HTTP request
        when(sebDetector.validateBrowserExamKey(any(), eq(BROWSER_EXAM_KEY))).thenReturn(true);
        boolean result = sebService.validateBrowserExamKey(request, QUIZ_ID);

        // Verify
        assertTrue(result);
    }

    @Test
    void testValidateBrowserExamKey_invalid() {
        // Setup mock repository
        QuizSebSetting mockSetting = new QuizSebSetting();
        mockSetting.setQuizId(QUIZ_ID);
        mockSetting.setBrowserExamKey(BROWSER_EXAM_KEY);
        when(sebSettingRepository.findByQuizId(QUIZ_ID)).thenReturn(Optional.of(mockSetting));

        // Call the method with HTTP request
        when(sebDetector.validateBrowserExamKey(any(), eq(BROWSER_EXAM_KEY))).thenReturn(false);
        boolean result = sebService.validateBrowserExamKey(request, QUIZ_ID);

        // Verify
        assertFalse(result);
    }

    @Test
    void testValidateBrowserExamKey_noSetting() {
        // Setup mock repository to return empty
        when(sebSettingRepository.findByQuizId(QUIZ_ID)).thenReturn(Optional.empty());

        // Call the method with HTTP request
        boolean result = sebService.validateBrowserExamKey(request, QUIZ_ID);

        // Verify
        assertFalse(result);
    }
}
