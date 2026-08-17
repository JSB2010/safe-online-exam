import { expect, test } from "@playwright/test";

test("keeps an unvalidated assessment exit page nonterminal", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/seb/exit/course-1/classicquiz_quiz-1");

  await expect(page).toHaveURL(/\/seb\/exit\/course-1\/classicquiz_quiz-1$/u);
  await expect(page.getByRole("heading", { name: "Assessment Complete" })).toBeVisible();
  await expect(page.getByText("Return to the submitted assessment results page")).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("preserves a New Quiz content ID on the nonterminal exit page", async ({ page }) => {
  await page.goto("/seb/exit/course-1/newquiz:course-1:assignment-9");

  await expect(page).toHaveURL(/\/seb\/exit\/course-1\/newquiz:course-1:assignment-9$/u);
  await expect(page.getByRole("heading", { name: "Assessment Complete" })).toBeVisible();
  await expect(page.getByText("Return to the submitted assessment results page")).toBeVisible();
});

test("serves detector scripts from stable and Canvas-theme paths", async ({ request }) => {
  for (const path of ["/js/canvas-seb-detector.js", "/api/seb/canvas-detector.js"]) {
    const response = await request.get(path, { headers: { "Accept-Encoding": "gzip" } });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/javascript");
    expect(response.headers()["content-encoding"]).toBe("gzip");
    expect(await response.text()).toContain("Safe Online Exam detector");
  }

  const loader = await request.get("/js/canvas-seb-theme-loader.js");
  expect(loader.status()).toBe(200);
  expect(loader.headers()["content-type"]).toContain("application/javascript");
  expect(await loader.text()).toContain("data-canvas-seb-detector");
});

test("serves health, JWKS, and Canvas LTI registration metadata", async ({ request }) => {
  const health = await request.get("/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toEqual({ status: "UP" });

  const jwks = await request.get("/.well-known/jwks.json");
  expect(jwks.status()).toBe(200);
  const jwksBody = (await jwks.json()) as { keys?: Array<Record<string, unknown>> };
  expect(jwksBody.keys?.[0]).toEqual(
    expect.objectContaining({
      kty: "RSA",
      use: "sig",
      alg: "RS256"
    })
  );

  const ltiConfig = await request.get("/lti/config");
  expect(ltiConfig.status()).toBe(200);
  const ltiBody = (await ltiConfig.json()) as Record<string, any>;
  expect(ltiBody).toMatchObject({
    title: "Safe Online Exam",
    oidc_initiation_url: "http://localhost:8080/lti/login",
    target_link_uri: "http://localhost:8080/lti/launch",
    public_jwk_url: "http://localhost:8080/.well-known/jwks.json"
  });
  const placement = ltiBody.extensions?.[0]?.settings?.placements?.[0];
  expect(placement).toMatchObject({
    placement: "course_navigation",
    message_type: "LtiResourceLinkRequest",
    target_link_uri: "http://localhost:8080/lti/launch",
    visibility: "members",
    default: "enabled",
    enabled: true
  });
  expect(placement).not.toHaveProperty("windowTarget");
  expect(ltiBody.extensions?.[0]?.settings?.placements?.[1]).toMatchObject({
    placement: "account_navigation",
    target_link_uri: "http://localhost:8080/lti/launch",
    visibility: "admins",
    root_account_only: true,
    custom_fields: expect.objectContaining({
      seb_launch_surface: "account_admin",
      canvas_root_account_id: "$Canvas.rootAccount.id"
    })
  });

  const favicon = await request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/x-icon");
});

test("renders OAuth completion without resuming privileged management UI", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/oauth-connected-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "canvas-oauth-connected",
          data: { canvasReturnUrl: "https://canvas.example.edu/courses/course-1" }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });

  await page.goto("/oauth-connected-preview");

  await expect(page.getByRole("heading", { name: "Canvas Connected" })).toBeVisible();
  await expect(page.getByText(/reopen Safe Online Exam from course or account navigation/u)).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to Canvas" })).toHaveAttribute(
    "href",
    "https://canvas.example.edu/courses/course-1"
  );
  await expect(page.getByRole("link", { name: "Return to Canvas" })).toHaveAttribute("target", "_top");
  expect(browserErrors).toEqual([]);
});

test("keeps the OAuth completion fallback open when its opener does not acknowledge it", async ({ context, page }) => {
  await context.route("**/oauth-unrelated-opener", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>Canvas navigation window</h1></body></html>"
    });
  });
  await context.route("**/oauth-unacknowledged-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "canvas-oauth-connected",
          data: { canvasReturnUrl: "https://canvas.example.edu/courses/course-1" }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });

  await page.goto("/oauth-unrelated-opener");
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(() => window.open("/oauth-unacknowledged-preview", "existing_lti_window"));
  const popup = await popupPromise;

  await expect(popup.getByText(/reopen Safe Online Exam from course or account navigation/u)).toBeVisible();
  await expect(popup.getByRole("link", { name: "Return to Canvas" })).toBeVisible();
  expect(popup.isClosed()).toBe(false);
});

test("returns the existing LTI page after an instructor OAuth popup completes", async ({ context, page }) => {
  const browserErrors: string[] = [];
  const trackErrors = (target: typeof page) => {
    target.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    target.on("pageerror", (error) => browserErrors.push(error.message));
  };
  trackErrors(page);
  context.on("page", trackErrors);

  await context.route("**/oauth-popup-start", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "canvas-oauth-connected",
          data: { canvasReturnUrl: "https://canvas.example.edu/courses/course-1" }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });
  await context.route("**/authorization-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "api-authorization",
          data: { authUrl: "/oauth-popup-start", message: "Connect Canvas to continue." }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });
  await context.route("**/lti/launch?connected=1", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>Instructor workspace</h1></body></html>"
    });
  });

  await page.goto("/authorization-preview");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Canvas" }).click();
  const popup = await popupPromise;

  await expect(page).toHaveURL(/\/lti\/launch\?connected=1$/u);
  await expect(page.getByRole("heading", { name: "Instructor workspace" })).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("ignores a forged OAuth completion message that did not come from the opened popup", async ({ context, page }) => {
  await context.route("**/oauth-popup-pending", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><p>Canvas authorization pending</p></body></html>"
    });
  });
  await context.route("**/authorization-spoof-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "api-authorization",
          data: { authUrl: "/oauth-popup-pending", message: "Connect Canvas to continue." }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });

  await page.goto("/authorization-spoof-preview");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Canvas" }).click();
  const popup = await popupPromise;
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: window,
        data: { type: "seb-canvas-oauth-connected" }
      })
    );
  });

  await expect(page).toHaveURL(/\/authorization-spoof-preview$/u);
  await expect(page.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  await popup.close();
  await expect(page.getByRole("alert")).toContainText("closed before it finished");
});

test("rejects a same-origin network-path OAuth target", async ({ context, page }) => {
  await context.route("**/authorization-network-path-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "api-authorization",
          data: {
            authUrl: "http://127.0.0.1:8080//attacker.example",
            message: "Connect Canvas to continue."
          }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });

  await page.goto("/authorization-network-path-preview");
  await page.evaluate(() => {
    const targetWindow = window;
    Object.defineProperty(window, "open", {
      configurable: true,
      value: (target: string | URL | undefined) => {
        (window as typeof window & { openedOAuthTarget?: string }).openedOAuthTarget = String(target);
        return targetWindow;
      }
    });
  });
  await page.getByRole("button", { name: "Connect Canvas" }).click();

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { openedOAuthTarget?: string }).openedOAuthTarget))
    .toBe("/api/oauth2authorize");
});

// Mirrors the popup half of the completion handshake: report the connection, then close only after the
// opener acknowledges it. The opener no longer closes the popup on the page's behalf.
const studentSessionPopupBody = (returnUrl: string) =>
  `<!doctype html><html><body><script>
    window.addEventListener("message", (event) => {
      if (
        event.source === window.opener &&
        event.origin === window.location.origin &&
        event.data &&
        event.data.type === "seb-canvas-session-connected:acknowledged"
      ) {
        window.close();
      }
    });
    window.opener.postMessage(
      { type: "seb-canvas-session-connected", returnUrl: ${JSON.stringify(returnUrl)} },
      window.location.origin
    );
  </script></body></html>`;

test("returns the existing LTI page after a student session OAuth popup completes with a validated return URL", async ({
  context,
  page
}) => {
  const browserErrors: string[] = [];
  const trackErrors = (target: typeof page) => {
    target.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    target.on("pageerror", (error) => browserErrors.push(error.message));
  };
  trackErrors(page);
  context.on("page", trackErrors);

  await context.route("**/student-session-popup-start", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: studentSessionPopupBody("/lti/launch?resumed=1")
    });
  });
  await context.route("**/authorization-student-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "student-session-authorization",
          data: { authUrl: "/student-session-popup-start" }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });
  await context.route("**/lti/launch?resumed=1", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>Resumed quiz workspace</h1></body></html>"
    });
  });

  await page.goto("/authorization-student-preview");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Canvas" }).click();
  const popup = await popupPromise;

  await expect(page).toHaveURL(/\/lti\/launch\?resumed=1$/u);
  await expect(page.getByRole("heading", { name: "Resumed quiz workspace" })).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("falls back to the default destination when a student session popup reports a cross-origin return URL", async ({
  context,
  page
}) => {
  const browserErrors: string[] = [];
  const trackErrors = (target: typeof page) => {
    target.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    target.on("pageerror", (error) => browserErrors.push(error.message));
  };
  trackErrors(page);
  context.on("page", trackErrors);

  await context.route("**/student-session-popup-malicious", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: studentSessionPopupBody("https://attacker.example.com/steal-session")
    });
  });
  await context.route("**/authorization-student-malicious-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "student-session-authorization",
          data: { authUrl: "/student-session-popup-malicious" }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });
  await context.route("**/lti/launch?connected=1", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>Default quiz workspace</h1></body></html>"
    });
  });

  await page.goto("/authorization-student-malicious-preview");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Canvas" }).click();
  const popup = await popupPromise;

  await expect(page).toHaveURL(/\/lti\/launch\?connected=1$/u);
  await expect(page.getByRole("heading", { name: "Default quiz workspace" })).toBeVisible();
  await expect(page).not.toHaveURL(/attacker\.example\.com/u);
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("sanitizes a cross-origin authUrl before opening the Canvas connection popup", async ({ context, page }) => {
  const browserErrors: string[] = [];
  const trackErrors = (target: typeof page) => {
    target.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    target.on("pageerror", (error) => browserErrors.push(error.message));
  };
  trackErrors(page);
  context.on("page", trackErrors);

  await context.route("**/api/oauth2authorize", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>Sanitized fallback authorization</h1></body></html>"
    });
  });
  await context.route("**/authorization-untrusted-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "api-authorization",
          data: { authUrl: "https://attacker.example.com/phish", message: "Connect Canvas to continue." }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });

  await page.goto("/authorization-untrusted-preview");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Canvas" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  expect(new URL(popup.url()).origin).toBe(new URL(page.url()).origin);
  expect(popup.url()).toContain("/api/oauth2authorize");
  await expect(popup.getByRole("heading", { name: "Sanitized fallback authorization" })).toBeVisible();
  await popup.close();
  expect(browserErrors).toEqual([]);
});

test("falls back to direct navigation when the Canvas connection popup is blocked", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.route("**/oauth-fallback-target", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>Fallback authorization page</h1></body></html>"
    });
  });
  await page.route("**/authorization-blocked-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "api-authorization",
          data: { authUrl: "/oauth-fallback-target", message: "Connect Canvas to continue." }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });

  await page.goto("/authorization-blocked-preview");
  await page.getByRole("button", { name: "Connect Canvas" }).click();

  await expect(page).toHaveURL(/\/oauth-fallback-target$/u);
  await expect(page.getByRole("heading", { name: "Fallback authorization page" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("renders the Canvas connected fallback without a return action when no return URL is provided", async ({
  page
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/oauth-connected-no-return-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "canvas-oauth-connected",
          data: {}
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });

  await page.goto("/oauth-connected-no-return-preview");

  await expect(page.getByRole("heading", { name: "Canvas Connected" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to Canvas" })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("renders the responsive root-account administrator workspace and controlled secret reveal", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/admin-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "admin",
          data: { rootAccountId: "7", authToken: "test-admin-token" }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });
  const adminCourse = {
    id: "101",
    name: "Biology",
    courseCode: "BIO-101",
    workflowState: "available",
    setupCompleted: true,
    hasCourseDefaults: true,
    assessmentCount: 2,
    enabledAssessmentCount: 1,
    adminToolPresetIds: ["preset-desmos"],
    assessments: [
      {
        id: "classicquiz_501",
        title: "Midterm",
        contentType: "CLASSIC_QUIZ",
        published: true,
        sebRequired: true,
        enabled: true,
        hasAccessCode: true,
        hasStartPassword: true,
        hasQuitPassword: true
      },
      {
        id: "classicquiz_502",
        title: "Practice quiz",
        contentType: "CLASSIC_QUIZ",
        published: true,
        sebRequired: false,
        enabled: false,
        hasAccessCode: false,
        hasStartPassword: false,
        hasQuitPassword: false
      }
    ]
  };
  const adminPreset = {
    id: "preset-desmos",
    name: "Desmos Graphing Calculator",
    description: "Approved graphing calculator",
    tool: {
      id: "preset-desmos",
      label: "Desmos Graphing Calculator",
      url: "https://www.desmos.com/calculator",
      enabled: false,
      allowedRules: []
    },
    assignedCourseIds: ["101"],
    assignedCourseCount: 1,
    pendingAssignmentCount: 0,
    failedAssignmentCount: 0
  };
  let summaryRequests = 0;
  let courseListRequests = 0;
  let courseDetailRequests = 0;
  await page.route("**/api/admin/summary", async (route) => {
    summaryRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        account: { id: "7", name: "Example School" },
        summary: {
          courseCount: 1,
          configuredCourseCount: 1,
          assessmentCount: 2,
          enabledAssessmentCount: 1,
          toolPresetCount: 1
        }
      })
    });
  });
  await page.route("**/api/admin/courses?*", async (route) => {
    courseListRequests += 1;
    const includePast = new URL(route.request().url()).searchParams.get("includePast") === "true";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        courses: [
          { ...adminCourse, assessments: undefined },
          ...(includePast
            ? [
                {
                  ...adminCourse,
                  id: "99",
                  name: "Archived Biology",
                  termId: "21",
                  termName: "Spring 2026",
                  concluded: true,
                  assessments: undefined
                }
              ]
            : [])
        ],
        nextCursor: null
      })
    });
  });
  await page.route("**/api/admin/courses/101", async (route) => {
    courseDetailRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, course: adminCourse })
    });
  });
  await page.route("**/api/admin/tool-presets", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, presets: [adminPreset] })
    });
  });
  let operationalTermId = "22";
  const adminTerms = [
    { id: "22", name: "Fall 2026", startAt: "2026-07-01", endAt: "2026-12-31" },
    { id: "23", name: "Spring 2027", startAt: "2027-01-01", endAt: "2027-06-30" }
  ];
  await page.route("**/api/admin/terms", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        terms: adminTerms,
        operationalTerm: adminTerms.find((term) => term.id === operationalTermId)
      })
    });
  });
  await page.route("**/api/admin/terms/operational", async (route) => {
    expect(route.request().headers()["x-auth-token"]).toBe("test-admin-token");
    operationalTermId = String(route.request().postDataJSON().termId);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        operationalTerm: adminTerms.find((term) => term.id === operationalTermId)
      })
    });
  });
  await page.route("**/api/admin/course-catalog?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        courses: [
          {
            id: "102",
            name: "Chemistry",
            courseCode: "CHEM-101",
            termName: "Fall 2026",
            connected: false
          }
        ],
        nextCursor: null
      })
    });
  });
  await page.route("**/api/admin/courses/101/assessments/classicquiz_501/passwords/reveal", async (route) => {
    expect(route.request().headers()["x-auth-token"]).toBe("test-admin-token");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        expiresInSeconds: 30,
        passwords: {
          start: { value: "test-start-password", source: "assessment" },
          exit: { value: null, source: "managed" },
          accessCode: { value: "TEST-CODE", source: "canvas" }
        }
      })
    });
  });
  let courseResetRequest: { method: string; token?: string; body: unknown } | null = null;
  await page.route("**/api/admin/courses/101/reset", async (route) => {
    courseResetRequest = {
      method: route.request().method(),
      token: route.request().headers()["x-auth-token"],
      body: route.request().postDataJSON()
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        disabledAssessmentCount: 2,
        deletedAssessmentCount: 2,
        deletedTransientStateCount: 0,
        deletedCourseRecordCount: 1,
        deletedPresetAssignmentCount: 1
      })
    });
  });

  await page.goto("/admin-preview");

  await expect(page.getByRole("heading", { name: "Safe Online Exam Admin" })).toBeVisible();
  const coursesTab = page.getByRole("tab", { name: /Courses/u });
  await expect(coursesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Biology" })).toBeVisible();
  await expect(page.getByLabel("Operational term")).toHaveValue("22");
  expect(summaryRequests).toBe(1);
  expect(courseListRequests).toBe(1);
  expect(courseDetailRequests).toBe(1);
  await page.getByLabel("Show past and other courses").check();
  await expect(page.getByRole("button", { name: /Archived Biology/u })).toBeVisible();
  await page.getByLabel("Show past and other courses").uncheck();
  await expect(page.getByRole("button", { name: /Archived Biology/u })).toHaveCount(0);
  await page.getByLabel("Operational term").selectOption("23");
  await expect(page.getByLabel("Operational term")).toHaveValue("23");
  await page.getByRole("button", { name: "Connect" }).click();
  const connectDialog = page.getByRole("dialog", { name: "Connect Canvas courses" });
  await expect(connectDialog).toBeVisible();
  await expect(connectDialog.getByText("Chemistry")).toBeVisible();
  await connectDialog.getByRole("button", { name: "Close" }).click();
  await coursesTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Approved exam tools" })).toBeVisible();
  await coursesTab.click();
  await expect(page.getByRole("heading", { name: "Biology" })).toBeVisible();
  await expect(page.getByText("Midterm")).toBeVisible();
  const inactiveAssessment = page.locator("article.admin-assessment-row").filter({ hasText: "Practice quiz" });
  await expect(inactiveAssessment.getByRole("button", { name: "Enable Safe Online Exam" })).toBeVisible();
  await expect(inactiveAssessment.getByRole("button", { name: /Reveal passwords/u })).toHaveCount(0);
  await expect(inactiveAssessment.getByRole("button", { name: /Reset settings/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reveal passwords" })).toHaveCount(1);

  await page.getByRole("tab", { name: /Institution settings/u }).click();
  await expect(page.getByRole("heading", { name: "Approved exam tools" })).toBeVisible();
  await expect(page.getByText("Desmos Graphing Calculator")).toBeVisible();
  await page.getByRole("button", { name: "Assign courses" }).click();
  const rolloutDialog = page.getByRole("dialog", { name: "Assign Desmos Graphing Calculator" });
  await expect(rolloutDialog).toBeVisible();
  await expect(rolloutDialog.getByText("Biology")).toBeVisible();
  await rolloutDialog.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.getByRole("tab", { name: /Institution settings/u })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Approved exam tools" })).toBeVisible();
  await page.getByRole("button", { name: "New exam tool" }).click();
  const presetDialog = page.getByRole("dialog", { name: "Create tool preset" });
  await expect(presetDialog).toBeVisible();
  await presetDialog.getByLabel("Start page").fill("https://docs.google.com/presentation/d/example/edit");
  await expect(presetDialog.getByText("Extra pages students can use")).toBeVisible();
  await presetDialog.getByRole("button", { name: "Add location" }).click();
  await expect(presetDialog.getByText("What should students be able to open?")).toBeVisible();
  await expect(presetDialog.getByText("This one page or file")).toBeVisible();
  await expect(presetDialog.getByText("This address and related links")).toBeVisible();
  await expect(presetDialog.getByText("This whole website")).toBeVisible();
  await presetDialog.getByText("This one page or file").click();
  await presetDialog.getByLabel("Address to allow").fill("https://www.youtube.com/watch?v=qZ7OjpjGVGs");
  await expect(presetDialog.getByText(/This is hosted by youtube\.com/u)).toBeVisible();
  await presetDialog.getByText("This whole website").click();
  await expect(presetDialog.getByText(/I understand this lets students open any HTTPS page/u)).toBeVisible();
  await page.getByRole("button", { name: "Close tool preset" }).click();
  await page.getByRole("button", { name: "New exam tool" }).click();
  const youtubePresetDialog = page.getByRole("dialog", { name: "Create tool preset" });
  await youtubePresetDialog.getByRole("button", { name: "YouTube video" }).click();
  await expect(youtubePresetDialog.getByLabel("YouTube video link")).toBeVisible();
  await youtubePresetDialog.getByLabel("YouTube video link").fill("https://youtu.be/qZ7OjpjGVGs");
  await expect(
    youtubePresetDialog.getByText("Only this public video and the player resources it requires are available.")
  ).toBeVisible();
  await youtubePresetDialog.getByRole("button", { name: "Save preset" }).click();
  await expect(youtubePresetDialog).toBeHidden();

  await page.getByRole("tab", { name: /Courses/u }).click();
  await page.getByRole("button", { name: "Reveal passwords" }).click();
  await expect(page.getByText("test-start-password")).toBeVisible();
  await expect(page.getByText("TEST-CODE")).toBeVisible();
  await page.getByRole("button", { name: "Reset course" }).click();
  const resetDialog = page.getByRole("dialog", { name: "Reset Biology?" });
  await expect(resetDialog).toBeVisible();
  await expect(
    resetDialog.getByText(/Canvas authorization and the administrator connection stay in place/u)
  ).toBeVisible();
  await expect(resetDialog.getByText(/school tool assignments/u)).toBeVisible();
  const resetButton = resetDialog.getByRole("button", { name: "Disable quizzes and reset course" });
  await expect(resetButton).toBeDisabled();
  await resetDialog.getByLabel(/Enter course ID/u).fill("101");
  await resetButton.click();
  await expect(resetDialog).toBeHidden();
  expect(courseResetRequest).toEqual({
    method: "POST",
    token: "test-admin-token",
    body: { confirmation: "101" }
  });
  expect(browserErrors).toEqual([]);
});

test("validates instructor setup steps and updates password requirements in real time", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/instructor-password-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "teacher",
          data: {
            courseId: "course-1",
            courseName: "Biology",
            userId: "user-1",
            authToken: "test-token",
            showSetupWizard: true,
            quizzes: [],
            quizSebSettings: {},
            courseDefaults: {
              courseId: "course-1",
              setupCompleted: false,
              urlRules: [],
              externalTools: [],
              hasQuitPassword: false,
              hasEffectiveQuitPassword: false,
              hasStartPassword: false
            },
            onboarding: {
              courseSecurityReady: false,
              courseSetupComplete: false,
              enabledAssessmentCount: 0
            }
          }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });
  let saveCalls = 0;
  await page.route("**/api/quizzes/course/course-1/defaults", async (route) => {
    saveCalls += 1;
    expect(route.request().headers()["x-auth-token"]).toBe("test-token");
    if (saveCalls === 2) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "Course settings changed in another Canvas session. Refresh the course and review the latest values."
        })
      });
      return;
    }
    const submitted = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        defaults: {
          ...submitted,
          courseId: "course-1",
          setupCompleted: true,
          hasQuitPassword: true,
          hasEffectiveQuitPassword: true,
          hasStartPassword: false
        }
      })
    });
  });

  await page.goto("/instructor-password-preview");
  const setupDialog = page.getByRole("dialog", { name: "Set up Safe Online Exam" });
  await setupDialog.getByRole("button", { name: "Continue" }).click();
  const exitPassword = setupDialog.locator("#course-exit-password");
  await exitPassword.fill("short");
  await expect(setupDialog.getByText("Password requirements")).toBeVisible();
  await setupDialog.getByRole("button", { name: "Continue" }).click();
  await expect(
    setupDialog.locator("small.field-error").filter({ hasText: "Exit password must be at least 8 characters." })
  ).toBeVisible();
  await expect(setupDialog.getByText("Review the highlighted password requirements before continuing.")).toBeVisible();
  await expect(setupDialog.getByRole("heading", { name: "Set your course exit password" })).toBeVisible();

  await exitPassword.fill("cobalt lantern 4829");
  await expect(setupDialog.locator(".password-requirements li").filter({ hasText: "8–128 characters" })).toHaveClass(
    /met/u
  );
  await setupDialog.getByRole("button", { name: "Continue" }).click();
  await setupDialog.getByRole("button", { name: "Add tool" }).click();
  await setupDialog.getByRole("button", { name: "Continue" }).click();
  await expect(setupDialog.getByText(/Review the exam tool settings before continuing/u)).toBeVisible();
  await setupDialog.getByRole("button", { name: "Remove tool" }).click();
  await setupDialog.getByRole("button", { name: "Continue" }).click();
  await setupDialog.getByRole("button", { name: "Save and finish" }).click();
  await expect(setupDialog).toBeHidden();
  expect(saveCalls).toBe(1);

  await page.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Safe Online Exam course policy" });
  const replacementExitPassword = settingsDialog.locator("#course-exit-password");
  await replacementExitPassword.fill("12345678");
  await settingsDialog.getByRole("button", { name: "Save defaults" }).click();
  await expect(settingsDialog.getByText(/avoid common words, sequences, or repeated patterns/u)).toBeVisible();
  expect(saveCalls).toBe(1);

  await replacementExitPassword.fill("another cobalt lantern 5930");
  await settingsDialog.getByRole("button", { name: "Save defaults" }).click();
  await expect(settingsDialog.getByText(/Course settings changed in another Canvas session/u)).toBeVisible();
  expect(saveCalls).toBe(2);

  await replacementExitPassword.fill("different meadow 7301");
  await settingsDialog.getByRole("button", { name: "Save defaults" }).click();
  await expect(settingsDialog).toBeHidden();
  expect(saveCalls).toBe(3);
  expect(browserErrors).toEqual([]);
});

test("lets an instructor duplicate a saved exam tool into selected Canvas teacher courses", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/instructor-tool-copy-preview", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script id="seb-bootstrap" type="application/json">${JSON.stringify(
        {
          view: "teacher",
          data: {
            courseId: "course-1",
            courseName: "Current Course",
            userId: "user-1",
            authToken: "test-token",
            quizzes: [],
            quizSebSettings: {},
            courseDefaults: {
              courseId: "course-1",
              setupCompleted: true,
              urlRules: [],
              externalTools: [
                {
                  id: "formula-sheet",
                  label: "Formula sheet",
                  url: "https://reference.example.edu/formulas",
                  enabled: true,
                  allowedRules: [{ id: "images", match: "path", value: "https://reference.example.edu/images/*" }]
                }
              ]
            }
          }
        }
      )}</script><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`
    });
  });
  await page.route("**/api/quizzes/course/course-1/exam-tools/formula-sheet/copy-targets", async (route) => {
    expect(route.request().headers()["x-auth-token"]).toBe("test-token");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        courses: [
          { courseId: "course-2", name: "Biology", courseCode: "BIO-2" },
          { courseId: "course-3", name: "Chemistry", courseCode: "CHEM-3" }
        ]
      })
    });
  });
  await page.route("**/api/quizzes/course/course-1/exam-tools/formula-sheet/copy", async (route) => {
    expect(route.request().headers()["x-auth-token"]).toBe("test-token");
    expect(route.request().postDataJSON()).toEqual({ courseIds: ["course-2"] });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        copied: [{ courseId: "course-2", name: "Biology", courseCode: "BIO-2", status: "copied" }],
        alreadyPresent: [],
        failed: []
      })
    });
  });

  await page.goto("/instructor-tool-copy-preview");
  await page.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Safe Online Exam course policy" });
  await settingsDialog.getByRole("button", { name: "Exam tools" }).click();
  await settingsDialog.getByRole("button", { name: "Edit" }).click();
  await settingsDialog.getByRole("button", { name: "Duplicate to courses" }).click();
  const copyDialog = page.getByRole("dialog", { name: "Copy Formula sheet" });
  await expect(copyDialog).toBeVisible();
  await copyDialog.getByRole("checkbox", { name: "Biology" }).check();
  await copyDialog.getByRole("button", { name: "Duplicate to 1 course" }).click();
  await expect(copyDialog.getByText("Added to 1 course.")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("serves built app assets before API CORS restrictions", async ({ request }) => {
  const response = await request.get("/assets/index.js", {
    headers: {
      "Accept-Encoding": "br",
      Origin: "https://alternate-cloud-run-host.example"
    }
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/javascript");
  expect(response.headers()["content-encoding"]).toBe("br");
  expect(response.headers()["cache-control"]).toBe("no-cache");
  const entrySource = await response.text();
  expect(entrySource).toContain("createRoot");

  const vendorName = entrySource.match(/react-vendor-[A-Za-z0-9_-]{8}\.js/u)?.[0];
  const routeChunkName = entrySource.match(/dashboard-[A-Za-z0-9_-]{8}\.js/u)?.[0];
  expect(vendorName).toBeTruthy();
  expect(routeChunkName).toBeTruthy();

  for (const assetName of [vendorName, routeChunkName]) {
    const chunk = await request.get(`/assets/${assetName}`, { headers: { "Accept-Encoding": "br" } });
    expect(chunk.status()).toBe(200);
    expect(chunk.headers()["content-encoding"]).toBe("br");
    expect(chunk.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  }
});

test("keeps SEB config and proof endpoints defensive without seeded assessment data", async ({ request }) => {
  const requirement = await request.get("/api/seb/requirement/course-1/23455", {
    headers: { Origin: "https://canvas.example.test" }
  });
  expect(requirement.status()).toBe(200);
  expect(requirement.headers()["cache-control"]).toBe("private, no-store, max-age=0");
  expect(requirement.headers()["access-control-allow-origin"]).toBe("https://canvas.example.test");
  await expect(requirement.json()).resolves.toEqual({ success: true, sebRequired: false });

  const config = await request.get("/seb/config/course-1/classicquiz_23455.seb");
  expect(config.status()).toBe(403);
  const configError = await config.text();
  expect(configError).toContain("Invalid or expired configuration grant");
  expect(configError).not.toContain("access code");

  const proof = await request.post("/api/seb/access-proof/course-1/23455", {
    data: {
      configKeyHash: "a".repeat(64),
      url: "https://canvas.example.edu/courses/course-1/quizzes/23455/take"
    }
  });
  expect(proof.status()).toBe(404);
  await expect(proof.json()).resolves.toMatchObject({
    success: false,
    message: "No Safe Online Exam setting found for this quiz"
  });

  const accessCode = await request.get("/api/seb/access-code/course-1/23455");
  expect(accessCode.status()).toBe(405);
  await expect(accessCode.json()).resolves.toMatchObject({
    success: false,
    message: "Use POST to redeem a Safe Online Exam access proof"
  });

  const forgedRedemption = await request.post("/api/seb/access-code/course-1/23455", {
    headers: { "x-seb-proof-token": "x".repeat(43) }
  });
  expect(forgedRedemption.status()).toBe(404);
  await expect(forgedRedemption.json()).resolves.toMatchObject({
    success: false,
    message: "No Safe Online Exam setting found for this quiz"
  });
});

test("serves a Canvas launch fallback at /login", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Launch from Canvas" })).toBeVisible();
  await expect(page.getByText("configured LTI link")).toBeVisible();
});

test("serves the public, role-separated Canvas setup center", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/setup");

  await expect(page.getByRole("heading", { name: "Safe Online Exam setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Canvas administrator" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Instructor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Student" })).toBeVisible();
  await expect(page.getByText("url:GET|/api/v1/login/session_token")).toBeVisible();
  await expect(page.getByRole("link", { name: "Detailed guide" })).toHaveAttribute("href", "/setup/guide");

  await page.getByRole("link", { name: "Detailed guide" }).click();
  await expect(page.getByRole("heading", { name: "Detailed rollout order" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
