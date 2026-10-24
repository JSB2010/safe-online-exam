import { diagnostics } from "../diagnostics/runtime.js";
import type { Request } from "express";

export async function regenerateSession(request: Request): Promise<void> {
  if (!request.session?.regenerate) return;
  await new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        diagnostics.failure("session.regenerate", error, { reasonCode: "SESSION_REGENERATE_FAILED" });
        reject(error);
      } else {
        diagnostics.record("session.regenerate", { outcome: "succeeded" });
        resolve();
      }
    });
  });
}

export async function saveSession(request: Request): Promise<void> {
  if (!request.session?.save) return;
  await new Promise<void>((resolve, reject) => {
    request.session!.save((error) => {
      if (error) {
        diagnostics.failure("session.persistence", error, { reasonCode: "SESSION_PERSIST_FAILED" });
        reject(error);
      } else {
        diagnostics.record("session.persistence", { outcome: "succeeded" });
        resolve();
      }
    });
  });
}
