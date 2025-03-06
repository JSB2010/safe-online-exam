package org.kentdenver.sebcanvas.util;

import org.kentdenver.sebcanvas.model.SebConfig;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.NoSuchAlgorithmException;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.*;

public class SebConfigGeneratorTest {

    private final SebConfigGenerator generator = new SebConfigGenerator();

    @Test
    void testGenerateSebFile() throws IOException, NoSuchAlgorithmException {
        // Create a test configuration
        SebConfig config = new SebConfig();
        config.setName("Test Quiz");
        config.setDescription("Test Description");
        config.setAllowQuit(true);
        config.setBlockExplorer(true);
        config.setDisableScreenCapture(true);
        config.setDisablePrinting(false);
        config.setStartURL("https://canvas.example.com/courses/12345/quizzes/67890");

        String browserExamKey = "test_browser_exam_key";

        // Generate the .seb file
        byte[] sebFile = generator.generateSebFile(config, browserExamKey);

        // Verify the file was created
        assertNotNull(sebFile);
        assertTrue(sebFile.length > 0);

        // Verify it's a valid GZIP file by attempting to decompress it
        ByteArrayInputStream bais = new ByteArrayInputStream(sebFile);
        GZIPInputStream gzis = new GZIPInputStream(bais);

        // Read the decompressed data
        byte[] buffer = new byte[1024];
        int len = gzis.read(buffer);

        String content = new String(buffer, 0, len);

        // Verify it starts with "plnd" (Plain data prefix)
        assertTrue(content.startsWith("plnd"));

        // Verify it contains some expected configuration elements
        assertTrue(content.contains("<key>startURL</key>"));
        assertTrue(content.contains(config.getStartURL()));
        assertTrue(content.contains("<key>browserExamKey</key>"));
        assertTrue(content.contains(browserExamKey));
    }
}