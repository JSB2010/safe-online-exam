import { describe, expect, it } from "vitest";
import {
  OAuthTokenCipher,
  oauthTokenEncryptionSettingsError,
  type OAuthTokenEncryptionSettings
} from "../../src/server/security/oauth-token-encryption.js";

const KEYRING = JSON.stringify({ primary: Buffer.alloc(32, 7).toString("base64url") });
const SETTINGS: OAuthTokenEncryptionSettings = {
  mode: "enforce",
  activeKeyId: "primary",
  keyring: KEYRING
};

describe("OAuthTokenCipher", () => {
  it("encrypts both token values while preserving nonsecret metadata", () => {
    const cipher = new OAuthTokenCipher(SETTINGS);
    const persisted = cipher.encode("user-1", {
      id: "user-1",
      userId: "user-1",
      accessToken: "access-sentinel",
      refreshToken: "refresh-sentinel",
      scope: "url:GET|/api/v1/users/:user_id/profile"
    });

    expect(persisted).toMatchObject({ id: "user-1", userId: "user-1", scope: expect.any(String) });
    expect(JSON.stringify(persisted)).not.toContain("access-sentinel");
    expect(JSON.stringify(persisted)).not.toContain("refresh-sentinel");
    expect(cipher.decode("user-1", persisted as Record<string, unknown>)).toMatchObject({
      accessToken: "access-sentinel",
      refreshToken: "refresh-sentinel"
    });
  });

  it("fails closed for tampering, mixed plaintext, or a mismatched record identity", () => {
    const cipher = new OAuthTokenCipher(SETTINGS);
    const persisted = cipher.encode("user-1", {
      id: "user-1",
      userId: "user-1",
      accessToken: "access-sentinel"
    }) as Record<string, unknown>;
    const envelope = persisted.tokenEncryption as Record<string, unknown>;

    expect(() => cipher.decode("user-2", persisted)).toThrow("Unable to decrypt stored Canvas OAuth token");
    expect(() => cipher.decode("user-1", { ...persisted, accessToken: "plaintext" })).toThrow(
      "mixes encrypted and plaintext"
    );
    expect(() =>
      cipher.decode("user-1", {
        ...persisted,
        tokenEncryption: {
          ...envelope,
          ciphertext: `${String(envelope.ciphertext).startsWith("A") ? "B" : "A"}${String(envelope.ciphertext).slice(1)}`
        }
      })
    ).toThrow("Unable to decrypt stored Canvas OAuth token");
  });

  it("reads legacy documents in both modes and writes plaintext only in explicit compatibility mode", () => {
    const legacy = { id: "user-1", userId: "user-1", accessToken: "legacy-access", refreshToken: "legacy-refresh" };
    const enforcing = new OAuthTokenCipher(SETTINGS);
    const compatible = new OAuthTokenCipher({ ...SETTINGS, mode: "compat" });

    expect(enforcing.decode("user-1", legacy)).toMatchObject(legacy);
    expect(compatible.decode("user-1", legacy)).toMatchObject(legacy);
    expect(compatible.encode("user-1", legacy)).toMatchObject(legacy);
  });

  it("supports key rotation by reading old keys and identifying records for rewrite", () => {
    const rotatingKeyring = JSON.stringify({
      old: Buffer.alloc(32, 3).toString("base64url"),
      current: Buffer.alloc(32, 4).toString("base64url")
    });
    const oldCipher = new OAuthTokenCipher({ mode: "enforce", activeKeyId: "old", keyring: rotatingKeyring });
    const currentCipher = new OAuthTokenCipher({ mode: "enforce", activeKeyId: "current", keyring: rotatingKeyring });
    const persisted = oldCipher.encode("user-1", { userId: "user-1", accessToken: "secret" }) as Record<
      string,
      unknown
    >;

    expect(currentCipher.decode("user-1", persisted)).toMatchObject({ accessToken: "secret" });
    expect(currentCipher.needsRewrite(persisted)).toBe(true);
    expect(currentCipher.needsRewrite(currentCipher.encode("user-1", currentCipher.decode("user-1", persisted)))).toBe(
      false
    );
  });

  it("rejects malformed keyrings and unknown active keys without exposing key material", () => {
    expect(oauthTokenEncryptionSettingsError({ mode: "enforce", activeKeyId: "missing", keyring: KEYRING })).toBe(
      "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID must identify a key in OAUTH_TOKEN_ENCRYPTION_KEYRING"
    );
    expect(
      oauthTokenEncryptionSettingsError({ mode: "enforce", activeKeyId: "primary", keyring: '{"primary":"bad"}' })
    ).toBe("Every OAUTH_TOKEN_ENCRYPTION_KEYRING value must be a 32-byte base64url key");
  });
});
