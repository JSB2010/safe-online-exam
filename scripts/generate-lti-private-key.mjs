#!/usr/bin/env node

import { generateKeyPair, exportJWK } from "jose";

const kid = process.argv[2] || `canvas-seb-${new Date().toISOString().slice(0, 10)}`;
const { privateKey } = await generateKeyPair("RS256", { extractable: true });
const privateJwk = {
  ...(await exportJWK(privateKey)),
  kid,
  alg: "RS256",
  use: "sig"
};

process.stdout.write(`${JSON.stringify(privateJwk)}\n`);
