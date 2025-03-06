package org.kentdenver.sebcanvas.service;

import org.kentdenver.sebcanvas.model.QuizSebSetting;
import org.kentdenver.sebcanvas.model.SebConfig;
import org.kentdenver.sebcanvas.repository.SebSettingRepository;
import org.kentdenver.sebcanvas.util.SebConfigGenerator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Optional;

@Service
@Slf4j
@RequiredArgsConstructor
public class SebService {

    private final SebSettingRepository sebSettingRepository;
    private final SebConfigGenerator sebConfigGenerator;

    /**
     * Check if the user is using SEB
     */
    public boolean isUsingSeb(HttpServletRequest request) {
        // Check for SEB-specific headers
        String userAgent = request.getHeader("User-Agent");

        // SEB User-Agent contains 'SEB' string
        if (userAgent != null && userAgent.contains("SEB")) {
            // Further validation can be implemented based on the SEB Config Key or Browser Exam Key
            return true;
        }

        // Check for SEB config key hash
        String configKeyHash = request.getHeader("X-SafeExamBrowser-ConfigKeyHash");
        if (configKeyHash != null && !configKeyHash.isEmpty()) {
            // Validate the config key hash against expected value
            return true;
        }

        return false;
    }

    /**
     * Generate a SEB .seb file for a quiz
     */
    public byte[] generateSebConfig(String quizId, String quizUrl) throws IOException, NoSuchAlgorithmException {
        // Check if there's a custom config for this quiz
        Optional<QuizSebSetting> settingOpt = sebSettingRepository.findByQuizId(quizId);

        if (settingOpt.isPresent() && settingOpt.get().getSebConfigFileId() != null) {
            // Use custom SEB config if available
            // Not implemented in this example
            return null;
        } else {
            // Generate a basic SEB config
            SebConfig config = new SebConfig();
            config.setName("Quiz " + quizId);
            config.setDescription("SEB Config for Canvas Quiz");
            config.setAllowQuit(true);
            config.setBlockExplorer(true);
            config.setDisableScreenCapture(true);
            config.setDisablePrinting(true);
            config.setStartURL(quizUrl);

            // Generate a unique Browser Exam Key
            String browserExamKey = generateBrowserExamKey();

            // Generate the .seb file
            byte[] sebFileContent = sebConfigGenerator.generateSebFile(config, browserExamKey);

            // If we have a setting record, update it with the new Browser Exam Key
            if (settingOpt.isPresent()) {
                QuizSebSetting setting = settingOpt.get();
                setting.setBrowserExamKey(browserExamKey);
                sebSettingRepository.save(setting);
            }

            return sebFileContent;
        }
    }

    /**
     * Generate a random Browser Exam Key
     */
    private String generateBrowserExamKey() throws NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        String randomStr = "SEB" + System.currentTimeMillis() + Math.random();
        byte[] encodedhash = digest.digest(randomStr.getBytes(StandardCharsets.UTF_8));
        return bytesToHex(encodedhash);
    }

    /**
     * Validate a Browser Exam Key
     */
    public boolean validateBrowserExamKey(String quizId, String providedKey) {
        Optional<QuizSebSetting> settingOpt = sebSettingRepository.findByQuizId(quizId);

        if (settingOpt.isPresent()) {
            String expectedKey = settingOpt.get().getBrowserExamKey();
            return expectedKey != null && expectedKey.equals(providedKey);
        }

        return false;
    }

    /**
     * Convert bytes to hex string - Java 11 compatible method
     */
    private static String bytesToHex(byte[] hash) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : hash) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) hexString.append('0');
            hexString.append(hex);
        }
        return hexString.toString();
    }
}