import { describe, expect, it, vi } from "vitest";
import {
  clearLtiOidcBrowserTransactionCookie,
  createLtiOidcBrowserTransaction,
  LTI_OIDC_BROWSER_BINDING_FIELD,
  LTI_OIDC_TRANSACTION_ID_FIELD,
  ltiOidcTransactionCookieName,
  matchingLtiOidcBrowserTransactionCookie,
  setLtiOidcBrowserTransactionCookie
} from "../../src/server/security/lti-oidc-browser-binding.js";

describe("LTI OIDC browser binding", () => {
  it("issues a host-only cross-site transaction cookie and verifies its hash from authenticated state", () => {
    const transaction = createLtiOidcBrowserTransaction();
    const response = { cookie: vi.fn(), clearCookie: vi.fn() } as any;
    const state = {
      [LTI_OIDC_TRANSACTION_ID_FIELD]: transaction.transactionId,
      [LTI_OIDC_BROWSER_BINDING_FIELD]: transaction.bindingHash
    };

    setLtiOidcBrowserTransactionCookie(response, transaction);

    expect(transaction.cookieName).toBe(ltiOidcTransactionCookieName(transaction.transactionId));
    expect(response.cookie).toHaveBeenCalledWith(transaction.cookieName, transaction.cookieValue, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 600_000
    });
    expect(
      matchingLtiOidcBrowserTransactionCookie(
        { cookies: { [transaction.cookieName]: transaction.cookieValue } } as any,
        state
      )
    ).toBe(transaction.cookieName);

    clearLtiOidcBrowserTransactionCookie(response, transaction.cookieName);
    expect(response.clearCookie).toHaveBeenCalledWith(transaction.cookieName, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });
  });

  it.each([
    ["missing state", {}, {}],
    [
      "invalid transaction id",
      { [LTI_OIDC_TRANSACTION_ID_FIELD]: "../cookie", [LTI_OIDC_BROWSER_BINDING_FIELD]: "a".repeat(43) },
      {}
    ],
    [
      "invalid binding hash",
      { [LTI_OIDC_TRANSACTION_ID_FIELD]: "a".repeat(22), [LTI_OIDC_BROWSER_BINDING_FIELD]: "not-a-hash" },
      {}
    ],
    [
      "missing cookie",
      { [LTI_OIDC_TRANSACTION_ID_FIELD]: "a".repeat(22), [LTI_OIDC_BROWSER_BINDING_FIELD]: "a".repeat(43) },
      {}
    ],
    [
      "oversized cookie",
      { [LTI_OIDC_TRANSACTION_ID_FIELD]: "a".repeat(22), [LTI_OIDC_BROWSER_BINDING_FIELD]: "a".repeat(43) },
      { "__Host-seb-lti-oidc": "x".repeat(1_000) }
    ]
  ])("rejects %s without accepting an attacker-selected cookie name or value", (_label, state, cookies) => {
    expect(matchingLtiOidcBrowserTransactionCookie({ cookies } as any, state)).toBeNull();
  });

  it("rejects a well-formed cookie value from another browser", () => {
    const initiatingBrowser = createLtiOidcBrowserTransaction();
    const otherBrowser = createLtiOidcBrowserTransaction();
    const state = {
      [LTI_OIDC_TRANSACTION_ID_FIELD]: initiatingBrowser.transactionId,
      [LTI_OIDC_BROWSER_BINDING_FIELD]: initiatingBrowser.bindingHash
    };

    expect(
      matchingLtiOidcBrowserTransactionCookie(
        { cookies: { [initiatingBrowser.cookieName]: otherBrowser.cookieValue } } as any,
        state
      )
    ).toBeNull();
  });

  it("reuses one fixed cookie name so repeated public login initiations cannot accumulate cookies", () => {
    const first = createLtiOidcBrowserTransaction();
    const second = createLtiOidcBrowserTransaction();
    const firstState = {
      [LTI_OIDC_TRANSACTION_ID_FIELD]: first.transactionId,
      [LTI_OIDC_BROWSER_BINDING_FIELD]: first.bindingHash
    };
    const secondState = {
      [LTI_OIDC_TRANSACTION_ID_FIELD]: second.transactionId,
      [LTI_OIDC_BROWSER_BINDING_FIELD]: second.bindingHash
    };
    const cookiesAfterSecondLogin = { [second.cookieName]: second.cookieValue };

    expect(first.cookieName).toBe("__Host-seb-lti-oidc");
    expect(second.cookieName).toBe(first.cookieName);
    expect(second.cookieValue).not.toBe(first.cookieValue);
    expect(matchingLtiOidcBrowserTransactionCookie({ cookies: cookiesAfterSecondLogin } as any, firstState)).toBeNull();
    expect(matchingLtiOidcBrowserTransactionCookie({ cookies: cookiesAfterSecondLogin } as any, secondState)).toBe(
      second.cookieName
    );
  });
});
