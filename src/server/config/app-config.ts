import { Injectable } from "@nestjs/common";

export type AppProfile = "dev" | "prod" | "test";

export interface AppConfigSnapshot {
  profile: AppProfile;
  port: number;
  projectId?: string;
  firestoreDatabaseId: string;
  firestoreCollections: {
    quizzes: string;
    sebSettings: string;
    contentItems: string;
    contentSebSettings: string;
    oauthTokens: string;
    moduleItemUpdates: string;
  };
  lti: {
    issuer: string;
    keySetUrl: string;
    tokenUrl: string;
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
    adminPassword?: string;
    debugEnabled: boolean;
  };
  seb: {
    defaultQuitPassword?: string;
    requiredDomains: string[];
  };
}

@Injectable()
export class AppConfig {
  private readonly snapshot: AppConfigSnapshot;

  constructor() {
    this.snapshot = loadConfigFromEnv(process.env);
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
    firstPresent(env.CANVAS_DOMAIN, env.CANVAS_BASE_URL, env.APP_CANVAS_BASE_URL, "https://kentdenver.instructure.com")!
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
      quizzes: firstPresent(env.FIRESTORE_QUIZZES_COLLECTION, "quizzes")!,
      sebSettings: firstPresent(env.FIRESTORE_SEB_SETTINGS_COLLECTION, "sebSettings")!,
      contentItems: firstPresent(env.FIRESTORE_CONTENT_ITEMS_COLLECTION, "contentItems")!,
      contentSebSettings: firstPresent(env.FIRESTORE_CONTENT_SEB_SETTINGS_COLLECTION, "contentSebSettings")!,
      oauthTokens: firstPresent(env.FIRESTORE_OAUTH_TOKENS_COLLECTION, "oauthTokens")!,
      moduleItemUpdates: firstPresent(env.FIRESTORE_MODULE_ITEM_UPDATES_COLLECTION, "module_item_updates")!
    },
    lti: {
      issuer: firstPresent(env.LTI_ISSUER, "https://canvas.instructure.com")!,
      keySetUrl: firstPresent(env.LTI_KEY_SET_URL, "https://sso.canvaslms.com/api/lti/security/jwks")!,
      tokenUrl: firstPresent(env.LTI_TOKEN_URL, "https://sso.canvaslms.com/login/oauth2/token")!,
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
      adminPassword: firstPresent(env.ADMIN_PASSWORD),
      debugEnabled
    },
    seb: {
      defaultQuitPassword: firstPresent(env.SEB_QUIT_PASSWORD, env.DEFAULT_SEB_QUIT_PASSWORD),
      requiredDomains: splitList(
        firstPresent(
          env.SEB_REQUIRED_DOMAINS,
          "accounts.google.com,*.googleusercontent.com,*.gstatic.com,ssl.gstatic.com,*.google.com,*.canvas-user-content.com,*.instructuremedia.com,*.canvaslms.com,*.inscloudgate.net"
        )
      )
    }
  };
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
