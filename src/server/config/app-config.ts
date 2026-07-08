import { Injectable } from "@nestjs/common";

export type AppProfile = "dev" | "prod" | "test";

const LOCAL_CANVAS_DOMAIN = "https://canvas.example.test";
const DEFAULT_SEB_REQUIRED_DOMAINS =
  "accounts.google.com,*.googleusercontent.com,*.gstatic.com,ssl.gstatic.com,*.canvas-user-content.com,*.instructuremedia.com,*.inscloudgate.net";

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

  constructor() {
    this.snapshot = loadConfigFromEnv(process.env);
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
    const explicit = firstPresent(process.env.APP_BASE_URL, process.env.BASE_URL, this.toolUrl);
    return explicit ? explicit.replace(/\/+$/u, "") : undefined;
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
  const debugEnabled = parseBoolean(firstPresent(env.APP_DEBUG_ENABLED, env.DEBUG_ENABLED), profile !== "prod");

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
      sessionSecret: firstPresent(env.SESSION_SECRET, env.ADMIN_PASSWORD, "seb-canvas-session-dev-secret")!,
      stateEncryptionKey:
        firstPresent(env.STATE_ENCRYPTION_KEY, profile === "prod" ? undefined : "seb-canvas-dev-state-key") || "",
      debugEnabled
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
  if (!isCloudRunRuntime(env)) {
    return [];
  }

  const errors: string[] = [];
  requirePresent(errors, env, ["TOOL_URL", "DEV_TOOL_URL", "PROD_TOOL_URL", "SERVICE_URL", "APP_BASE_URL"], "TOOL_URL");
  requirePresent(errors, env, ["CANVAS_DOMAIN", "CANVAS_BASE_URL", "APP_CANVAS_BASE_URL"], "CANVAS_DOMAIN");
  requirePresent(
    errors,
    env,
    ["LTI_CLIENT_ID", "DEV_LTI_CLIENT_ID", "PROD_LTI_CLIENT_ID", "lti_client_id"],
    "LTI_CLIENT_ID"
  );
  requirePresent(errors, env, ["LTI_PRIVATE_KEY", "DEV_LTI_PRIVATE_KEY", "PROD_LTI_PRIVATE_KEY"], "LTI_PRIVATE_KEY");
  requirePresent(errors, env, ["SESSION_SECRET", "ADMIN_PASSWORD"], "SESSION_SECRET");
  requirePresent(errors, env, ["STATE_ENCRYPTION_KEY"], "STATE_ENCRYPTION_KEY");
  requirePresent(
    errors,
    env,
    ["CANVAS_API_CLIENT_ID", "DEV_API_CLIENT_ID", "PROD_API_CLIENT_ID"],
    "CANVAS_API_CLIENT_ID"
  );
  requirePresent(
    errors,
    env,
    ["CANVAS_API_CLIENT_SECRET", "DEV_API_CLIENT_SECRET", "PROD_API_CLIENT_SECRET"],
    "CANVAS_API_CLIENT_SECRET"
  );
  requirePresent(errors, env, ["GCP_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"], "GCP_PROJECT_ID");
  requirePresent(errors, env, ["FIRESTORE_DATABASE_ID"], "FIRESTORE_DATABASE_ID");

  if (snapshot.canvas.domain === LOCAL_CANVAS_DOMAIN) {
    errors.push("CANVAS_DOMAIN must be set to the school's Canvas base URL in Cloud Run");
  }

  if (
    snapshot.seb.configEncryption.enabled &&
    !snapshot.seb.configEncryption.certificatePem &&
    !snapshot.seb.configEncryption.certificatePath &&
    !snapshot.seb.configEncryption.publicKeyPem &&
    !snapshot.seb.configEncryption.publicKeyPath
  ) {
    errors.push(
      "SEB config encryption is enabled, so set SEB_CONFIG_ENCRYPTION_CERT_PEM or SEB_CONFIG_ENCRYPTION_CERT_PATH, or set SEB_CONFIG_ENCRYPTION_ENABLED=false"
    );
  }

  return errors;
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
  canonicalName: string
): void {
  if (firstPresent(...acceptedNames.map((name) => env[name]))) {
    return;
  }
  errors.push(`${canonicalName} is required in Cloud Run`);
}
