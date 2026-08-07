import type { Request } from "express";

export async function regenerateSession(request: Request): Promise<void> {
  if (!request.session?.regenerate) return;
  await new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

export async function saveSession(request: Request): Promise<void> {
  if (!request.session?.save) return;
  await new Promise<void>((resolve, reject) => {
    request.session!.save((error) => (error ? reject(error) : resolve()));
  });
}
