import { describe, expect, it, vi } from "vitest";
import { createDecipheriv, createHash, createHmac, generateKeyPairSync, pbkdf2Sync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { AppConfig } from "../../src/server/config/app-config.js";
import {
  encryptSebConfigWithPublicKey,
  keyMaterialFromPem,
  wrapSebConfigPayload
} from "../../src/server/services/seb-config-encryption.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

describe("SEB config certificate encryption", () => {
  it("rejects RSA keys below the minimum security strength", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" }) as string;

    expect(() => keyMaterialFromPem(publicKeyPem)).toThrow(/at least 2048 bits/u);
  });

  it("requires a current end-entity certificate with RSA encryption Key Usage", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        keyMaterialFromPem(TEST_ENCRYPTION_CERTIFICATE, "test certificate", Date.parse("2026-07-13T14:00:00Z"))
      ).not.toThrow();
      expect(() =>
        keyMaterialFromPem(TEST_ENCRYPTION_CERTIFICATE, "test certificate", Date.parse("2026-07-15T00:00:00Z"))
      ).toThrow(/expired/u);
      expect(warning).toHaveBeenCalledWith(
        "SEB config encryption certificate expires within 30 days",
        expect.any(String)
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("revalidates a cached certificate before every assessment download", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-13T14:00:00Z"));
    try {
      const service = new SebConfigurationService({
        value: {
          seb: {
            configEncryption: {
              enabled: true,
              certificatePem: TEST_ENCRYPTION_CERTIFICATE
            }
          }
        }
      } as AppConfig);
      const plainConfig = Buffer.from("<plist><dict /></plist>");

      expect(() =>
        service.prepareSebConfigurationDownload(plainConfig, { requireCertificateEncryption: true })
      ).not.toThrow();

      now.mockReturnValue(Date.parse("2026-07-13T12:00:00Z"));
      expect(() =>
        service.prepareSebConfigurationDownload(plainConfig, { requireCertificateEncryption: true })
      ).toThrow(/certificate is not yet valid/u);

      now.mockReturnValue(Date.parse("2026-07-15T00:00:00Z"));
      expect(() =>
        service.prepareSebConfigurationDownload(plainConfig, { requireCertificateEncryption: true })
      ).toThrow(/certificate has expired/u);
    } finally {
      now.mockRestore();
      warning.mockRestore();
    }
  });

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

  it("wraps password-protected settings in SEB pswd format", () => {
    const plainConfig = Buffer.from(
      "<plist><dict><key>startURL</key><string>https://canvas.example.edu</string></dict></plist>"
    );

    const wrapped = wrapSebConfigPayload(plainConfig, "exam-start");

    expect(wrapped.subarray(0, 4).toString("utf8")).toBe("pswd");
    expect(gunzipSync(decryptRncryptor(wrapped.subarray(4), "exam-start"))).toEqual(plainConfig);
    expect(wrapped.toString("utf8")).not.toContain("canvas.example.edu");
  });

  it("can combine pkhs certificate encryption with an inner pswd block", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" }) as string;
    const keyMaterial = keyMaterialFromPem(publicKeyPem);
    const encryptedBlocks: Buffer[] = [];
    const plainConfig = Buffer.from(
      "<plist><dict><key>startURL</key><string>https://canvas.example.edu</string></dict></plist>"
    );

    encryptSebConfigWithPublicKey(plainConfig, keyMaterial, {
      startPassword: "exam-start",
      encryptBlock: (block) => {
        encryptedBlocks.push(Buffer.from(block));
        return Buffer.alloc(256, encryptedBlocks.length);
      }
    });

    const innerBlock = Buffer.concat(encryptedBlocks);
    expect(innerBlock.subarray(0, 4).toString("utf8")).toBe("pswd");
    expect(gunzipSync(decryptRncryptor(innerBlock.subarray(4), "exam-start"))).toEqual(plainConfig);
  });

  it("allows plaintext only when the caller does not require assessment certificate encryption", () => {
    const previous = process.env.SEB_CONFIG_ENCRYPTION_ENABLED;
    process.env.SEB_CONFIG_ENCRYPTION_ENABLED = "false";
    try {
      const service = new SebConfigurationService(new AppConfig());
      const plainConfig = Buffer.from("<plist><dict /></plist>");

      expect(service.prepareSebConfigurationDownload(plainConfig)).toBe(plainConfig);
      expect(() =>
        service.prepareSebConfigurationDownload(plainConfig, { requireCertificateEncryption: true })
      ).toThrow(/Certificate encryption is required/u);
    } finally {
      restoreEnv("SEB_CONFIG_ENCRYPTION_ENABLED", previous);
    }
  });

  it("allows password-only wrapping for non-assessment callers when certificate encryption is not required", () => {
    const previous = process.env.SEB_CONFIG_ENCRYPTION_ENABLED;
    process.env.SEB_CONFIG_ENCRYPTION_ENABLED = "false";
    try {
      const service = new SebConfigurationService(new AppConfig());
      const plainConfig = Buffer.from("<plist><dict /></plist>");

      const download = service.prepareSebConfigurationDownload(plainConfig, {
        startPassword: "unique-start-passphrase"
      });
      const wrapped = gunzipSync(download);

      expect(wrapped.subarray(0, 4).toString("utf8")).toBe("pswd");
      expect(gunzipSync(decryptRncryptor(wrapped.subarray(4), "unique-start-passphrase"))).toEqual(plainConfig);
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

  it("strips bundled private-key PEM blocks from public certificate output", () => {
    const certificatePem = [
      "-----BEGIN CERTIFICATE-----",
      "MIIC/zCCAeegAwIBAgIUFmDZUn12UAxF0S+6EdK/NLU2UQUwDQYJKoZIhvcNAQEL",
      "BQAwDzENMAsGA1UEAwwEdGVzdDAeFw0yNjA3MTQwNjIzNDZaFw0yNjA3MTUwNjIz",
      "NDZaMA8xDTALBgNVBAMMBHRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK",
      "AoIBAQDaRgIIOz6F2VeK/YQtMN+HOidAmh1iGVsg6zdaFZvkfoTRj9u3m3d2uBpl",
      "HNa9sEf5RPpcR7CNLR6LIo1c8j0SJVy/RgFA9HUkurBegsn/ElAG8oskBy1njkIo",
      "T45cQ9Kh4Sne8qQHAyzdguiaOK28SrCBry+FKYtTfNCF06NU1zRr8gjvzjJAyUbJ",
      "1749Vl26fk995+CGpkS+M/JN+lmLdlGIYWXIpsFglzVqZ4iaNfLV7D7oiGLPxcDS",
      "VZj4uNPwVi0uf8pH/iwKuhGAf2JqPeqcir3KOz7a34M4cmmmZGOq6cOAlctDicru",
      "hs7QAdt179+WU4p0g5ytpEq7DSSXAgMBAAGjUzBRMB0GA1UdDgQWBBSLlB4V3wfE",
      "FF1nVVfLlrBJ1gNByDAfBgNVHSMEGDAWgBSLlB4V3wfEFF1nVVfLlrBJ1gNByDAP",
      "BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAgusVeY8uOHmXNI61y",
      "me/4CbToQdV0tHqVWK97MW/pQ/YDJbn1skABdc1JbyhAeGaz15GZayfHjZTvKwYg",
      "AkVOxCc8wsv0ouqhSAUL6aUhCwnQox3q8HUhq0otRE14XfR8kpZOL6/MpHTXnGXX",
      "WjHBLLlLLh46GN8yHdvzCRLctd4q231lfR/I6pWmv5Fb+oAQepslWThgC+UlTCp2",
      "pfG2jRUJt2RrhnxH6TejKIbam3hsaJjfu1QgvVksTjgXvvHSTTKUL92RmEXO2NC0",
      "3kO5fiTL90r+FKsdLsBIFlwoynBygBfSsFwCPRT/IHQWVpkOtOAcPETeaq5lQBZ/",
      "geOD",
      "-----END CERTIFICATE-----"
    ].join("\n");
    const bundledPem = `${certificatePem}\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n`;

    const keyMaterial = keyMaterialFromPem(bundledPem);

    expect(keyMaterial.certificatePem).toBe(`${certificatePem}\n`);
    expect(keyMaterial.certificatePem).not.toContain("PRIVATE KEY");
  });
});

function decryptRncryptor(encrypted: Buffer, password: string): Buffer {
  const version = encrypted[0];
  const options = encrypted[1];
  expect(version).toBe(3);
  expect(options & 1).toBe(1);
  const encryptionSalt = encrypted.subarray(2, 10);
  const hmacSalt = encrypted.subarray(10, 18);
  const iv = encrypted.subarray(18, 34);
  const ciphertext = encrypted.subarray(34, encrypted.length - 32);
  const hmac = encrypted.subarray(encrypted.length - 32);
  const encryptionKey = pbkdf2Sync(password, encryptionSalt, 10000, 32, "sha1");
  const hmacKey = pbkdf2Sync(password, hmacSalt, 10000, 32, "sha1");
  const expectedHmac = createHmac("sha256", hmacKey).update(encrypted.subarray(0, 34)).update(ciphertext).digest();
  expect(hmac).toEqual(expectedHmac);
  const decipher = createDecipheriv("aes-256-cbc", encryptionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

const TEST_ENCRYPTION_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDDzCCAfegAwIBAgIUTVqWS5LNrVP73MfQMvc3Ezx6Ks8wDQYJKoZIhvcNAQEL
BQAwDzENMAsGA1UEAwwEdGVzdDAeFw0yNjA3MTMxMzA5NDdaFw0yNjA3MTQxMzA5
NDdaMA8xDTALBgNVBAMMBHRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQCtqjvuCYKlJrKoUBxjcu0j/Q5JzCB0CiQSYTwH4v1w6nLeJol21z54ORvA
zB4gmOgVsiwk07WcUXmp+R26eMZgIsnat7Amt/1LUIU8tioFDwGIlvNEGn9oBKUh
YGphRbE9OA7VIKj5GR1FbKAjD2oXJh+QpQiSvDHC8hc/pcg1hZ5AaOyHlJ64tuBE
N5iNPmd0rjrMLenh1gYZu1SPQPM4d2v0fF/diyE6TkC2qkWYdd/dn56F/8j2bKtN
cMwV0svQTzEZ9PEhIuACZ69+D1+rGH5MaBurK/mcn2WGcCC8ttwJbZjQ1dw4zXmI
/GlXM4fq71Q7rMY6EHvRKRYOtV2FAgMBAAGjYzBhMB0GA1UdDgQWBBSVWl8Pv80u
/mne2Uis1h3Z+D8v+TAfBgNVHSMEGDAWgBSVWl8Pv80u/mne2Uis1h3Z+D8v+TAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIEMDANBgkqhkiG9w0BAQsFAAOC
AQEAdGCY5dfU9j3uZitu/ImYgsfWa/a8tp9+olbYNi8gW2BabtLu3I1Y7x4RMkll
Oqjl2zQpvyBJ56Q1WFWOPUhU81D2lf0ydtdbfLKsvcSX02WC5NEjt6cC6zbTJmPc
D019bN1lAnGZKK1wSgY1gfHIndQoXKEY4xDk+oOifSfKKabNa6R0Gs4Lhg/Bq4mJ
2+aedlR+ge7GyJWrC/dfwVtkCznMd/1WzarGf2aTAFBEB2UUtm11zzNpx/tqMHeW
ClruPCLNejsy4A5v/qlF1dJW93hroVEI+YxVp90LzQot78+W/nNFSUznljie2/wV
E81UceKphlt0QCKPmIszpT5ExQ==
-----END CERTIFICATE-----`;
