import { readFileSync } from "node:fs";
import {
  constants,
  createCipheriv,
  createHash,
  createHmac,
  createPublicKey,
  pbkdf2Sync,
  publicEncrypt,
  randomBytes,
  type KeyObject,
  X509Certificate
} from "node:crypto";
import { gzipSync } from "node:zlib";

export interface SebConfigEncryptionSettings {
  certificatePem?: string;
  certificatePath?: string;
  publicKeyPem?: string;
  publicKeyPath?: string;
}

export interface SebEncryptionKeyMaterial {
  publicKey: KeyObject;
  publicKeyHash: Buffer;
  certificatePem?: string;
  certificateDer?: Buffer;
  source: string;
}

export interface SebConfigEncryptionOptions {
  encryptBlock?: (block: Buffer, publicKey: KeyObject) => Buffer;
  startPassword?: string | null;
}

const OUTER_PREFIX = Buffer.from("pkhs", "utf8");
const INNER_PLAIN_PREFIX = Buffer.from("plnd", "utf8");
const INNER_PASSWORD_PREFIX = Buffer.from("pswd", "utf8");
const PUBLIC_KEY_HASH_LENGTH = 20;
const Pkcs1PaddingOverhead = 11;
const RNCryptorVersion = 3;
const RNCryptorHasPasswordOption = 1;
const RNCryptorSaltBytes = 8;
const RNCryptorIvBytes = 16;
const RNCryptorKeyBytes = 32;
const RNCryptorRounds = 10000;
const MIN_RSA_MODULUS_BITS = 2048;
const CERTIFICATE_RENEWAL_WARNING_MS = 30 * 24 * 60 * 60 * 1000;
const KEY_USAGE_OID = Buffer.from([0x55, 0x1d, 0x0f]);

export function loadSebEncryptionKeyMaterial(settings: SebConfigEncryptionSettings): SebEncryptionKeyMaterial {
  const loaded =
    loadPem(settings.certificatePem, settings.certificatePath, "certificate") ||
    loadPem(settings.publicKeyPem, settings.publicKeyPath, "public key");

  if (!loaded) {
    throw new Error(
      "SEB config certificate encryption is enabled, but no public certificate or key is configured. Set SEB_CONFIG_ENCRYPTION_CERT_PEM or SEB_CONFIG_ENCRYPTION_CERT_PATH. Assessment downloads cannot proceed without certificate encryption."
    );
  }

  return keyMaterialFromPem(loaded.pem, loaded.source);
}

export function encryptSebConfigWithPublicKey(
  plainConfig: Buffer,
  keyMaterial: SebEncryptionKeyMaterial,
  options: SebConfigEncryptionOptions = {}
): Buffer {
  const innerBlock = wrapSebConfigPayload(plainConfig, options.startPassword);
  const encryptedSettings = rsaPkcs1EncryptChunks(innerBlock, keyMaterial.publicKey, options.encryptBlock);

  return gzipSync(Buffer.concat([OUTER_PREFIX, keyMaterial.publicKeyHash, encryptedSettings]));
}

export function wrapSebConfigPayload(plainConfig: Buffer, startPassword?: string | null): Buffer {
  const compressedPlainConfig = gzipSync(plainConfig);
  const normalizedPassword = startPassword?.trim();
  if (!normalizedPassword) {
    return Buffer.concat([INNER_PLAIN_PREFIX, compressedPlainConfig]);
  }
  return Buffer.concat([
    INNER_PASSWORD_PREFIX,
    rncryptorEncryptWithPassword(compressedPlainConfig, normalizedPassword)
  ]);
}

export function preparePasswordProtectedSebConfig(plainConfig: Buffer, startPassword: string): Buffer {
  return gzipSync(wrapSebConfigPayload(plainConfig, startPassword));
}

export function keyMaterialFromPem(pem: string, source = "configured PEM", now = Date.now()): SebEncryptionKeyMaterial {
  const parsedCertificate = parseCertificate(pem);
  const publicKey = parsedCertificate?.publicKey || createPublicKey(pem);
  if (publicKey.asymmetricKeyType !== "rsa") {
    throw new Error("SEB config certificate encryption requires an RSA public key");
  }
  assertStrongRsaKey(publicKey);
  if (parsedCertificate) {
    assertUsableCertificate(parsedCertificate, now, source);
  }

  const publicKeyRaw = exportRsaPublicKeyDer(publicKey);
  const publicKeyHash = createHash("sha1").update(publicKeyRaw).digest();
  if (publicKeyHash.length !== PUBLIC_KEY_HASH_LENGTH) {
    throw new Error("SEB config certificate public-key hash has an invalid length");
  }

  return {
    publicKey,
    publicKeyHash,
    certificatePem: parsedCertificate ? certificatePemFromDer(parsedCertificate.raw) : undefined,
    certificateDer: parsedCertificate?.raw,
    source
  };
}

/**
 * Revalidates the lifetime and certificate constraints on already-loaded key
 * material. Long-lived processes must not rely only on the startup-time check:
 * an otherwise valid certificate can expire while the service is still
 * running.
 *
 * Public-key-only material has no X.509 validity window, so there is nothing
 * to revalidate here. Hardened runtimes separately require an X.509
 * certificate during startup.
 */
export function assertSebEncryptionCertificateCurrent(keyMaterial: SebEncryptionKeyMaterial, now = Date.now()): void {
  if (!keyMaterial.certificateDer) {
    return;
  }
  assertUsableCertificate(new X509Certificate(keyMaterial.certificateDer), now, keyMaterial.source, false);
}

function assertStrongRsaKey(publicKey: KeyObject): void {
  const details = publicKey.asymmetricKeyDetails;
  if (!details?.modulusLength || details.modulusLength < MIN_RSA_MODULUS_BITS) {
    throw new Error(`SEB config certificate encryption requires an RSA key of at least ${MIN_RSA_MODULUS_BITS} bits`);
  }
  if (details.publicExponent !== 65537n) {
    throw new Error("SEB config certificate encryption requires RSA public exponent 65537");
  }
}

function assertUsableCertificate(
  certificate: X509Certificate,
  now: number,
  source: string,
  warnBeforeExpiry = true
): void {
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom) {
    throw new Error("SEB config encryption certificate is not yet valid");
  }
  if (now >= validTo) {
    throw new Error("SEB config encryption certificate has expired");
  }
  if (certificate.ca) {
    throw new Error("SEB config encryption certificate must be an end-entity certificate, not a CA certificate");
  }
  const usage = rsaEncryptionKeyUsage(certificate.raw);
  if (!usage || (!usage.keyEncipherment && !usage.dataEncipherment)) {
    throw new Error("SEB config encryption certificate Key Usage must allow keyEncipherment or dataEncipherment");
  }
  if (warnBeforeExpiry && validTo - now <= CERTIFICATE_RENEWAL_WARNING_MS) {
    console.warn("SEB config encryption certificate expires within 30 days", JSON.stringify({ source, validTo }));
  }
}

function rsaEncryptionKeyUsage(rawCertificate: Buffer): {
  keyEncipherment: boolean;
  dataEncipherment: boolean;
} | null {
  const root = readDerNode(rawCertificate, 0, rawCertificate.length);
  if (!root || root.end !== rawCertificate.length) {
    return null;
  }
  const extension = findExtension(root, KEY_USAGE_OID);
  if (!extension) {
    return null;
  }
  const bitString = readDerNode(extension, 0, extension.length);
  if (!bitString || bitString.tag !== 0x03 || bitString.valueStart >= bitString.end) {
    return null;
  }
  const bits = extension.subarray(bitString.valueStart + 1, bitString.end);
  const first = bits[0] || 0;
  return {
    keyEncipherment: (first & 0x20) !== 0,
    dataEncipherment: (first & 0x10) !== 0
  };
}

interface DerNode {
  tag: number;
  valueStart: number;
  end: number;
  children: DerNode[];
  source: Buffer;
}

function readDerNode(source: Buffer, offset: number, limit: number): DerNode | null {
  if (offset < 0 || offset + 2 > limit) {
    return null;
  }
  const tag = source[offset];
  let cursor = offset + 1;
  const initialLength = source[cursor++];
  let length = initialLength;
  if ((initialLength & 0x80) !== 0) {
    const lengthBytes = initialLength & 0x7f;
    if (!lengthBytes || lengthBytes > 4 || cursor + lengthBytes > limit) {
      return null;
    }
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      length = length * 256 + source[cursor++];
    }
  }
  const valueStart = cursor;
  const end = valueStart + length;
  if (end > limit || end < valueStart) {
    return null;
  }
  const children: DerNode[] = [];
  if ((tag & 0x20) !== 0) {
    while (cursor < end) {
      const child = readDerNode(source, cursor, end);
      if (!child || child.end <= cursor) {
        return null;
      }
      children.push(child);
      cursor = child.end;
    }
  }
  return { tag, valueStart, end, children, source };
}

function findExtension(node: DerNode, oid: Buffer): Buffer | null {
  if (node.tag === 0x30 && node.children.length >= 2) {
    const [identifier] = node.children;
    if (identifier.tag === 0x06 && identifier.source.subarray(identifier.valueStart, identifier.end).equals(oid)) {
      const value = [...node.children].reverse().find((child) => child.tag === 0x04);
      if (value) {
        return value.source.subarray(value.valueStart, value.end);
      }
    }
  }
  for (const child of node.children) {
    const found = findExtension(child, oid);
    if (found) {
      return found;
    }
  }
  return null;
}

function rsaPkcs1EncryptChunks(plainData: Buffer, publicKey: KeyObject, encryptBlock = rsaPkcs1EncryptBlock): Buffer {
  const modulusBytes = rsaModulusLengthBytes(publicKey);
  const maxPlainBlockBytes = modulusBytes - Pkcs1PaddingOverhead;
  if (maxPlainBlockBytes <= 0) {
    throw new Error("SEB config encryption RSA key is too small");
  }

  const encryptedBlocks: Buffer[] = [];
  for (let offset = 0; offset < plainData.length; offset += maxPlainBlockBytes) {
    const plainBlock = plainData.subarray(offset, offset + maxPlainBlockBytes);
    const encryptedBlock = encryptBlock(plainBlock, publicKey);
    if (encryptedBlock.length !== modulusBytes) {
      throw new Error("SEB config encryption produced an invalid RSA block length");
    }
    encryptedBlocks.push(encryptedBlock);
  }
  return Buffer.concat(encryptedBlocks);
}

function rsaPkcs1EncryptBlock(block: Buffer, publicKey: KeyObject): Buffer {
  return publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_PADDING
    },
    block
  );
}

function rsaModulusLengthBytes(publicKey: KeyObject): number {
  const modulusLength = publicKey.asymmetricKeyDetails?.modulusLength;
  if (!modulusLength) {
    throw new Error("SEB config encryption could not determine RSA modulus length");
  }
  return Math.ceil(modulusLength / 8);
}

function loadPem(
  inlinePem: string | undefined,
  pemPath: string | undefined,
  label: "certificate" | "public key"
): { pem: string; source: string } | null {
  if (inlinePem) {
    return { pem: inlinePem, source: `${label} PEM env` };
  }
  if (pemPath) {
    return { pem: readFileSync(pemPath, "utf8"), source: pemPath };
  }
  return null;
}

function parseCertificate(pem: string): X509Certificate | null {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
}

function exportRsaPublicKeyDer(publicKey: KeyObject): Buffer {
  const exported = publicKey.export({ format: "der", type: "pkcs1" });
  return Buffer.isBuffer(exported) ? exported : Buffer.from(exported);
}

function certificatePemFromDer(certificateDer: Buffer): string {
  const base64Lines = certificateDer.toString("base64").match(/.{1,64}/gu) || [];
  return `-----BEGIN CERTIFICATE-----\n${base64Lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function rncryptorEncryptWithPassword(data: Buffer, password: string): Buffer {
  const encryptionSalt = randomBytes(RNCryptorSaltBytes);
  const hmacSalt = randomBytes(RNCryptorSaltBytes);
  const iv = randomBytes(RNCryptorIvBytes);
  const encryptionKey = pbkdf2Sync(password, encryptionSalt, RNCryptorRounds, RNCryptorKeyBytes, "sha1");
  const hmacKey = pbkdf2Sync(password, hmacSalt, RNCryptorRounds, RNCryptorKeyBytes, "sha1");
  const cipher = createCipheriv("aes-256-cbc", encryptionKey, iv);
  const encryptedData = Buffer.concat([cipher.update(data), cipher.final()]);
  const header = Buffer.concat([
    Buffer.from([RNCryptorVersion, RNCryptorHasPasswordOption]),
    encryptionSalt,
    hmacSalt,
    iv
  ]);
  const hmac = createHmac("sha256", hmacKey).update(header).update(encryptedData).digest();
  return Buffer.concat([header, encryptedData, hmac]);
}
