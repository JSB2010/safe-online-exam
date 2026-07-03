package org.kentdenver.sebcanvas.service;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SebConfigKeyServiceTest {

    private final SebConfigKeyService service = new SebConfigKeyService();

    @Test
    void validatesUrlHashedConfigKey() {
        String configKey = service.computeConfigKey(samplePlist());
        String url = "https://canvas.example.com/courses/1/quizzes/2";
        String hash = service.hashForUrl(url, configKey);

        assertTrue(service.validateConfigKeyHashForUrl(hash, url, configKey));
        assertFalse(service.validateConfigKeyHashForUrl(hash, url + "/wrong", configKey));
    }

    @Test
    void computesConfigKeyFromSebJsonWithoutEscapingStringsOrEmptyDicts() {
        String expectedSebJson = "{\"allowQuit\":false,\"startURL\":\"https://example.com/quiz\",\"urlFilterRules\":[{\"action\":1,\"expression\":\"^.*?:\\/\\/example\\.com\\/quiz$\"}]}";

        assertEquals(sha256Hex(expectedSebJson), service.computeConfigKey(plistWithRegexAndEmptyDict()));
    }

    @Test
    void computesConfigKeyUsingSebCaseInsensitiveKeyOrderAndTrimmedStrings() {
        String expectedSebJson = "{\"allowQuit\":false,\"startURL\":\"https://example.com/quiz\",\"URLFilterEnable\":true,\"URLFilterRules\":[{\"action\":1,\"active\":true,\"expression\":\"https://example.com/*\",\"regex\":false}]}";

        assertEquals(sha256Hex(expectedSebJson), service.computeConfigKey(plistWithMixedCaseKeysAndWhitespace()));
    }

    private byte[] samplePlist() {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
                <plist version="1.0">
                  <dict>
                    <key>originatorVersion</key>
                    <string>3.7.0</string>
                    <key>startURL</key>
                    <string>https://app.example.com/seb/launch/classicquiz_2</string>
                    <key>allowQuit</key>
                    <false/>
                  </dict>
                </plist>
                """.getBytes(StandardCharsets.UTF_8);
    }

    private byte[] plistWithRegexAndEmptyDict() {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
                <plist version="1.0">
                  <dict>
                    <key>originatorVersion</key>
                    <string>3.7.0</string>
                    <key>startURL</key>
                    <string>https://example.com/quiz</string>
                    <key>allowQuit</key>
                    <false/>
                    <key>emptySettings</key>
                    <dict/>
                    <key>urlFilterRules</key>
                    <array>
                      <dict>
                        <key>action</key>
                        <integer>1</integer>
                        <key>expression</key>
                        <string>^.*?:\\/\\/example\\.com\\/quiz$</string>
                      </dict>
                    </array>
                  </dict>
                </plist>
                """.getBytes(StandardCharsets.UTF_8);
    }

    private byte[] plistWithMixedCaseKeysAndWhitespace() {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
                <plist version="1.0">
                  <dict>
                    <key>originatorVersion</key>
                    <string>3.7.0</string>
                    <key>URLFilterRules</key>
                    <array>
                      <dict>
                        <key>regex</key>
                        <false/>
                        <key>expression</key>
                        <string>https://example.com/*</string>
                        <key>active</key>
                        <true/>
                        <key>action</key>
                        <integer>1</integer>
                      </dict>
                    </array>
                    <key>allowQuit</key>
                    <false/>
                    <key>URLFilterEnable</key>
                    <true/>
                    <key>startURL</key>
                    <string>
                      https://example.com/quiz
                    </string>
                  </dict>
                </plist>
                """.getBytes(StandardCharsets.UTF_8);
    }

    private String sha256Hex(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("Unable to compute SHA-256", e);
        }
    }
}
