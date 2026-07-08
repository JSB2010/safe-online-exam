import { readFileSync } from "node:fs";
import { constants, createHash, createPublicKey, publicEncrypt, type KeyObject, X509Certificate } from "node:crypto";
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
}

const OUTER_PREFIX = Buffer.from("pkhs", "utf8");
const INNER_PLAIN_PREFIX = Buffer.from("plnd", "utf8");
const PUBLIC_KEY_HASH_LENGTH = 20;
const Pkcs1PaddingOverhead = 11;

export function loadSebEncryptionKeyMaterial(settings: SebConfigEncryptionSettings): SebEncryptionKeyMaterial {
  const loaded =
    loadPem(settings.certificatePem, settings.certificatePath, "certificate") ||
    loadPem(settings.publicKeyPem, settings.publicKeyPath, "public key");

  if (!loaded) {
    throw new Error(
      "SEB config certificate encryption is enabled, but no public certificate or key is configured. Set SEB_CONFIG_ENCRYPTION_CERT_PEM or SEB_CONFIG_ENCRYPTION_CERT_PATH, or set SEB_CONFIG_ENCRYPTION_ENABLED=false."
    );
  }

  return keyMaterialFromPem(loaded.pem, loaded.source);
}

export function encryptSebConfigWithPublicKey(
  plainConfig: Buffer,
  keyMaterial: SebEncryptionKeyMaterial,
  options: SebConfigEncryptionOptions = {}
): Buffer {
  const innerPlainBlock = Buffer.concat([INNER_PLAIN_PREFIX, gzipSync(plainConfig)]);
  const encryptedSettings = rsaPkcs1EncryptChunks(innerPlainBlock, keyMaterial.publicKey, options.encryptBlock);

  return gzipSync(Buffer.concat([OUTER_PREFIX, keyMaterial.publicKeyHash, encryptedSettings]));
}

export function keyMaterialFromPem(pem: string, source = "configured PEM"): SebEncryptionKeyMaterial {
  const parsedCertificate = parseCertificate(pem);
  const publicKey = parsedCertificate?.publicKey || createPublicKey(pem);
  if (publicKey.asymmetricKeyType !== "rsa") {
    throw new Error("SEB config certificate encryption requires an RSA public key");
  }

  const publicKeyRaw = exportRsaPublicKeyDer(publicKey);
  const publicKeyHash = createHash("sha1").update(publicKeyRaw).digest();
  if (publicKeyHash.length !== PUBLIC_KEY_HASH_LENGTH) {
    throw new Error("SEB config certificate public-key hash has an invalid length");
  }

  return {
    publicKey,
    publicKeyHash,
    certificatePem: parsedCertificate ? pem : undefined,
    certificateDer: parsedCertificate?.raw,
    source
  };
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
