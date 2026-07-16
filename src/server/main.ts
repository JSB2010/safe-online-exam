import "reflect-metadata";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import session from "express-session";
import { NestFactory } from "@nestjs/core";
import type { CorsOptionsCallback } from "@nestjs/common/interfaces/external/cors-options.interface.js";
import { AppModule } from "./app.module.js";
import { AppConfig } from "./config/app-config.js";
import { RepositoryProvider } from "./data/repositories.js";
import { RepositorySessionStore } from "./data/session-store.js";
import { corsOptionsForRequest } from "./http/cors.js";
import { applySecurityHeaders } from "./http/security-headers.js";

const SESSION_TTL_MS = 30 * 60 * 1000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const config = app.get(AppConfig);
  const repositories = app.get(RepositoryProvider);
  const expressApp = app.getHttpAdapter().getInstance() as express.Express;

  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);

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

  app.enableCors((request: express.Request, callback: CorsOptionsCallback) =>
    callback(null, corsOptionsForRequest(request, config))
  );

  try {
    await repositories.assertReady();
    await app.listen(config.port, process.env.HOST || "0.0.0.0");
  } catch (error) {
    await app.close();
    throw error;
  }
}

function shouldUseSecureCookies(config: AppConfig): boolean {
  return config.profile === "prod" || config.toolUrl?.startsWith("https://") === true;
}

void bootstrap();
