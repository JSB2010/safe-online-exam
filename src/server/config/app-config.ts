import { Injectable } from "@nestjs/common";
import {
  oauthTokenEncryptionSettingsError,
  type OAuthTokenEncryptionMode,
  type OAuthTokenEncryptionSettings
} from "../security/oauth-token-encryption.js";
import { sebPasswordPolicyViolation } from "../services/seb-password-policy.js";
import { resolveSecretValue } from "./secret-value.js";

export type AppProfile = "dev" | "prod" | "test";
export type DatabaseSslMode = "disable" | "require" | "verify-ca" | "verify-full";

const LOCAL_CANVAS_DOMAIN = "https://canvas.example.test";
const DEFAULT_SEB_REQUIRED_DOMAINS = "";
const LOCAL_OAUTH_TOKEN_KEY_ID = "local-dev-v1";
const LOCAL_OAUTH_TOKEN_KEY = Buffer.from("seb-canvas-local-oauth-key-v1!!!", "utf8").toString("base64url");
const LOCAL_OAUTH_TOKEN_KEYRING = JSON.stringify({
  [LOCAL_OAUTH_TOKEN_KEY_ID]: LOCAL_OAUTH_TOKEN_KEY
});

export function usesSourceKnownLocalOAuthTokenKey(settings: OAuthTokenEncryptionSettings): boolean {
  try {
    const keyring = JSON.parse(settings.keyring) as Record<string, unknown>;
    return Object.values(keyring).includes(LOCAL_OAUTH_TOKEN_KEY);
  } catch {
    return false;
  }
}

export interface AppConfigSnapshot {
  profile: AppProfile;
  port: number;
  testbed: {
    enabled: boolean;
    sourceCommitSha?: string;
    sourceRef?: string;
    sourceWorktreeState: "clean" | "dirty" | "unknown";
    sourceDiffSha?: string;
    cloudBuildId?: string;
    imageDigest?: string;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password?: string;
    sslMode: DatabaseSslMode;
    poolMax: number;
    connectionTimeoutMs: number;
    statementTimeoutMs: number;
  };
  lti: {
    issuer: string;
    keySetUrl: string;
    authUrl: string;
    clientId?: string;
    deploymentId?: string;
    deploymentIdCheckingEnabled: boolean;
    courseNavigationVisibleToStudents: boolean;
    toolUrl?: string;
    privateKey?: string;
  };
  canvas: {
    apiBaseUrl: string;
    domain: string;
    oauthClientId?: string;
    oauthClientSecret?: string;
    redirectUri?: string;
  };
  security: {
    sessionSecret: string;
    stateEncryptionKey: string;
    debugEnabled: boolean;
    detectorDiagnosticsEnabled: boolean;
    oauthTokenEncryption: {
      mode: OAuthTokenEncryptionMode;
      activeKeyId: string;
      keyring: string;
    };
  };
  seb: {
    defaultQuitPassword?: string;
    requiredDomains: string[];
    configEncryption: {
      enabled: boolean;
      certificatePem?: string;
      certificatePath?: string;
      publicKeyPem?: string;
      publicKeyPath?: string;
    };
  };
}

@Injectable()
export class AppConfig {
  private readonly snapshot: AppConfigSnapshot;
  private readonly hardenedRuntime: boolean;

  constructor() {
    this.snapshot = loadConfigFromEnv(process.env);
    this.hardenedRuntime = requiresHardenedRuntimeValidation(this.snapshot, process.env);
    const errors = validateRuntimeConfig(this.snapshot, process.env);
    if (errors.length) {
      throw new Error(`Invalid application configuration:\n- ${errors.join("\n- ")}`);
    }
  }

  get value(): AppConfigSnapshot {
    return this.snapshot;
  }

  get profile(): AppProfile {
    return this.snapshot.profile;
  }

  get port(): number {
    return this.snapshot.port;
  }

  get toolUrl(): string | undefined {
    return sanitizeToolUrl(this.snapshot.lti.toolUrl);
  }

  getRequiredToolUrl(): string {
    const toolUrl = this.toolUrl;
    if (!toolUrl) {
      throw new Error("TOOL_URL is required for LTI routes");
    }
    return toolUrl;
  }

  getCanvasDomain(): string {
    return this.snapshot.canvas.domain.replace(/\/+$/u, "");
  }

  getCanvasApiBaseUrl(): string {
    return this.snapshot.canvas.apiBaseUrl.replace(/\/+$/u, "");
  }

  getApplicationBaseUrl(): string | undefined {
    if (this.isHardenedRuntime()) {
      return this.toolUrl;
    }
    const explicit = firstPresent(process.env.APP_BASE_URL, process.env.BASE_URL, this.toolUrl);
    return explicit ? explicit.replace(/\/+$/u, "") : undefined;
  }

  isHardenedRuntime(): boolean {
    return this.hardenedRuntime;
  }
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv): AppConfigSnapshot {
  const profile = resolveProfile(env);
  const canvasDomain = normalizeCanvasDomain(
    firstPresent(env.CANVAS_DOMAIN, env.CANVAS_BASE_URL, env.APP_CANVAS_BASE_URL, LOCAL_CANVAS_DOMAIN)!
  );
  const canvasApiBaseUrl = firstPresent(env.CANVAS_API_BASE_URL, `${canvasDomain}/api/v1`)!;
  const debugEnabled = parseBoolean(firstPresent(env.APP_DEBUG_ENABLED, env.DEBUG_ENABLED), false);
  const detectorDiagnosticsEnabled = parseBoolean(firstPresent(env.APP_DETECTOR_DIAGNOSTICS_ENABLED), false);

  return {
    profile,
    port: parseInteger(env.PORT, 8080),
    testbed: {
      enabled: parseBoolean(env.DEV_TESTBED_ENABLED, false),
      sourceCommitSha: firstPresent(env.SOURCE_COMMIT_SHA),
      sourceRef: firstPresent(env.SOURCE_REF),
      sourceWorktreeState: parseSourceWorktreeState(env.SOURCE_WORKTREE_STATE),
      sourceDiffSha: firstPresent(env.SOURCE_DIFF_SHA),
      cloudBuildId: firstPresent(env.CLOUD_BUILD_ID),
      imageDigest: firstPresent(env.APP_IMAGE_DIGEST)
    },
    database: {
      host: firstPresent(env.DATABASE_HOST, "127.0.0.1")!,
      port: parseInteger(env.DATABASE_PORT, 5432),
      name: firstPresent(env.DATABASE_NAME, "canvas_seb")!,
      user: firstPresent(env.DATABASE_USER, "canvas_seb")!,
      password: resolveSecretValue("DATABASE_PASSWORD", env),
      sslMode: parseDatabaseSslMode(env.DATABASE_SSL_MODE),
      poolMax: parseInteger(env.DATABASE_POOL_MAX, 5),
      connectionTimeoutMs: parseInteger(env.DATABASE_CONNECTION_TIMEOUT_MS, 10_000),
      statementTimeoutMs: parseInteger(env.DATABASE_STATEMENT_TIMEOUT_MS, 30_000)
    },
    lti: {
      issuer: firstPresent(env.LTI_ISSUER, "https://canvas.instructure.com")!,
      keySetUrl: firstPresent(env.LTI_KEY_SET_URL, "https://sso.canvaslms.com/api/lti/security/jwks")!,
      authUrl: firstPresent(env.LTI_AUTH_URL, "https://sso.canvaslms.com/api/lti/authorize_redirect")!,
      clientId: firstPresent(env.LTI_CLIENT_ID, env.DEV_LTI_CLIENT_ID, env.PROD_LTI_CLIENT_ID, env.lti_client_id),
      deploymentId: firstPresent(env.LTI_DEPLOYMENT_ID, env.DEPLOYMENT_ID),
      deploymentIdCheckingEnabled: parseBoolean(firstPresent(env.LTI_DEPLOYMENT_ID_CHECKING_ENABLED), true),
      courseNavigationVisibleToStudents: !isExplicitlyFalse(env.LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS),
      toolUrl: sanitizeToolUrl(
        firstPresent(env.TOOL_URL, env.DEV_TOOL_URL, env.PROD_TOOL_URL, env.SERVICE_URL, env.APP_BASE_URL)
      ),
      privateKey: firstPresent(
        resolveSecretValue("LTI_PRIVATE_KEY", env),
        env.DEV_LTI_PRIVATE_KEY,
        env.PROD_LTI_PRIVATE_KEY
      )
    },
    canvas: {
      apiBaseUrl: canvasApiBaseUrl,
      domain: canvasDomain,
      oauthClientId: firstPresent(env.CANVAS_API_CLIENT_ID, env.DEV_API_CLIENT_ID, env.PROD_API_CLIENT_ID),
      oauthClientSecret: firstPresent(
        resolveSecretValue("CANVAS_API_CLIENT_SECRET", env),
        env.DEV_API_CLIENT_SECRET,
        env.PROD_API_CLIENT_SECRET
      ),
      redirectUri: firstPresent(env.CANVAS_REDIRECT_URI, env.OAUTH_REDIRECT_URI)
    },
    security: {
      sessionSecret:
        firstPresent(
          resolveSecretValue("SESSION_SECRET", env),
          env.ADMIN_PASSWORD,
          profile === "prod" ? undefined : "seb-canvas-session-dev-secret"
        ) || "",
      stateEncryptionKey:
        firstPresent(
          resolveSecretValue("STATE_ENCRYPTION_KEY", env),
          profile === "prod" ? undefined : "seb-canvas-dev-state-key"
        ) || "",
      debugEnabled,
      detectorDiagnosticsEnabled,
      oauthTokenEncryption: {
        mode: (firstPresent(env.OAUTH_TOKEN_ENCRYPTION_MODE, "enforce") || "enforce") as OAuthTokenEncryptionMode,
        activeKeyId:
          firstPresent(
            env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
            profile === "prod" ? "primary" : LOCAL_OAUTH_TOKEN_KEY_ID
          ) || "",
        keyring:
          firstPresent(
            resolveSecretValue("OAUTH_TOKEN_ENCRYPTION_KEYRING", env),
            profile === "prod" ? undefined : LOCAL_OAUTH_TOKEN_KEYRING
          ) || ""
      }
    },
    seb: {
      defaultQuitPassword: firstPresent(resolveSecretValue("SEB_QUIT_PASSWORD", env), env.DEFAULT_SEB_QUIT_PASSWORD),
      requiredDomains: splitList(firstPresent(env.SEB_REQUIRED_DOMAINS, DEFAULT_SEB_REQUIRED_DOMAINS)),
      configEncryption: {
        enabled: parseBoolean(firstPresent(env.SEB_CONFIG_ENCRYPTION_ENABLED), true),
        certificatePem: normalizeMultilineSecret(firstPresent(env.SEB_CONFIG_ENCRYPTION_CERT_PEM)),
        certificatePath: firstPresent(env.SEB_CONFIG_ENCRYPTION_CERT_PATH),
        publicKeyPem: normalizeMultilineSecret(firstPresent(env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM)),
        publicKeyPath: firstPresent(env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PATH)
      }
    }
  };
}

export function validateRuntimeConfig(snapshot: AppConfigSnapshot, env: NodeJS.ProcessEnv): string[] {
  const cloudRunRuntime = isCloudRunRuntime(env);
  const errors: string[] = [];
  if (!requiresHardenedRuntimeValidation(snapshot, env)) {
    return errors;
  }
  const runtimeLabel = cloudRunRuntime ? "Cloud Run" : "production";

  requirePresent(
    errors,
    env,
    ["TOOL_URL", "DEV_TOOL_URL", "PROD_TOOL_URL", "SERVICE_URL", "APP_BASE_URL"],
    "TOOL_URL",
    runtimeLabel
  );
  requirePresent(
    errors,
    env,
    ["OAUTH_TOKEN_ENCRYPTION_KEYRING", "OAUTH_TOKEN_ENCRYPTION_KEYRING_FILE"],
    "OAUTH_TOKEN_ENCRYPTION_KEYRING",
    runtimeLabel
  );
  requirePresent(
    errors,
    env,
    ["OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID"],
    "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID",
    runtimeLabel
  );
  requirePresent(
    errors,
    env,
    ["CANVAS_DOMAIN", "CANVAS_BASE_URL", "APP_CANVAS_BASE_URL"],
    "CANVAS_DOMAIN",
    runtimeLabel
  );
  requirePresent(
    errors,
    env,
    ["LTI_CLIENT_ID", "DEV_LTI_CLIENT_ID", "PROD_LTI_CLIENT_ID", "lti_client_id"],
    "LTI_CLIENT_ID",
    runtimeLabel
  );
  requirePresent(
    errors,
    env,
    ["LTI_PRIVATE_KEY", "LTI_PRIVATE_KEY_FILE", "DEV_LTI_PRIVATE_KEY", "PROD_LTI_PRIVATE_KEY"],
    "LTI_PRIVATE_KEY",
    runtimeLabel
  );
  if (snapshot.lti.deploymentIdCheckingEnabled) {
    requirePresent(errors, env, ["LTI_DEPLOYMENT_ID", "DEPLOYMENT_ID"], "LTI_DEPLOYMENT_ID", runtimeLabel);
  }
  requirePresent(errors, env, ["SESSION_SECRET", "SESSION_SECRET_FILE"], "SESSION_SECRET", runtimeLabel);
  requirePresent(
    errors,
    env,
    ["STATE_ENCRYPTION_KEY", "STATE_ENCRYPTION_KEY_FILE"],
    "STATE_ENCRYPTION_KEY",
    runtimeLabel
  );
  requirePresent(
    errors,
    env,
    ["CANVAS_API_CLIENT_ID", "DEV_API_CLIENT_ID", "PROD_API_CLIENT_ID"],
    "CANVAS_API_CLIENT_ID",
    runtimeLabel
  );
  requirePresent(
    errors,
    env,
    ["CANVAS_API_CLIENT_SECRET", "CANVAS_API_CLIENT_SECRET_FILE", "DEV_API_CLIENT_SECRET", "PROD_API_CLIENT_SECRET"],
    "CANVAS_API_CLIENT_SECRET",
    runtimeLabel
  );
  requirePresent(errors, env, ["DATABASE_HOST"], "DATABASE_HOST", runtimeLabel);
  requirePresent(errors, env, ["DATABASE_NAME"], "DATABASE_NAME", runtimeLabel);
  requirePresent(errors, env, ["DATABASE_USER"], "DATABASE_USER", runtimeLabel);
  requirePresent(errors, env, ["DATABASE_PASSWORD", "DATABASE_PASSWORD_FILE"], "DATABASE_PASSWORD", runtimeLabel);

  if (!isIntegerSettingInRange(env.DATABASE_PORT, snapshot.database.port, 1, 65_535)) {
    errors.push(`DATABASE_PORT must be an integer between 1 and 65535 in ${runtimeLabel}`);
  }
  if (!isIntegerSettingInRange(env.DATABASE_POOL_MAX, snapshot.database.poolMax, 1, 100)) {
    errors.push(`DATABASE_POOL_MAX must be an integer between 1 and 100 in ${runtimeLabel}`);
  }
  if (
    !isIntegerSettingInRange(env.DATABASE_CONNECTION_TIMEOUT_MS, snapshot.database.connectionTimeoutMs, 100, 120_000)
  ) {
    errors.push(`DATABASE_CONNECTION_TIMEOUT_MS must be an integer between 100 and 120000 in ${runtimeLabel}`);
  }
  if (!isIntegerSettingInRange(env.DATABASE_STATEMENT_TIMEOUT_MS, snapshot.database.statementTimeoutMs, 100, 600_000)) {
    errors.push(`DATABASE_STATEMENT_TIMEOUT_MS must be an integer between 100 and 600000 in ${runtimeLabel}`);
  }
  if (env.DATABASE_SSL_MODE !== undefined && !isDatabaseSslMode(env.DATABASE_SSL_MODE)) {
    errors.push(`DATABASE_SSL_MODE must be disable, require, verify-ca, or verify-full in ${runtimeLabel}`);
  }

  if (!isHttpsOrigin(snapshot.lti.toolUrl)) {
    errors.push(`TOOL_URL must be an HTTPS origin without credentials, path, query, or fragment in ${runtimeLabel}`);
  }
  if (!isSecureLtiIssuer(snapshot.lti.issuer)) {
    errors.push(`LTI_ISSUER must be an HTTPS issuer URL without credentials, query, or fragment in ${runtimeLabel}`);
  }
  if (!isSecureLtiEndpoint(snapshot.lti.keySetUrl)) {
    errors.push(`LTI_KEY_SET_URL must be an HTTPS endpoint without credentials or fragment in ${runtimeLabel}`);
  }
  if (!isSecureLtiEndpoint(snapshot.lti.authUrl)) {
    errors.push(`LTI_AUTH_URL must be an HTTPS endpoint without credentials or fragment in ${runtimeLabel}`);
  }
  if (!applicationBaseAliasesMatchToolUrl(env, snapshot.lti.toolUrl)) {
    errors.push(`APP_BASE_URL and BASE_URL must match TOOL_URL when set in ${runtimeLabel}`);
  }
  if (!isHttpsOrigin(snapshot.canvas.domain)) {
    errors.push(
      `CANVAS_DOMAIN must be an HTTPS origin without credentials, path, query, or fragment in ${runtimeLabel}`
    );
  }
  if (!isAllowedCanvasApiBaseUrl(snapshot.canvas.apiBaseUrl, snapshot.canvas.domain)) {
    errors.push(
      `CANVAS_API_BASE_URL must be the configured Canvas HTTPS origin followed by /api/v1 in ${runtimeLabel}`
    );
  }
  if (!isAllowedCanvasOauthRedirect(snapshot.canvas.redirectUri, snapshot.lti.toolUrl)) {
    errors.push(`CANVAS_REDIRECT_URI must equal TOOL_URL followed by /api/oauth2callback in ${runtimeLabel}`);
  }

  if (snapshot.security.sessionSecret.length < 32) {
    errors.push(`SESSION_SECRET must contain at least 32 characters in ${runtimeLabel}`);
  }
  if (snapshot.security.stateEncryptionKey.length < 32) {
    errors.push(`STATE_ENCRYPTION_KEY must contain at least 32 characters in ${runtimeLabel}`);
  }
  const oauthTokenEncryptionError = oauthTokenEncryptionSettingsError(snapshot.security.oauthTokenEncryption);
  if (oauthTokenEncryptionError) {
    errors.push(`${oauthTokenEncryptionError} in ${runtimeLabel}`);
  }
  if (
    snapshot.security.sessionSecret.length >= 32 &&
    snapshot.security.sessionSecret === snapshot.security.stateEncryptionKey
  ) {
    errors.push(`SESSION_SECRET and STATE_ENCRYPTION_KEY must be independent values in ${runtimeLabel}`);
  }

  if (snapshot.canvas.domain === LOCAL_CANVAS_DOMAIN) {
    errors.push(`CANVAS_DOMAIN must be set to the school's Canvas base URL in ${runtimeLabel}`);
  }

  const cloudTestbedDiagnosticsAllowed = cloudRunRuntime && snapshot.profile === "dev" && snapshot.testbed.enabled;
  if (snapshot.security.debugEnabled && !cloudTestbedDiagnosticsAllowed) {
    errors.push(`APP_DEBUG_ENABLED must be false in ${runtimeLabel}`);
  }

  if (snapshot.security.detectorDiagnosticsEnabled && !cloudTestbedDiagnosticsAllowed) {
    errors.push(`APP_DETECTOR_DIAGNOSTICS_ENABLED must be false in ${runtimeLabel}`);
  }

  if (snapshot.testbed.enabled && snapshot.profile !== "dev") {
    errors.push(`DEV_TESTBED_ENABLED may only be true when APP_ENV is dev in ${runtimeLabel}`);
  }

  if (snapshot.testbed.enabled && cloudRunRuntime && snapshot.profile === "dev") {
    validateCloudTestbedProvenance(errors, snapshot, runtimeLabel);
  }

  if (parseBoolean(env.USE_IN_MEMORY_STORE, false)) {
    errors.push(`USE_IN_MEMORY_STORE must be false in ${runtimeLabel}`);
  }

  if (snapshot.seb.defaultQuitPassword && sebPasswordPolicyViolation(snapshot.seb.defaultQuitPassword)) {
    errors.push(
      `SEB_QUIT_PASSWORD must be 8-128 characters, use at least 5 different letters or numbers, and avoid common, sequential, or repetitive values in ${runtimeLabel}`
    );
  }

  if (
    snapshot.seb.configEncryption.enabled &&
    !snapshot.seb.configEncryption.certificatePem &&
    !snapshot.seb.configEncryption.certificatePath
  ) {
    errors.push(
      "SEB config encryption requires a validity-checked X.509 certificate through SEB_CONFIG_ENCRYPTION_CERT_PEM or SEB_CONFIG_ENCRYPTION_CERT_PATH"
    );
  }

  for (const domain of snapshot.seb.requiredDomains) {
    if (!isConcreteHostname(domain)) {
      errors.push(`SEB_REQUIRED_DOMAINS contains an unsafe hostname: ${domain}`);
    } else if (isBlockedIdentityProviderHostname(domain)) {
      errors.push(`SEB_REQUIRED_DOMAINS must not include an identity-provider hostname: ${domain}`);
    }
  }

  return errors;
}

export function requiresHardenedRuntimeValidation(
  snapshot: Pick<AppConfigSnapshot, "profile">,
  env: NodeJS.ProcessEnv
): boolean {
  return snapshot.profile === "prod" || isCloudRunRuntime(env);
}

function validateCloudTestbedProvenance(errors: string[], snapshot: AppConfigSnapshot, runtimeLabel: string): void {
  if (!snapshot.testbed.sourceCommitSha || !/^[0-9a-f]{40}$/u.test(snapshot.testbed.sourceCommitSha)) {
    errors.push(`SOURCE_COMMIT_SHA must be a full lowercase Git commit SHA in ${runtimeLabel} testbeds`);
  }
  if (!snapshot.testbed.sourceRef || !/^[A-Za-z0-9._/-]{1,200}$/u.test(snapshot.testbed.sourceRef)) {
    errors.push(`SOURCE_REF must be a safe Git ref label in ${runtimeLabel} testbeds`);
  }
  if (snapshot.testbed.sourceWorktreeState === "unknown") {
    errors.push(`SOURCE_WORKTREE_STATE must be clean or dirty in ${runtimeLabel} testbeds`);
  }
  if (
    snapshot.testbed.sourceWorktreeState === "dirty" &&
    (!snapshot.testbed.sourceDiffSha || !/^[0-9a-f]{64}$/u.test(snapshot.testbed.sourceDiffSha))
  ) {
    errors.push(`SOURCE_DIFF_SHA must be a lowercase SHA-256 digest for dirty ${runtimeLabel} testbeds`);
  }
  if (!snapshot.testbed.cloudBuildId || !/^[A-Za-z0-9-]{8,64}$/u.test(snapshot.testbed.cloudBuildId)) {
    errors.push(`CLOUD_BUILD_ID must identify the build in ${runtimeLabel} testbeds`);
  }
  if (!snapshot.testbed.imageDigest || !/^sha256:[0-9a-f]{64}$/u.test(snapshot.testbed.imageDigest)) {
    errors.push(`APP_IMAGE_DIGEST must be an immutable sha256 digest in ${runtimeLabel} testbeds`);
  }
}

function parseSourceWorktreeState(value?: string): "clean" | "dirty" | "unknown" {
  return value === "clean" || value === "dirty" ? value : "unknown";
}

function isHttpsOrigin(value?: string): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      url.origin === value.replace(/\/+$/u, "")
    );
  } catch {
    return false;
  }
}

function isSecureLtiIssuer(value: string): boolean {
  return isSecureLtiUrl(value, false);
}

function isSecureLtiEndpoint(value: string): boolean {
  return isSecureLtiUrl(value, true);
}

function isSecureLtiUrl(value: string, allowQuery: boolean): boolean {
  if (!/^https:\/\//iu.test(value) || value.includes("#") || (!allowQuery && value.includes("?"))) {
    return false;
  }
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf("//") + 2).split(/[/?#]/u, 1)[0] || "";
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !authority.includes("@");
  } catch {
    return false;
  }
}

function applicationBaseAliasesMatchToolUrl(env: NodeJS.ProcessEnv, toolUrl: string | undefined): boolean {
  return [env.APP_BASE_URL, env.BASE_URL]
    .filter((value): value is string => !!value?.trim())
    .every((value) => sanitizeToolUrl(value) === toolUrl);
}

function isAllowedCanvasApiBaseUrl(value: string, canvasDomain: string): boolean {
  try {
    const api = new URL(value);
    const canvas = new URL(canvasDomain);
    return (
      api.protocol === "https:" &&
      api.origin === canvas.origin &&
      !api.username &&
      !api.password &&
      !api.search &&
      !api.hash &&
      api.pathname.replace(/\/+$/u, "") === "/api/v1"
    );
  } catch {
    return false;
  }
}

function isAllowedCanvasOauthRedirect(value: string | undefined, toolUrl: string | undefined): boolean {
  if (!toolUrl) {
    return false;
  }
  const expected = `${toolUrl.replace(/\/+$/u, "")}/api/oauth2callback`;
  return !value || value === expected;
}

function isConcreteHostname(value: string): boolean {
  if (!value || value.length > 253 || value.includes("*") || /[\s/@?#:]/u.test(value)) {
    return false;
  }
  try {
    const hostname = new URL(`https://${value}`).hostname;
    return (
      hostname === value.toLowerCase() &&
      hostname.includes(".") &&
      hostname
        .split(".")
        .every((label) => !!label && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))
    );
  } catch {
    return false;
  }
}

function isBlockedIdentityProviderHostname(value: string): boolean {
  const hostname = value.toLowerCase();
  return (
    hostname === "accounts.google.com" ||
    hostname === "accounts.youtube.com" ||
    hostname === "sso.canvaslms.com" ||
    hostname === "www.google.com" ||
    hostname === "www.youtube.com" ||
    hostname === "www.googleapis.com"
  );
}

export function resolveProfile(env: NodeJS.ProcessEnv): AppProfile {
  const raw = firstPresent(env.APP_ENV, env.NODE_ENV, env.SPRING_PROFILES_ACTIVE, "dev") || "dev";
  const profiles = raw.split(",").map((profile) => profile.trim().toLowerCase());
  if (profiles.includes("test")) {
    return "test";
  }
  if (profiles.includes("prod") || profiles.includes("production")) {
    return "prod";
  }
  return "dev";
}

export function sanitizeToolUrl(value?: string): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  let url = value.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//iu.test(url)) {
    url = `https://${url}`;
  }
  if (!url.startsWith("https://") && !url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
    url = url.replace(/^http:\/\//iu, "https://");
  }
  return url;
}

export function normalizeCanvasDomain(value: string): string {
  const trimmed = value
    .trim()
    .replace(/\/api\/v1\/?$/u, "")
    .replace(/\/+$/u, "");
  if (/^https?:\/\//iu.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function firstPresent(...values: Array<string | undefined | null>): string | undefined {
  return values.find((value) => value !== undefined && value !== null && value.trim() !== "")?.trim();
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isIntegerSettingInRange(raw: string | undefined, parsed: number, minimum: number, maximum: number): boolean {
  if (raw !== undefined && !/^[+-]?\d+$/u.test(raw.trim())) {
    return false;
  }
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function isExplicitlyFalse(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "false";
}

function parseDatabaseSslMode(value: string | undefined): DatabaseSslMode {
  return value !== undefined && isDatabaseSslMode(value) ? value : "disable";
}

function isDatabaseSslMode(value: string | undefined): value is DatabaseSslMode {
  return value !== undefined && ["disable", "require", "verify-ca", "verify-full"].includes(value);
}

function splitList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\n]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeMultilineSecret(value?: string): string | undefined {
  return value?.replace(/\\n/gu, "\n");
}

function isCloudRunRuntime(env: NodeJS.ProcessEnv): boolean {
  return !!firstPresent(env.K_SERVICE);
}

function requirePresent(
  errors: string[],
  env: NodeJS.ProcessEnv,
  acceptedNames: string[],
  canonicalName: string,
  runtimeLabel: string
): void {
  if (firstPresent(...acceptedNames.map((name) => env[name]))) {
    return;
  }
  errors.push(`${canonicalName} is required in ${runtimeLabel}`);
}
