import "reflect-metadata";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import session from "express-session";
import { ForbiddenException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { AppConfig } from "./config/app-config.js";
import { RepositoryProvider } from "./data/repositories.js";
import { RepositorySessionStore } from "./data/session-store.js";
import { isAllowedCorsOrigin } from "./http/cors.js";
import { applySecurityHeaders } from "./http/security-headers.js";

const SESSION_TTL_MS = 30 * 60 * 1000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const config = app.get(AppConfig);
  const repositories = app.get(RepositoryProvider);
  const expressApp = app.getHttpAdapter().getInstance() as express.Express;

  expressApp.disable("x-powered-by");
  expressApp.set("trust proxy", 1);
  expressApp.use((_request, response, next) => {
    applySecurityHeaders(response, config);
    next();
  });
  app.use(cookieParser());
  app.use(
    session({
      name: "JSESSIONID",
      store: new RepositorySessionStore(repositories.value.sessions, SESSION_TTL_MS),
      secret: config.value.security.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: shouldUseSecureCookies(config),
        sameSite: shouldUseSecureCookies(config) ? "none" : "lax",
        maxAge: SESSION_TTL_MS,
        path: "/"
      }
    })
  );

  expressApp.use(
    "/assets",
    express.static(join(process.cwd(), "dist/client/assets"), {
      etag: true,
      lastModified: true,
      maxAge: 0,
      setHeaders(response) {
        response.setHeader("cache-control", "no-cache");
      }
    })
  );

  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (isAllowedCorsOrigin(origin, config)) {
        callback(null, true);
        return;
      }
      callback(new ForbiddenException("Origin not allowed by CORS"));
    },
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "x-seb-proof-token", "x-safeexambrowser-configkeyhash", "x-seb-config-key-hash"]
  });

  await app.listen(config.port, process.env.HOST || "0.0.0.0");
}

function shouldUseSecureCookies(config: AppConfig): boolean {
  return config.profile === "prod" || config.toolUrl?.startsWith("https://") === true;
}

void bootstrap();
