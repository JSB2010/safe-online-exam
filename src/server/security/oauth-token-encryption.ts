import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { OAuthToken } from "../../shared/models.js";

export type OAuthTokenEncryptionMode = "compat" | "enforce";

export interface OAuthTokenEncryptionSettings {
  mode: OAuthTokenEncryptionMode;
  activeKeyId: string;
  keyring: string;
}

export interface OAuthTokenEncryptionEnvelope {
  version: 1;
  algorithm: "A256GCM";
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

export type PersistedOAuthToken = Omit<OAuthToken, "accessToken" | "refreshToken"> & {
  accessToken?: never;
  refreshToken?: never;
  tokenEncryption?: OAuthTokenEncryptionEnvelope;
};

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = "A256GCM";

export class OAuthTokenCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(private readonly settings: OAuthTokenEncryptionSettings) {
    const validationError = oauthTokenEncryptionSettingsError(settings);
    if (validationError) {
      throw new Error(validationError);
    }
    this.keys = parseKeyring(settings.keyring);
  }

  get writesEncrypted(): boolean {
    return this.settings.mode === "enforce";
  }

  encode(id: string, token: OAuthToken): PersistedOAuthToken | OAuthToken {
    assertTokenIdentity(id, token.userId);
    if (this.settings.mode === "compat") {
      return { ...token };
    }

    const key = this.keys.get(this.settings.activeKeyId)!;
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(additionalAuthenticatedData(id, token.userId));
    const plaintext = Buffer.from(
      JSON.stringify({ accessToken: token.accessToken, refreshToken: token.refreshToken ?? null }),
      "utf8"
    );
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const metadata = { ...token } as Omit<OAuthToken, "accessToken" | "refreshToken">;
    delete (metadata as Partial<OAuthToken>).accessToken;
    delete (metadata as Partial<OAuthToken>).refreshToken;
    return {
      ...metadata,
      tokenEncryption: {
        version: ENVELOPE_VERSION,
        algorithm: ENVELOPE_ALGORITHM,
        keyId: this.settings.activeKeyId,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url")
      }
    };
  }

  decode(id: string, document: Record<string, unknown>): OAuthToken {
    const userId = typeof document.userId === "string" ? document.userId : "";
    assertTokenIdentity(id, userId);
    const envelope = document.tokenEncryption;
    const hasLegacyToken = typeof document.accessToken === "string" || document.refreshToken !== undefined;

    if (envelope === undefined) {
      if (typeof document.accessToken !== "string" || !document.accessToken) {
        throw new Error("Stored Canvas OAuth token has no encrypted envelope or legacy access token");
      }
      return { ...document } as unknown as OAuthToken;
    }
    if (hasLegacyToken) {
      throw new Error("Stored Canvas OAuth token mixes encrypted and plaintext token fields");
    }

    const parsed = parseEnvelope(envelope);
    const key = this.keys.get(parsed.keyId);
    if (!key) {
      throw new Error(`Stored Canvas OAuth token references unavailable key ID: ${parsed.keyId}`);
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.nonce, "base64url"), {
        authTagLength: TAG_BYTES
      });
      decipher.setAAD(additionalAuthenticatedData(id, userId));
      decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(parsed.ciphertext, "base64url")),
        decipher.final()
      ]).toString("utf8");
      const tokens = JSON.parse(plaintext) as { accessToken?: unknown; refreshToken?: unknown };
      if (typeof tokens.accessToken !== "string" || !tokens.accessToken) {
        throw new Error("decrypted access token is missing");
      }
      if (
        tokens.refreshToken !== null &&
        tokens.refreshToken !== undefined &&
        typeof tokens.refreshToken !== "string"
      ) {
        throw new Error("decrypted refresh token is invalid");
      }
      const metadata = { ...document };
      delete metadata.tokenEncryption;
      return {
        ...metadata,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken as string | null | undefined
      } as OAuthToken;
    } catch (cause) {
      throw new Error("Unable to decrypt stored Canvas OAuth token", { cause });
    }
  }

  needsRewrite(document: Record<string, unknown>): boolean {
    const envelope = document.tokenEncryption;
    if (envelope === undefined) {
      return true;
    }
    if (typeof document.accessToken === "string" || document.refreshToken !== undefined) {
      throw new Error("Stored Canvas OAuth token mixes encrypted and plaintext token fields");
    }
    return parseEnvelope(envelope).keyId !== this.settings.activeKeyId;
  }
}

export function oauthTokenEncryptionSettingsError(settings: OAuthTokenEncryptionSettings): string | null {
  if (settings.mode !== "compat" && settings.mode !== "enforce") {
    return "OAUTH_TOKEN_ENCRYPTION_MODE must be compat or enforce";
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(settings.activeKeyId)) {
    return "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID must be 1-64 safe identifier characters";
  }
  let keyring: ReadonlyMap<string, Buffer>;
  try {
    keyring = parseKeyring(settings.keyring);
  } catch (error) {
    return error instanceof Error ? error.message : "OAUTH_TOKEN_ENCRYPTION_KEYRING must be valid";
  }
  if (!keyring.has(settings.activeKeyId)) {
    return "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID must identify a key in OAUTH_TOKEN_ENCRYPTION_KEYRING";
  }
  return null;
}

function parseKeyring(raw: string): ReadonlyMap<string, Buffer> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEYRING must be a JSON object");
  }
  if (!isPlainRecord(value) || Object.keys(value).length === 0) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEYRING must be a non-empty JSON object");
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(value)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyId) || typeof encoded !== "string") {
      throw new Error("OAUTH_TOKEN_ENCRYPTION_KEYRING contains an invalid key ID or value");
    }
    const key = decodeCanonicalBase64Url(encoded, KEY_BYTES);
    if (!key) {
      throw new Error("Every OAUTH_TOKEN_ENCRYPTION_KEYRING value must be a 32-byte base64url key");
    }
    keys.set(keyId, key);
  }
  return keys;
}

function parseEnvelope(value: unknown): OAuthTokenEncryptionEnvelope {
  if (!isPlainRecord(value)) {
    throw new Error("Stored Canvas OAuth token encryption envelope is invalid");
  }
  const { version, algorithm, keyId, nonce, ciphertext, tag } = value;
  if (
    version !== ENVELOPE_VERSION ||
    algorithm !== ENVELOPE_ALGORITHM ||
    typeof keyId !== "string" ||
    typeof nonce !== "string" ||
    !decodeCanonicalBase64Url(nonce, NONCE_BYTES) ||
    typeof ciphertext !== "string" ||
    !decodeCanonicalBase64Url(ciphertext) ||
    typeof tag !== "string" ||
    !decodeCanonicalBase64Url(tag, TAG_BYTES)
  ) {
    throw new Error("Stored Canvas OAuth token encryption envelope is invalid");
  }
  return value as unknown as OAuthTokenEncryptionEnvelope;
}

function additionalAuthenticatedData(id: string, userId: string): Buffer {
  return Buffer.from(`canvas-oauth-token\0v1\0${id}\0${userId}`, "utf8");
}

function assertTokenIdentity(id: string, userId: string): void {
  if (!id || !userId) {
    throw new Error("Canvas OAuth token ID and user ID are required for encryption");
  }
}

function decodeCanonicalBase64Url(value: string, expectedBytes?: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if ((expectedBytes !== undefined && decoded.length !== expectedBytes) || decoded.toString("base64url") !== value) {
    return null;
  }
  return decoded;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
