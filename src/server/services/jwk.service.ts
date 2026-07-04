import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { exportJWK, generateKeyPair, importJWK, jwtVerify, type JWK, SignJWT } from "jose";
import { AppConfig } from "../config/app-config.js";

@Injectable()
export class JwkService {
  private privateJwk?: JWK;
  private publicJwk?: JWK;
  private key?: any;
  private keyId?: string;

  constructor(private readonly config: AppConfig) {}

  async getPublicJwks(): Promise<{ keys: JWK[] }> {
    await this.ensureKey();
    return {
      keys: [
        {
          ...this.publicJwk,
          kid: this.keyId,
          use: "sig",
          alg: "RS256",
          key_ops: ["verify"]
        }
      ]
    };
  }

  async createClientAssertion(clientId: string, issuer: string, audience: string): Promise<string> {
    await this.ensureKey();
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub: clientId,
      jti: randomUUID()
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: this.keyId })
      .setIssuer(issuer.replace(/\/+$/u, ""))
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(this.key!);
  }

  async signDeepLinkingJwt(payload: Record<string, unknown>, issuer: string, audience: string): Promise<string> {
    await this.ensureKey();
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: this.keyId })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(this.key!);
  }

  async verifyOwnJwt(token: string): Promise<Record<string, unknown>> {
    await this.ensureKey();
    const { payload } = await jwtVerify(token, this.key!);
    return payload;
  }

  private async ensureKey(): Promise<void> {
    if (this.key) {
      return;
    }
    const raw = this.config.value.lti.privateKey;
    if (!raw) {
      if (this.config.profile === "prod") {
        throw new Error("LTI_PRIVATE_KEY is required in prod");
      }
      const generated = await generateKeyPair("RS256", { extractable: true });
      this.key = generated.privateKey;
      this.keyId = "canvas-seb-integration-key";
      this.privateJwk = { ...(await exportJWK(generated.privateKey)), kid: this.keyId };
      this.publicJwk = { ...(await exportJWK(generated.publicKey)), kid: this.keyId };
      return;
    } else {
      this.privateJwk = JSON.parse(raw) as JWK;
    }
    if (this.privateJwk.kty !== "RSA" || !this.privateJwk.d) {
      throw new Error("LTI private key must be an RSA private JWK");
    }
    this.keyId = this.privateJwk.kid || "canvas-seb-integration-key";
    this.privateJwk.kid = this.keyId;
    this.key = await importJWK(this.privateJwk, "RS256");
    this.publicJwk = publicPart(this.privateJwk);
  }
}

function publicPart(privateJwk: JWK): JWK {
  const publicJwk = { ...privateJwk };
  for (const privateField of ["d", "p", "q", "dp", "dq", "qi", "oth"]) {
    delete publicJwk[privateField as keyof JWK];
  }
  return publicJwk;
}
