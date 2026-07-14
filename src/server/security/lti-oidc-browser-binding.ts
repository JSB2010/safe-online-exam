import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";

const COOKIE_NAME = "__Host-seb-lti-oidc";
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const COOKIE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BINDING_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const TRANSACTION_TTL_MS = 10 * 60 * 1_000;

export const LTI_OIDC_TRANSACTION_ID_FIELD = "oidcTransactionId";
export const LTI_OIDC_BROWSER_BINDING_FIELD = "oidcBrowserBindingHash";

export interface LtiOidcBrowserTransaction {
  transactionId: string;
  bindingHash: string;
  cookieName: string;
  cookieValue: string;
}

export function createLtiOidcBrowserTransaction(): LtiOidcBrowserTransaction {
  const transactionId = randomBytes(16).toString("base64url");
  const cookieValue = randomBytes(32).toString("base64url");
  return {
    transactionId,
    bindingHash: browserBindingHash(cookieValue),
    cookieName: ltiOidcTransactionCookieName(transactionId)!,
    cookieValue
  };
}

export function setLtiOidcBrowserTransactionCookie(response: Response, transaction: LtiOidcBrowserTransaction): void {
  response.cookie(transaction.cookieName, transaction.cookieValue, transactionCookieOptions());
}

export function matchingLtiOidcBrowserTransactionCookie(
  request: Request,
  state: Record<string, string>
): string | null {
  const transactionId = state[LTI_OIDC_TRANSACTION_ID_FIELD];
  const expectedHash = state[LTI_OIDC_BROWSER_BINDING_FIELD];
  const cookieName = ltiOidcTransactionCookieName(transactionId);
  if (!cookieName || !expectedHash || !BINDING_HASH_PATTERN.test(expectedHash)) {
    return null;
  }
  const cookieValue = request.cookies?.[cookieName] as unknown;
  if (typeof cookieValue !== "string" || !COOKIE_SECRET_PATTERN.test(cookieValue)) {
    return null;
  }
  const actual = Buffer.from(browserBindingHash(cookieValue), "base64url");
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? cookieName : null;
}

export function clearLtiOidcBrowserTransactionCookie(response: Response, cookieName: string): void {
  response.clearCookie(cookieName, transactionCookieClearOptions());
}

export function ltiOidcTransactionCookieName(transactionId: string | undefined): string | null {
  return transactionId && TRANSACTION_ID_PATTERN.test(transactionId) ? COOKIE_NAME : null;
}

function browserBindingHash(cookieValue: string): string {
  return createHash("sha256").update(`seb-lti-oidc-browser:${cookieValue}`, "utf8").digest("base64url");
}

function transactionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: TRANSACTION_TTL_MS
  };
}

function transactionCookieClearOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/"
  };
}
