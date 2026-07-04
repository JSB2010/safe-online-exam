import "reflect-metadata";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import session from "express-session";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { AppConfig } from "./config/app-config.js";
import { isAllowedCorsOrigin } from "./http/cors.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const config = app.get(AppConfig);
  const expressApp = app.getHttpAdapter().getInstance() as express.Express;

  expressApp.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(
    session({
      name: "JSESSIONID",
      secret: config.value.security.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: shouldUseSecureCookies(config),
        sameSite: shouldUseSecureCookies(config) ? "none" : "lax",
        maxAge: 30 * 60 * 1000,
        path: "/"
      }
    })
  );

  expressApp.use(
    "/assets",
    express.static(join(process.cwd(), "dist/client/assets"), {
      immutable: true,
      maxAge: "1y"
    })
  );

  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (isAllowedCorsOrigin(origin, config)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-auth-token",
      "x-seb-proof-token",
      "x-safeexambrowser-configkeyhash",
      "x-seb-config-key-hash"
    ]
  });

  await app.listen(config.port, process.env.HOST || "0.0.0.0");
}

function shouldUseSecureCookies(config: AppConfig): boolean {
  return config.profile === "prod" || config.toolUrl?.startsWith("https://") === true;
}

void bootstrap();
