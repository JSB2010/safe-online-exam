import { expect, test } from "@playwright/test";

test("automatically navigates the SEB exit page to the quit endpoint without browser errors", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/seb/exit/course-1/classicquiz_quiz-1");

  await expect(page).toHaveURL(/\/seb\/exit\/quit\/course-1\/quiz-1$/u);
  await expect(page.getByRole("heading", { name: "Safe Exam Browser Closing" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Retry quit" })).toHaveAttribute(
    "href",
    /\/seb\/exit\/quit\/course-1\/quiz-1$/
  );
  expect(browserErrors).toEqual([]);
});

test("serves the detector script from both compatibility paths", async ({ request }) => {
  for (const path of ["/js/canvas-seb-detector.js", "/api/seb/canvas-detector.js"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/javascript");
    expect(await response.text()).toContain("Canvas SEB Detector");
  }
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
    title: "Safe Exam Browser Canvas Integration",
    oidc_initiation_url: "http://localhost:8080/lti/login",
    target_link_uri: "http://localhost:8080/lti/launch",
    public_jwk_url: "http://localhost:8080/.well-known/jwks.json"
  });
  expect(ltiBody.extensions?.[0]?.settings?.placements?.[0]).toMatchObject({
    placement: "course_navigation",
    message_type: "LtiResourceLinkRequest",
    target_link_uri: "http://localhost:8080/lti/launch",
    visibility: "admins"
  });
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
  const config = await request.get("/seb/config/course-1/classicquiz_quiz-1.seb");
  expect(config.status()).toBe(400);
  expect(await config.text()).toContain("SEB not enabled or access code missing");

  const proof = await request.post("/api/seb/access-proof/course-1/quiz-1", {
    data: {
      configKeyHash: "a".repeat(64),
      url: "https://canvas.example.edu/courses/course-1/quizzes/quiz-1/take"
    }
  });
  expect(proof.status()).toBe(404);
  await expect(proof.json()).resolves.toMatchObject({
    success: false,
    message: "No SEB setting found for this quiz"
  });

  const accessCode = await request.get("/api/seb/access-code/course-1/quiz-1");
  expect(accessCode.status()).toBe(403);
  await expect(accessCode.json()).resolves.toMatchObject({
    success: false,
    message: "Invalid or expired SEB access proof"
  });
});

test("serves a Canvas launch fallback at /login", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Launch from Canvas" })).toBeVisible();
  await expect(page.getByText("configured LTI link")).toBeVisible();
});
