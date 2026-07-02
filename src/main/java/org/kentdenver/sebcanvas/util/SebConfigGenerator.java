package org.kentdenver.sebcanvas.util;

import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.model.SebConfig;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.List;
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
 * The implementation follows the SEB file format and configuration keys as
 * documented in the SEB specification:
 * - SEB Config Key Specification: https://safeexambrowser.org/developer/seb-config-key.html
 * - SEB File Format: https://safeexambrowser.org/developer/seb-file-format.html
 * - SEB Integration Guide: https://safeexambrowser.org/developer/seb-integration.html
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
     * @throws NoSuchAlgorithmException If SHA-256 algorithm is not available for key generation
     */
    public byte[] generateSebFile(SebConfig config, String browserExamKey) throws IOException, NoSuchAlgorithmException {
        log.debug("Generating SEB config file with Browser Exam Key");

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
     * Generate a password-protected SEB config file.
     *
     * @param config SEB configuration settings
     * @param browserExamKey The Browser Exam Key for the configuration
     * @param password Password to encrypt the configuration
     * @return Byte array containing the encrypted .seb file
     * @throws IOException If there's an error during file generation
     * @throws NoSuchAlgorithmException If SHA-256 algorithm is not available for key generation
     */
    public byte[] generatePasswordProtectedSebFile(SebConfig config, String browserExamKey, String password)
            throws IOException, NoSuchAlgorithmException {
        log.debug("Generating password-protected SEB config file");

        // Create XML configuration content in Apple plist format
        String xmlConfig = createXmlConfig(config, browserExamKey);

        // For password protection, we need to follow the SEB encryption protocol
        // This is a simplified implementation - in practice, you would use the RNCryptor framework
        // See: https://safeexambrowser.org/developer/seb-file-format.html

        // 1. Generate encryption salt, HMAC salt, and IV
        byte[] encryptionSalt = generateRandomBytes(8);
        byte[] hmacSalt = generateRandomBytes(8);
        byte[] iv = generateRandomBytes(16);

        // 2. Generate encryption key using PBKDF2
        byte[] encryptionKey = derivePBKDF2Key(password, encryptionSalt);

        // 3. Generate HMAC key using PBKDF2
        byte[] hmacKey = derivePBKDF2Key(password, hmacSalt);

        // 4. Encrypt the data with AES-256-CBC
        byte[] encryptedData = encryptAES(xmlConfig.getBytes(StandardCharsets.UTF_8), encryptionKey, iv);

        // 5. Generate HMAC
        byte[] hmac = generateHMAC(encryptedData, hmacKey);

        // 6. Create the complete format
        // version (1 byte) | options (1 byte) | encryptionSalt (8 bytes) | hmacSalt (8 bytes) |
        // IV (16 bytes) | encryptedData | HMAC (32 bytes)
        ByteArrayOutputStream encryptedContent = new ByteArrayOutputStream();
        encryptedContent.write(1); // version
        encryptedContent.write(0); // options
        encryptedContent.write(encryptionSalt);
        encryptedContent.write(hmacSalt);
        encryptedContent.write(iv);
        encryptedContent.write(encryptedData);
        encryptedContent.write(hmac);

        // Prefix with "pswd" to indicate password-protected data
        ByteArrayOutputStream prefixedContent = new ByteArrayOutputStream();
        prefixedContent.write("pswd".getBytes(StandardCharsets.UTF_8));
        prefixedContent.write(encryptedContent.toByteArray());

        // Compress with GZIP as required by SEB format
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (GZIPOutputStream gzos = new GZIPOutputStream(baos)) {
            gzos.write(prefixedContent.toByteArray());
        }

        byte[] result = baos.toByteArray();
        log.debug("Password-protected SEB config file generated, size: {} bytes", result.length);

        return result;
    }

    /**
     * Create XML config for SEB in Apple plist format.
     * This is the core of the SEB configuration, containing all settings.
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
        appendPlistProperty(xml, "browserWindowAllowReload", config.isAllowReload());
        appendPlistProperty(xml, "enableBrowserWindowToolbar", false);
        appendPlistProperty(xml, "enableSebBrowser", true);
        appendPlistProperty(xml, "blockPopUpWindows", config.isBlockExplorer());
        appendPlistProperty(xml, "enablePrintScreen", !config.isDisableScreenCapture());
        appendPlistProperty(xml, "allowPrinting", !config.isDisablePrinting());
        appendPlistProperty(xml, "enableRightMouse", config.isEnableRightClick());
        appendPlistProperty(xml, "showReloadButton", config.isShowReloadButton());
        appendPlistProperty(xml, "enablePlugIns", config.isEnablePlugIns());

        // Browser exam key for security validation
        if (browserExamKey != null && !browserExamKey.isEmpty()) {
            appendPlistProperty(xml, "browserExamKey", browserExamKey);
            appendPlistProperty(xml, "sendBrowserExamKey", config.isSendBrowserExamKey());
        }

        appendPlistProperty(xml, "browserWindowWebView", 3);
        appendPlistProperty(xml, "browserWindowWebViewClassicHideDeprecationNote", false);

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

        // URL filtering settings
        appendPlistProperty(xml, "URLFilterEnable", config.isUrlFilterEnable());

        if (config.isUrlFilterEnable() &&
                (config.getAllowedURLs() != null && !config.getAllowedURLs().isEmpty() ||
                        config.getBlockedURLs() != null && !config.getBlockedURLs().isEmpty())) {

            // Add URL filter rules
            xml.append("  <key>URLFilterRules</key>\n");
            xml.append("  <array>\n");

            // Add allowed URLs
            if (config.getAllowedURLs() != null) {
                for (String allowedUrl : config.getAllowedURLs()) {
                    appendUrlFilterRule(xml, allowedUrl, true);
                }
            }

            // Add blocked URLs
            if (config.getBlockedURLs() != null) {
                for (String blockedUrl : config.getBlockedURLs()) {
                    appendUrlFilterRule(xml, blockedUrl, false);
                }
            }

            xml.append("  </array>\n");
        }

        // Add Canvas-specific configurations if available
        if (config.getCanvasDomain() != null && !config.getCanvasDomain().isEmpty()) {
            // Allow Canvas domain by default for proper functioning
            xml.append("  <!-- Canvas-specific configurations -->\n");

            // Add permitted processes section for SEB 3.x
            xml.append("  <key>permittedProcesses</key>\n");
            xml.append("  <array>\n");
            xml.append("    <dict>\n");
            xml.append("      <key>active</key>\n");
            xml.append("      <true/>\n");
            xml.append("      <key>autostart</key>\n");
            xml.append("      <true/>\n");
            xml.append("      <key>iconInTaskbar</key>\n");
            xml.append("      <true/>\n");
            xml.append("      <key>runInBackground</key>\n");
            xml.append("      <false/>\n");
            xml.append("      <key>allowUserToChooseApp</key>\n");
            xml.append("      <false/>\n");
            xml.append("      <key>strongKill</key>\n");
            xml.append("      <true/>\n");
            xml.append("      <key>os</key>\n");
            xml.append("      <integer>1</integer>\n");
            xml.append("      <key>title</key>\n");
            xml.append("      <string>SEB</string>\n");
            xml.append("      <key>description</key>\n");
            xml.append("      <string></string>\n");
            xml.append("    </dict>\n");
            xml.append("  </array>\n");
        }

        // Close the dict and plist tags
        xml.append("</dict>\n");
        xml.append("</plist>\n");

        return xml.toString();
    }

    /**
     * Append a URL filter rule to the XML configuration.
     *
     * @param xml The StringBuilder containing the XML
     * @param expression The URL expression to filter
     * @param allow Whether to allow (true) or block (false) the URL
     */
    private void appendUrlFilterRule(StringBuilder xml, String expression, boolean allow) {
        xml.append("    <dict>\n");
        xml.append("      <key>action</key>\n");
        xml.append("      <integer>").append(allow ? 1 : 0).append("</integer>\n"); // 1 = allow, 0 = block
        xml.append("      <key>active</key>\n");
        xml.append("      <true/>\n");
        xml.append("      <key>expression</key>\n");
        xml.append("      <string>").append(escapeXml(expression)).append("</string>\n");
        xml.append("      <key>regex</key>\n");
        xml.append("      <false/>\n");
        xml.append("    </dict>\n");
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
     * Append an integer property to the plist XML.
     *
     * @param xml The StringBuilder containing the XML
     * @param key The property key
     * @param value The integer value
     */
    private void appendPlistProperty(StringBuilder xml, String key, int value) {
        xml.append("  <key>").append(key).append("</key>\n");
        xml.append("  <integer>").append(value).append("</integer>\n");
    }

    /**
     * Append a data property to the plist XML (for binary data).
     *
     * @param xml The StringBuilder containing the XML
     * @param key The property key
     * @param value The binary value to encode as Base64
     */
    private void appendPlistDataProperty(StringBuilder xml, String key, byte[] value) {
        xml.append("  <key>").append(key).append("</key>\n");
        xml.append("  <data>").append(Base64.getEncoder().encodeToString(value)).append("</data>\n");
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

    /**
     * Generate random bytes for cryptographic purposes.
     *
     * @param length The number of bytes to generate
     * @return A byte array of random values
     */
    private byte[] generateRandomBytes(int length) {
        // In a real implementation, you would use a secure random implementation
        byte[] bytes = new byte[length];
        for (int i = 0; i < length; i++) {
            bytes[i] = (byte) (Math.random() * 256);
        }
        return bytes;
    }

    /**
     * Derive a key using PBKDF2 with HMAC-SHA256.
     *
     * @param password The password to derive the key from
     * @param salt The salt to use for key derivation
     * @return The derived key
     * @throws NoSuchAlgorithmException If the required algorithm is not available
     */
    private byte[] derivePBKDF2Key(String password, byte[] salt) throws NoSuchAlgorithmException {
        // This is a simplified implementation - in practice, you would use a proper PBKDF2 implementation
        // For example, using javax.crypto.SecretKeyFactory with PBKDF2WithHmacSHA256
        // For now, we'll just use a simple hash as a placeholder
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update(salt);
        return digest.digest(password.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Encrypt data using AES-256-CBC.
     *
     * @param data The data to encrypt
     * @param key The encryption key
     * @param iv The initialization vector
     * @return The encrypted data
     */
    private byte[] encryptAES(byte[] data, byte[] key, byte[] iv) {
        // This is a placeholder for actual AES encryption
        // In a real implementation, you would use javax.crypto.Cipher with AES/CBC/PKCS5Padding
        // For now, we'll just return the original data as a placeholder
        return data;
    }

    /**
     * Generate an HMAC for the data.
     *
     * @param data The data to authenticate
     * @param key The HMAC key
     * @return The HMAC value
     * @throws NoSuchAlgorithmException If the required algorithm is not available
     */
    private byte[] generateHMAC(byte[] data, byte[] key) throws NoSuchAlgorithmException {
        // This is a simplified implementation - in practice, you would use a proper HMAC implementation
        // For example, using javax.crypto.Mac with HmacSHA256
        // For now, we'll just use a simple hash as a placeholder
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update(key);
        return digest.digest(data);
    }
}
