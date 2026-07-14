import { createPrivateKey, type JsonWebKey as NodeJsonWebKey } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { exportJWK, generateKeyPair, importJWK, type JWK } from "jose";
import { AppConfig } from "../config/app-config.js";

const DEFAULT_KEY_ID = "canvas-seb-integration-key";
const MIN_RSA_MODULUS_BITS = 2048;
const REQUIRED_RSA_PUBLIC_EXPONENT = 65537n;

@Injectable()
export class JwkService implements OnModuleInit {
  private publicJwk?: JWK;
  private initialization?: Promise<void>;

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    await this.ensureKey();
  }

  async getPublicJwks(): Promise<{ keys: JWK[] }> {
    await this.ensureKey();
    if (!this.publicJwk) {
      throw new Error("LTI signing key was not initialized");
    }
    return { keys: [publicSigningJwk(this.publicJwk, this.publicJwk.kid || DEFAULT_KEY_ID)] };
  }

  private ensureKey(): Promise<void> {
    this.initialization ??= this.initializeKey();
    return this.initialization;
  }

  private async initializeKey(): Promise<void> {
    const raw = this.config.value.lti.privateKey;
    if (!raw) {
      if (this.config.profile === "prod") {
        throw new Error("LTI_PRIVATE_KEY is required in prod");
      }
      const generated = await generateKeyPair("RS256", { extractable: true });
      this.publicJwk = publicSigningJwk(await exportJWK(generated.publicKey), DEFAULT_KEY_ID);
      return;
    }

    const privateJwk = parseConfiguredPrivateJwk(raw);
    assertStrongRsaSigningKey(privateJwk);
    try {
      await importJWK(privateJwk, "RS256");
    } catch {
      throw new Error("LTI_PRIVATE_KEY must be a valid RSA private JWK");
    }
    this.publicJwk = publicSigningJwk(privateJwk, privateJwk.kid || DEFAULT_KEY_ID);
  }
}

function parseConfiguredPrivateJwk(raw: string): JWK & { kty: "RSA"; n: string; e: string; d: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("LTI_PRIVATE_KEY must contain a valid JSON Web Key");
  }
  if (
    !isRecord(parsed) ||
    parsed.kty !== "RSA" ||
    !isNonEmptyString(parsed.n) ||
    !isNonEmptyString(parsed.e) ||
    !isNonEmptyString(parsed.d)
  ) {
    throw new Error("LTI private key must be an RSA private JWK");
  }
  if (parsed.alg !== undefined && parsed.alg !== "RS256") {
    throw new Error("LTI private key algorithm must be RS256");
  }
  if (parsed.use !== undefined && parsed.use !== "sig") {
    throw new Error("LTI private key use must be sig");
  }
  if (parsed.key_ops !== undefined) {
    if (
      !Array.isArray(parsed.key_ops) ||
      !parsed.key_ops.includes("sign") ||
      parsed.key_ops.some((operation) => operation !== "sign" && operation !== "verify")
    ) {
      throw new Error("LTI private key operations must permit signing only");
    }
  }
  if (parsed.kid !== undefined && (!isNonEmptyString(parsed.kid) || parsed.kid.length > 256)) {
    throw new Error("LTI private key kid must be a non-empty string of at most 256 characters");
  }
  return parsed as unknown as JWK & { kty: "RSA"; n: string; e: string; d: string };
}

function assertStrongRsaSigningKey(privateJwk: JWK): void {
  let key;
  try {
    key = createPrivateKey({ key: privateJwk as unknown as NodeJsonWebKey, format: "jwk" });
  } catch {
    throw new Error("LTI_PRIVATE_KEY must be a valid RSA private JWK");
  }
  const details = key.asymmetricKeyDetails;
  if (key.asymmetricKeyType !== "rsa" || !details?.modulusLength || details.modulusLength < MIN_RSA_MODULUS_BITS) {
    throw new Error(`LTI private key must use an RSA modulus of at least ${MIN_RSA_MODULUS_BITS} bits`);
  }
  if (details.publicExponent !== REQUIRED_RSA_PUBLIC_EXPONENT) {
    throw new Error(`LTI private key must use RSA public exponent ${REQUIRED_RSA_PUBLIC_EXPONENT}`);
  }
}

function publicSigningJwk(jwk: JWK, keyId: string): JWK {
  if (!isNonEmptyString(jwk.n) || !isNonEmptyString(jwk.e)) {
    throw new Error("LTI signing key is missing its RSA public parameters");
  }
  return {
    kty: "RSA",
    n: jwk.n,
    e: jwk.e,
    kid: keyId,
    use: "sig",
    alg: "RS256",
    key_ops: ["verify"]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
