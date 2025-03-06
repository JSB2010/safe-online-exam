package org.kentdenver.sebcanvas.util;

import org.kentdenver.sebcanvas.model.SebConfig;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.zip.GZIPOutputStream;

@Component
@Slf4j
public class SebConfigGenerator {

    /**
     * Generate a basic SEB config file
     */
    public byte[] generateSebFile(SebConfig config, String browserExamKey) throws IOException {
        // Create XML structure for SEB config
        String xmlConfig = createXmlConfig(config, browserExamKey);

        // Prefix the XML with "plnd" to indicate plain data (unencrypted)
        String prefixedData = "plnd" + xmlConfig;

        // Compress with GZIP as required by SEB format
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (GZIPOutputStream gzos = new GZIPOutputStream(baos)) {
            gzos.write(prefixedData.getBytes(StandardCharsets.UTF_8));
        }

        return baos.toByteArray();
    }

    /**
     * Create XML config for SEB
     */
    private String createXmlConfig(SebConfig config, String browserExamKey) {
        StringBuilder xml = new StringBuilder();
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n");
        xml.append("<plist version=\"1.0\">\n");
        xml.append("<dict>\n");

        // Basic SEB settings
        xml.append("  <key>allowQuit</key>\n");
        xml.append("  <").append(config.isAllowQuit() ? "true" : "false").append("/>\n");

        xml.append("  <key>browserWindowAllowReload</key>\n");
        xml.append("  <true/>\n");

        xml.append("  <key>enableBrowserWindowToolbar</key>\n");
        xml.append("  <false/>\n");

        xml.append("  <key>enableSebBrowser</key>\n");
        xml.append("  <true/>\n");

        xml.append("  <key>blockPopUpWindows</key>\n");
        xml.append("  <").append(config.isBlockExplorer() ? "true" : "false").append("/>\n");

        xml.append("  <key>enablePrintScreen</key>\n");
        xml.append("  <").append(config.isDisableScreenCapture() ? "false" : "true").append("/>\n");

        xml.append("  <key>allowPrinting</key>\n");
        xml.append("  <").append(config.isDisablePrinting() ? "false" : "true").append("/>\n");

        // Browser exam key
        xml.append("  <key>browserExamKey</key>\n");
        xml.append("  <string>").append(browserExamKey).append("</string>\n");

        // Start URL
        xml.append("  <key>startURL</key>\n");
        xml.append("  <string>").append(config.getStartURL()).append("</string>\n");

        // Quit URL if specified
        if (config.getQuitURL() != null && !config.getQuitURL().isEmpty()) {
            xml.append("  <key>quitURL</key>\n");
            xml.append("  <string>").append(config.getQuitURL()).append("</string>\n");
        }

        // Add quit password if specified
        if (config.getQuitPassword() != null && !config.getQuitPassword().isEmpty()) {
            String hashedPassword = hashPassword(config.getQuitPassword());
            xml.append("  <key>hashedQuitPassword</key>\n");
            xml.append("  <string>").append(hashedPassword).append("</string>\n");
        }

        // Add admin password if specified
        if (config.getAdminPassword() != null && !config.getAdminPassword().isEmpty()) {
            String hashedPassword = hashPassword(config.getAdminPassword());
            xml.append("  <key>hashedAdminPassword</key>\n");
            xml.append("  <string>").append(hashedPassword).append("</string>\n");
        }

        // URL filtering
        xml.append("  <key>URLFilterEnable</key>\n");
        xml.append("  <true/>\n");

        // Allow only the Canvas domain
        xml.append("  <key>URLFilterRules</key>\n");
        xml.append("  <array>\n");
        xml.append("    <dict>\n");
        xml.append("      <key>action</key>\n");
        xml.append("      <integer>1</integer>\n");
        xml.append("      <key>active</key>\n");
        xml.append("      <true/>\n");
        xml.append("      <key>expression</key>\n");
        xml.append("      <string>canvas.instructure.com/*</string>\n");
        xml.append("      <key>regex</key>\n");
        xml.append("      <false/>\n");
        xml.append("    </dict>\n");
        xml.append("  </array>\n");

        xml.append("</dict>\n");
        xml.append("</plist>\n");

        return xml.toString();
    }

    /**
     * Simple password hashing for SEB (in production, use a better algorithm)
     */
    private String hashPassword(String password) {
        // In a real implementation, use a proper hashing algorithm as specified in SEB docs
        // This is just a placeholder
        return Base64.getEncoder().encodeToString(password.getBytes(StandardCharsets.UTF_8));
    }
}