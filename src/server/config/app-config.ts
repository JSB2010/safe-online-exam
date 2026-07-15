import { Injectable } from "@nestjs/common";
import { sebPasswordPolicyViolation } from "../services/seb-password-policy.js";

export type AppProfile = "dev" | "prod" | "test";

const LOCAL_CANVAS_DOMAIN = "https://canvas.example.test";
const DEFAULT_SEB_REQUIRED_DOMAINS = "";

export interface AppConfigSnapshot {
  profile: AppProfile;
  port: number;
  projectId?: string;
  firestoreDatabaseId: string;
  firestoreCollections: {
    assessments: string;
    courses: string;
    oauthTokens: string;
    sessions: string;
    transientStates: string;
    operationLocks: string;
  };
  lti: {
    issuer: string;
    keySetUrl: string;
    authUrl: string;
    clientId?: string;
    deploymentId?: string;
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
  const projectId = firstPresent(env.GCP_PROJECT_ID, env.GOOGLE_CLOUD_PROJECT);
  const firestoreDatabaseId = firstPresent(
    env.FIRESTORE_DATABASE_ID,
    profile === "prod" ? "seb-canvaslti-prod" : "seb-canvaslti-dev"
  )!;
  const debugEnabled = parseBoolean(firstPresent(env.APP_DEBUG_ENABLED, env.DEBUG_ENABLED), false);
  const detectorDiagnosticsEnabled = parseBoolean(firstPresent(env.APP_DETECTOR_DIAGNOSTICS_ENABLED), false);

  return {
    profile,
    port: parseInteger(env.PORT, 8080),
    projectId,
    firestoreDatabaseId,
    firestoreCollections: {
      assessments: firstPresent(env.FIRESTORE_ASSESSMENTS_COLLECTION, "assessments")!,
      courses: firstPresent(env.FIRESTORE_COURSES_COLLECTION, "courses")!,
      oauthTokens: firstPresent(env.FIRESTORE_OAUTH_TOKENS_COLLECTION, "canvasOAuthTokens")!,
      sessions: firstPresent(env.FIRESTORE_SESSIONS_COLLECTION, "sessions")!,
      transientStates: firstPresent(env.FIRESTORE_TRANSIENT_STATES_COLLECTION, "transientStates")!,
      operationLocks: firstPresent(env.FIRESTORE_OPERATION_LOCKS_COLLECTION, "operationLocks")!
    },
    lti: {
      issuer: firstPresent(env.LTI_ISSUER, "https://canvas.instructure.com")!,
      keySetUrl: firstPresent(env.LTI_KEY_SET_URL, "https://sso.canvaslms.com/api/lti/security/jwks")!,
      authUrl: firstPresent(env.LTI_AUTH_URL, "https://sso.canvaslms.com/api/lti/authorize_redirect")!,
      clientId: firstPresent(env.LTI_CLIENT_ID, env.DEV_LTI_CLIENT_ID, env.PROD_LTI_CLIENT_ID, env.lti_client_id),
      deploymentId: firstPresent(env.LTI_DEPLOYMENT_ID, env.DEPLOYMENT_ID),
      toolUrl: sanitizeToolUrl(
        firstPresent(env.TOOL_URL, env.DEV_TOOL_URL, env.PROD_TOOL_URL, env.SERVICE_URL, env.APP_BASE_URL)
      ),
      privateKey: firstPresent(env.LTI_PRIVATE_KEY, env.DEV_LTI_PRIVATE_KEY, env.PROD_LTI_PRIVATE_KEY)
    },
    canvas: {
      apiBaseUrl: canvasApiBaseUrl,
      domain: canvasDomain,
      oauthClientId: firstPresent(env.CANVAS_API_CLIENT_ID, env.DEV_API_CLIENT_ID, env.PROD_API_CLIENT_ID),
      oauthClientSecret: firstPresent(
        env.CANVAS_API_CLIENT_SECRET,
        env.DEV_API_CLIENT_SECRET,
        env.PROD_API_CLIENT_SECRET
      ),
      redirectUri: firstPresent(env.CANVAS_REDIRECT_URI, env.OAUTH_REDIRECT_URI)
    },
    security: {
      sessionSecret:
        firstPresent(
          env.SESSION_SECRET,
          env.ADMIN_PASSWORD,
          profile === "prod" ? undefined : "seb-canvas-session-dev-secret"
        ) || "",
      stateEncryptionKey:
        firstPresent(env.STATE_ENCRYPTION_KEY, profile === "prod" ? undefined : "seb-canvas-dev-state-key") || "",
      debugEnabled,
      detectorDiagnosticsEnabled
    },
    seb: {
      defaultQuitPassword: firstPresent(env.SEB_QUIT_PASSWORD, env.DEFAULT_SEB_QUIT_PASSWORD),
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
  if (!requiresHardenedRuntimeValidation(snapshot, env)) {
    return [];
  }
  const runtimeLabel = cloudRunRuntime ? "Cloud Run" : "production";

  const errors: string[] = [];
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
    ["LTI_PRIVATE_KEY", "DEV_LTI_PRIVATE_KEY", "PROD_LTI_PRIVATE_KEY"],
    "LTI_PRIVATE_KEY",
    runtimeLabel
  );
  requirePresent(errors, env, ["LTI_DEPLOYMENT_ID", "DEPLOYMENT_ID"], "LTI_DEPLOYMENT_ID", runtimeLabel);
  requirePresent(errors, env, ["SESSION_SECRET"], "SESSION_SECRET", runtimeLabel);
  requirePresent(errors, env, ["STATE_ENCRYPTION_KEY"], "STATE_ENCRYPTION_KEY", runtimeLabel);
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
    ["CANVAS_API_CLIENT_SECRET", "DEV_API_CLIENT_SECRET", "PROD_API_CLIENT_SECRET"],
    "CANVAS_API_CLIENT_SECRET",
    runtimeLabel
  );
  requirePresent(errors, env, ["GCP_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"], "GCP_PROJECT_ID", runtimeLabel);
  requirePresent(errors, env, ["FIRESTORE_DATABASE_ID"], "FIRESTORE_DATABASE_ID", runtimeLabel);

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
  if (
    snapshot.security.sessionSecret.length >= 32 &&
    snapshot.security.sessionSecret === snapshot.security.stateEncryptionKey
  ) {
    errors.push(`SESSION_SECRET and STATE_ENCRYPTION_KEY must be independent values in ${runtimeLabel}`);
  }

  if (snapshot.canvas.domain === LOCAL_CANVAS_DOMAIN) {
    errors.push(`CANVAS_DOMAIN must be set to the school's Canvas base URL in ${runtimeLabel}`);
  }

  if (snapshot.security.debugEnabled) {
    errors.push(`APP_DEBUG_ENABLED must be false in ${runtimeLabel}`);
  }

  if (snapshot.security.detectorDiagnosticsEnabled && snapshot.profile === "prod") {
    errors.push(`APP_DETECTOR_DIAGNOSTICS_ENABLED must be false in production deployments`);
  }

  if (parseBoolean(env.USE_IN_MEMORY_STORE, false)) {
    errors.push(`USE_IN_MEMORY_STORE must be false in ${runtimeLabel}`);
  }

  if (snapshot.seb.defaultQuitPassword && sebPasswordPolicyViolation(snapshot.seb.defaultQuitPassword)) {
    errors.push(
      `SEB_QUIT_PASSWORD must be 8-128 characters, use at least 5 different letters or numbers, and avoid common, sequential, or repetitive values in ${runtimeLabel}`
    );
  }

  if (!snapshot.seb.configEncryption.enabled) {
    errors.push(`SEB_CONFIG_ENCRYPTION_ENABLED must be true in ${runtimeLabel}`);
  } else if (!snapshot.seb.configEncryption.certificatePem && !snapshot.seb.configEncryption.certificatePath) {
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
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
