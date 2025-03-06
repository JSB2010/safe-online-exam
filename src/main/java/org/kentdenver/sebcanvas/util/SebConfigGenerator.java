package org.kentdenver.sebcanvas.util;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.SebConfig;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPOutputStream;

/**
 * Utility class for generating SEB configuration files (.seb).
 *
 * This component handles the creation of .seb files according to the
 * Safe Exam Browser specification. The format of .seb files consists of:
 * 1. A prefix indicating the file type (e.g., "plnd" for plaintext, "pswd" for password-protected)
 * 2. An XML plist containing the SEB configuration
 * 3. GZIP compression of the entire file
 *
 * References:
 * - SEB documentation: https://safeexambrowser.org/developer/seb-config-key.html
 * - SEB file format: https://safeexambrowser.org/developer/seb-file-format.html
 */
@Component
@Slf4j
public class SebConfigGenerator {

    // Constants for SEB file format
    private static final String PLAIN_PREFIX = "plnd"; // Prefix for unencrypted config
    private static final String PASSWORD_PREFIX = "pswd"; // Prefix for password-encrypted config

    /**
     * Generate a basic SEB config file without password protection.
     *
     * @param config SEB configuration settings
     * @param browserExamKey The Browser Exam Key for the configuration
     * @return Byte array containing the .seb file
     * @throws IOException If there's an error during file generation
     */
    public byte[] generateSebFile(SebConfig config, String browserExamKey) throws IOException {
        log.debug("Generating SEB config file with Browser Exam Key: {}", browserExamKey);

        // Create XML configuration content in Apple plist format
        String xmlConfig = createXmlConfig(config, browserExamKey);

        // Prefix the XML with "plnd" to indicate plain (unencrypted) data
        String prefixedData = PLAIN_PREFIX + xmlConfig;

        // Compress with GZIP as required by SEB format
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (GZIPOutputStream gzos = new GZIPOutputStream(baos)) {
            gzos.write(prefixedData.getBytes(StandardCharsets.UTF_8));
        }

        byte[] result = baos.toByteArray();
        log.debug("SEB config file generated, size: {} bytes", result.length);

        return result;
    }

    /**
     * Create XML config for SEB in Apple plist format.
     *
     * @param config SEB configuration settings
     * @param browserExamKey The Browser Exam Key for security validation
     * @return XML string in plist format
     */
    private String createXmlConfig(SebConfig config, String browserExamKey) {
        StringBuilder xml = new StringBuilder();

        // XML header and plist DTD
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n");
        xml.append("<plist version=\"1.0\">\n");
        xml.append("<dict>\n");

        // Basic SEB settings
        appendPlistProperty(xml, "allowQuit", config.isAllowQuit());
        appendPlistProperty(xml, "browserWindowAllowReload", true);
        appendPlistProperty(xml, "enableBrowserWindowToolbar", false);
        appendPlistProperty(xml, "enableSebBrowser", true);
        appendPlistProperty(xml, "blockPopUpWindows", config.isBlockExplorer());
        appendPlistProperty(xml, "enablePrintScreen", !config.isDisableScreenCapture());
        appendPlistProperty(xml, "allowPrinting", !config.isDisablePrinting());

        // Browser exam key for security validation
        appendPlistProperty(xml, "browserExamKey", browserExamKey);

        // Start URL - where SEB will navigate on launch
        appendPlistProperty(xml, "startURL", config.getStartURL());

        // Quit URL if specified - where SEB will detect completion and exit
        if (config.getQuitURL() != null && !config.getQuitURL().isEmpty()) {
            appendPlistProperty(xml, "quitURL", config.getQuitURL());
        }

        // If quit password is specified, add it (for manual exit)
        if (config.getQuitPassword() != null && !config.getQuitPassword().isEmpty()) {
            appendPlistProperty(xml, "hashedQuitPassword", config.getQuitPassword());
        }

        // If admin password is specified, add it (for accessing SEB settings)
        if (config.getAdminPassword() != null && !config.getAdminPassword().isEmpty()) {
            appendPlistProperty(xml, "hashedAdminPassword", config.getAdminPassword());
        }

        // URL filtering - allow only the Canvas domain
        appendPlistProperty(xml, "URLFilterEnable", true);
        xml.append("  <key>URLFilterRules</key>\n");
        xml.append("  <array>\n");

        // Allow Canvas domain and subdomains
        xml.append("    <dict>\n");
        xml.append("      <key>action</key>\n");
        xml.append("      <integer>1</integer>\n"); // 1 = allow, 0 = block
        xml.append("      <key>active</key>\n");
        xml.append("      <true/>\n");
        xml.append("      <key>expression</key>\n");
        xml.append("      <string>*.instructure.com/*</string>\n");
        xml.append("      <key>regex</key>\n");
        xml.append("      <false/>\n");
        xml.append("    </dict>\n");

        // Add additional domains if needed
        // For example, if your tool is hosted on a different domain

        xml.append("  </array>\n");

        // Close the dict and plist tags
        xml.append("</dict>\n");
        xml.append("</plist>\n");

        return xml.toString();
    }

    /**
     * Append a boolean property to the plist XML.
     *
     * @param xml The StringBuilder containing the XML
     * @param key The property key
     * @param value The boolean value
     */
    private void appendPlistProperty(StringBuilder xml, String key, boolean value) {
        xml.append("  <key>").append(key).append("</key>\n");
        xml.append("  <").append(value ? "true" : "false").append("/>\n");
    }

    /**
     * Append a string property to the plist XML.
     *
     * @param xml The StringBuilder containing the XML
     * @param key The property key
     * @param value The string value
     */
    private void appendPlistProperty(StringBuilder xml, String key, String value) {
        xml.append("  <key>").append(key).append("</key>\n");
        xml.append("  <string>").append(escapeXml(value)).append("</string>\n");
    }

    /**
     * Escape special characters in XML content.
     *
     * @param s The string to escape
     * @return The escaped string
     */
    private String escapeXml(String s) {
        if (s == null) return "";

        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }
}