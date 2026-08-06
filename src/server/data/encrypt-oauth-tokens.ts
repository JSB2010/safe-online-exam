import { AppConfig, usesSourceKnownLocalOAuthTokenKey } from "../config/app-config.js";
import { oauthTokenEncryptionSettingsError } from "../security/oauth-token-encryption.js";
import { PostgresDatabase } from "./postgres-client.js";
import { PostgresOAuthTokenStore } from "./postgres-repositories.js";
import { assertSchemaReady } from "./schema.js";

function explicitEncryptionConfig(): AppConfig {
  const hasExplicitKeyring = Boolean(
    process.env.OAUTH_TOKEN_ENCRYPTION_KEYRING?.trim() || process.env.OAUTH_TOKEN_ENCRYPTION_KEYRING_FILE?.trim()
  );
  if (!hasExplicitKeyring || !process.env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID?.trim()) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEYRING or OAUTH_TOKEN_ENCRYPTION_KEYRING_FILE and OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID are required for token rewriting"
    );
  }

  const config = new AppConfig();
  const settings = config.value.security.oauthTokenEncryption;
  const validationError = oauthTokenEncryptionSettingsError(settings);
  if (validationError) throw new Error(validationError);
  if (usesSourceKnownLocalOAuthTokenKey(settings)) {
    throw new Error("The source-known local OAuth encryption key cannot be used for token rewriting");
  }
  return config;
}

async function main(): Promise<void> {
  const config = explicitEncryptionConfig();
  const database = new PostgresDatabase(config);
  try {
    await database.checkConnection();
    await assertSchemaReady(database);
    const store = new PostgresOAuthTokenStore(database, config.value.security.oauthTokenEncryption);
    const result = await store.rewriteLegacyAndRotatedTokens();
    process.stdout.write(
      `OAuth token encryption rewrite complete: ${result.rewritten}/${result.scanned} records updated\n`
    );
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`OAuth token encryption rewrite failed: ${message}\n`);
  process.exitCode = 1;
});
