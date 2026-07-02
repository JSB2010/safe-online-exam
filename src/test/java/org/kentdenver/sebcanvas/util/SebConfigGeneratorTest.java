package org.kentdenver.sebcanvas.util;

import org.junit.jupiter.api.Test;
import org.kentdenver.sebcanvas.model.SebConfig;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.assertTrue;

class SebConfigGeneratorTest {

    @Test
    void generateSebFileIncludesModernWebViewPolicy() throws Exception {
        SebConfig config = new SebConfig();
        config.setStartURL("https://canvas.example.com/courses/1/quizzes/2");
        config.setSendBrowserExamKey(false);

        byte[] sebFile = new SebConfigGenerator().generateSebFile(config, "browser-exam-key");
        String xml = unzipSebFile(sebFile);

        assertTrue(xml.contains("<key>browserWindowWebView</key>"));
        assertTrue(xml.contains("<integer>3</integer>"));
        assertTrue(xml.contains("<key>browserWindowWebViewClassicHideDeprecationNote</key>"));
        assertTrue(xml.contains("<key>sendBrowserExamKey</key>\n  <false/>"));
    }

    private String unzipSebFile(byte[] sebFile) throws Exception {
        try (GZIPInputStream gzipInputStream = new GZIPInputStream(new ByteArrayInputStream(sebFile))) {
            return new String(gzipInputStream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
