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

test("serves a Canvas launch fallback at /login", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Launch from Canvas" })).toBeVisible();
  await expect(page.getByText("configured LTI link")).toBeVisible();
});
