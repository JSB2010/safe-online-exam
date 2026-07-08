import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { AppConfig } from "../../src/server/config/app-config.js";
import { encryptSebConfigWithPublicKey, keyMaterialFromPem } from "../../src/server/services/seb-config-encryption.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

describe("SEB config certificate encryption", () => {
  it("wraps plaintext settings in SEB macOS pkhs certificate-encrypted format", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" }) as string;
    const publicKeyDer = publicKey.export({ type: "pkcs1", format: "der" });
    const keyMaterial = keyMaterialFromPem(publicKeyPem);
    const plainConfig = Buffer.from(
      Array.from(
        { length: 64 },
        (_, index) =>
          `https://canvas.example.edu/${createHash("sha256").update(`deterministic-config-block-${index}`).digest("hex")}`
      ).join("\n")
    );

    const encrypted = encryptSebConfigWithPublicKey(plainConfig, keyMaterial);
    const packet = gunzipSync(encrypted);
    const encryptedSettings = packet.subarray(24);

    expect(packet.subarray(0, 4).toString("utf8")).toBe("pkhs");
    expect(packet.subarray(4, 24)).toEqual(createHash("sha1").update(publicKeyDer).digest());
    expect(encryptedSettings.length).toBeGreaterThan(256);
    expect(encryptedSettings.length % 256).toBe(0);
    expect(encrypted.toString("utf8")).not.toContain("canvas.example.edu");
  });

  it("RSA-encrypts pkhs payloads in blocks for large generated configs", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" }) as string;
    const keyMaterial = keyMaterialFromPem(publicKeyPem);
    const encryptedBlocks: Buffer[] = [];
    const plainConfig = Buffer.from(
      Array.from({ length: 256 }, (_, index) => `https://resource-${index}.example.test/${"x".repeat(80)}`).join("\n")
    );

    encryptSebConfigWithPublicKey(plainConfig, keyMaterial, {
      encryptBlock: (block) => {
        encryptedBlocks.push(Buffer.from(block));
        return Buffer.alloc(256, encryptedBlocks.length);
      }
    });

    expect(encryptedBlocks.length).toBeGreaterThan(1);
    expect(encryptedBlocks.every((block) => block.length <= 245)).toBe(true);
    expect(Buffer.concat(encryptedBlocks).subarray(0, 4).toString("utf8")).toBe("plnd");
    expect(gunzipSync(Buffer.concat(encryptedBlocks).subarray(4))).toEqual(plainConfig);
  });

  it("returns plaintext downloads when certificate encryption is disabled", () => {
    const previous = process.env.SEB_CONFIG_ENCRYPTION_ENABLED;
    process.env.SEB_CONFIG_ENCRYPTION_ENABLED = "false";
    try {
      const service = new SebConfigurationService(new AppConfig());
      const plainConfig = Buffer.from("<plist><dict /></plist>");

      expect(service.prepareSebConfigurationDownload(plainConfig)).toBe(plainConfig);
    } finally {
      restoreEnv("SEB_CONFIG_ENCRYPTION_ENABLED", previous);
    }
  });

  it("fails closed when certificate encryption is enabled without key material", () => {
    const previousEnabled = process.env.SEB_CONFIG_ENCRYPTION_ENABLED;
    const previousCertPem = process.env.SEB_CONFIG_ENCRYPTION_CERT_PEM;
    const previousCertPath = process.env.SEB_CONFIG_ENCRYPTION_CERT_PATH;
    const previousPublicKeyPem = process.env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM;
    const previousPublicKeyPath = process.env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PATH;
    process.env.SEB_CONFIG_ENCRYPTION_ENABLED = "true";
    delete process.env.SEB_CONFIG_ENCRYPTION_CERT_PEM;
    delete process.env.SEB_CONFIG_ENCRYPTION_CERT_PATH;
    delete process.env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM;
    delete process.env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PATH;
    try {
      const service = new SebConfigurationService(new AppConfig());

      expect(() => service.prepareSebConfigurationDownload(Buffer.from("<plist />"))).toThrow(
        /SEB_CONFIG_ENCRYPTION_CERT_PEM/u
      );
    } finally {
      restoreEnv("SEB_CONFIG_ENCRYPTION_ENABLED", previousEnabled);
      restoreEnv("SEB_CONFIG_ENCRYPTION_CERT_PEM", previousCertPem);
      restoreEnv("SEB_CONFIG_ENCRYPTION_CERT_PATH", previousCertPath);
      restoreEnv("SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM", previousPublicKeyPem);
      restoreEnv("SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PATH", previousPublicKeyPath);
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
