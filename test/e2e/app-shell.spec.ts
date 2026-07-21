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
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/javascript");
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
  await page.route("**/api/admin/summary", async (route) => {
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
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, courses: [{ ...adminCourse, assessments: undefined }], nextCursor: null })
    });
  });
  await page.route("**/api/admin/courses/101", async (route) => {
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
  await page.route("**/api/admin/terms", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        terms: [{ id: "22", name: "Fall 2026", startAt: "2026-07-01", endAt: "2026-12-31" }]
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

  await page.goto("/admin-preview");

  await expect(page.getByRole("heading", { name: "Safe Online Exam Admin" })).toBeVisible();
  const coursesTab = page.getByRole("tab", { name: /Courses/u });
  await expect(coursesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Biology" })).toBeVisible();
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
  await expect(inactiveAssessment.getByRole("button", { name: "Enable SEB" })).toBeVisible();
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
  expect(browserErrors).toEqual([]);
});

test("serves built app assets before API CORS restrictions", async ({ request }) => {
  const response = await request.get("/assets/index.js", {
    headers: {
      Origin: "https://alternate-cloud-run-host.example"
    }
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/javascript");
  expect(await response.text()).toContain("createRoot");
});

test("keeps SEB config and proof endpoints defensive without seeded assessment data", async ({ request }) => {
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
