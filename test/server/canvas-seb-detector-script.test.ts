import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import * as plist from "plist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";

const DETECTOR_PATH = join(process.cwd(), "src/server/assets/canvas-seb-detector.js");
const APP_BASE_URL = "https://tool.example.edu";
const CANVAS_BASE_URL = "https://canvas.example.edu";
const DETECTOR_CONFIG_KEY = new SebConfigKeyService().computeConfigKey(
  Buffer.from(plist.build({ startURL: `${CANVAS_BASE_URL}/courses/11825/quizzes/23455/take` }))
);

describe("Safe Online Exam detector script", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the SEB launch prompt for Classic Quiz access-code pages in non-SEB browsers", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?user_id=7288",
      body: `
        <nav><a aria-label="Safe Online Exam" href="/courses/11825/external_tools/44">Safe Online Exam</a></nav>
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="access_code_form">
            <label>Access Code <input name="access_code" type="password" /></label>
          </form>
        </main>
      `
    });

    await context.runDetector();

    expect(context.document.body.textContent).toContain("Safe Online Exam Required");
    const openSebLink = context.document.querySelector<HTMLAnchorElement>("#seb-launch-open-link");

    const directLaunchUrl = new URL(openSebLink!.href);
    expect(directLaunchUrl.origin + directLaunchUrl.pathname).toBe(
      "https://canvas.example.edu/courses/11825/external_tools/44"
    );
    expect(directLaunchUrl.searchParams.get("display")).toBe("borderless");
    expect(directLaunchUrl.searchParams.get("launch_url")).toBe(
      "https://tool.example.edu/seb/launch/classicquiz_23455"
    );
    expect(openSebLink?.textContent).toContain("Open with Safe Online Exam");
    expect(openSebLink?.rel).toContain("noopener");
    expect(context.document.querySelector('a[href^="sebs://"]')).toBeNull();
    expect(context.document.getElementById("seb-launch-countdown-text")).toBeNull();
    expect(context.document.getElementById("seb-launch-countdown-bar")).toBeNull();
    expect(context.document.getElementById("seb-launch-view-page-button")).toBeNull();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(context.location.href).toBe(`${CANVAS_BASE_URL}/courses/11825/quizzes/23455/take?user_id=7288`);

    context.document.querySelector<HTMLButtonElement>("#seb-launch-back-button")?.click();
    expect(context.historyBack).toHaveBeenCalledTimes(1);
  });

  it("keeps the SEB launch prompt active on access-code pages when debug logging is enabled", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?user_id=7288&debug=true",
      debugResponse: { enabled: true },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="access_code_form">
            <label>Access Code <input name="access_code" type="password" /></label>
          </form>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    expect(context.document.body.textContent).toContain("Safe Online Exam Required");
    expect(context.console.log).not.toHaveBeenCalledWith(
      "Safe Online Exam detector:",
      "Quiz completion handler active for Course 11825, Quiz 23455"
    );
  });

  it("lets students dismiss the New Quiz launch prompt to view previous attempts", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/991/taking/31299",
      body: `
        <nav><a aria-label="Safe Online Exam" href="/courses/11825/external_tools/44">Safe Online Exam</a></nav>
        <main>
          <h1>New Quiz</h1>
          <section id="attempt-history">Attempt History: Attempt 1</section>
          <form id="access_code_form">
            <input name="access_code" type="password" />
          </form>
        </main>
      `
    });

    await context.runDetector();

    expect(context.document.body.textContent).toContain("Safe Online Exam Required");
    expect(context.document.body.textContent).toContain("review previous attempts");
    const openSebLink = context.document.querySelector<HTMLAnchorElement>("#seb-launch-open-link");
    const directLaunchUrl = new URL(openSebLink!.href);
    expect(directLaunchUrl.pathname).toBe("/courses/11825/external_tools/44");
    expect(directLaunchUrl.searchParams.get("launch_url")).toBe(
      "https://tool.example.edu/seb/launch/newquiz:11825:991"
    );
    expect(context.document.getElementById("seb-launch-back-button")).toBeNull();

    context.document.querySelector<HTMLButtonElement>("#seb-launch-view-page-button")?.click();

    expect(context.document.getElementById("seb-launch-prompt")).toBeNull();
    expect(context.document.querySelector("#attempt-history")?.textContent).toContain("Attempt 1");

    context.document.querySelector("main")?.appendChild(context.document.createElement("span"));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(400);

    expect(context.document.getElementById("seb-launch-prompt")).toBeNull();
  });

  it("renders the SEB launch prompt when a New Quiz access-code challenge appears after Canvas hydration", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31300",
      debugResponse: { enabled: true },
      body: `
        <main>
          <button type="button">Skip To Quiz Content</button>
        </main>
      `
    });

    await context.runDetector();

    expect(context.document.getElementById("seb-launch-prompt")).toBeNull();
    expect(context.console.log.mock.calls.every((call) => call[0] === "Safe Online Exam detector:")).toBe(true);
    expect(context.console.log.mock.calls.every((call) => ["info", "success", "warn", "error"].includes(call[1]))).toBe(
      true
    );

    context.document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      `
        <section>
          <p>An access code is required to start</p>
          <form>
            <input name="access_code" type="password" />
            <button type="submit">Submit</button>
          </form>
        </section>
      `
    );
    await flushPromises();
    await vi.advanceTimersByTimeAsync(400);

    expect(context.document.body.textContent).toContain("Safe Online Exam Required");
    const openSebLink = context.document.querySelector<HTMLAnchorElement>("#seb-launch-open-link");
    expect(openSebLink?.href).toBe("https://canvas.example.edu/courses/11825");

    context.document.querySelector("main")?.appendChild(context.document.createElement("span"));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(400);

    expect(context.document.querySelectorAll("#seb-launch-prompt")).toHaveLength(1);
  });

  it("proves SEB config key, retrieves the one-time access code, fills it, and submits the access-code form", async () => {
    const submitSpy = vi.fn((event: Event) => event.preventDefault());
    const secretSentinel = "SEB_TEST_SECRET_SENTINEL";
    const context = createDetectorContext({
      path: `/courses/11825/quizzes/23455/take?user_id=7288&answer=${secretSentinel}`,
      debugResponse: { enabled: true },
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: {
        security: {
          configKey: DETECTOR_CONFIG_KEY,
          updateKeys(callback: () => void) {
            callback();
          }
        }
      },
      fetchResponses: {
        "/api/seb/access-proof/11825/23455": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/23455": { success: true, accessCode: secretSentinel, tools: [] }
      },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <p>This quiz is restricted by an access code.</p>
          <form class="access_code_form" action="/courses/11825/quizzes/23455/take" method="post">
            <label for="quiz_access_code">Access Code</label>
            <input id="quiz_access_code" name="access_code" type="password" />
            <button type="submit" disabled>Submit</button>
          </form>
        </main>
      `
    });
    const submitButton = context.document.querySelector<HTMLButtonElement>(
      'form.access_code_form button[type="submit"]'
    );
    context.document.querySelector<HTMLInputElement>("#quiz_access_code")?.addEventListener("input", () => {
      if (submitButton) submitButton.disabled = false;
    });
    context.document.querySelector("form")?.addEventListener("submit", submitSpy);

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(2_600);

    expect(context.fetch).toHaveBeenCalledWith(
      `${APP_BASE_URL}/api/seb/access-proof/11825/23455`,
      expect.objectContaining({ method: "POST", credentials: "omit" })
    );
    expect(context.fetch).toHaveBeenCalledWith(
      `${APP_BASE_URL}/api/seb/access-code/11825/23455`,
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: expect.objectContaining({ "X-SEB-Proof-Token": "proof-1" })
      })
    );
    const field = context.document.querySelector<HTMLInputElement>('input[name="access_code"]');
    expect(field?.value).toBe(secretSentinel);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    const logOutput = JSON.stringify(context.console.log.mock.calls);
    expect(logOutput).not.toContain(secretSentinel);
    expect(logOutput).not.toContain("user_id=7288");
  });

  it("does not fill or submit an official-shaped Classic Quiz form whose action only shares the quiz path prefix", async () => {
    const submitSpy = vi.fn((event: Event) => event.preventDefault());
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/23455": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/23455": { success: true, accessCode: "must-not-be-filled", tools: [] }
      },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <p>This quiz is restricted by an access code.</p>
          <form class="access_code_form" action="/courses/11825/quizzes/23455evil/take">
            <input id="quiz_access_code" name="access_code" type="password" />
            <button type="submit">Submit</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", submitSpy);

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(2_600);
    await flushPromises();

    expect(context.document.querySelector<HTMLInputElement>('input[name="access_code"]')?.value).toBe("");
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("does not fill an official-shaped Classic Quiz form targeting another same-origin quiz subpage", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/23455": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/23455": { success: true, accessCode: "must-not-be-filled", tools: [] }
      },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <p>This quiz is restricted by an access code.</p>
          <form class="access_code_form" action="/courses/11825/quizzes/23455/edit">
            <input id="quiz_access_code" name="access_code" type="password" />
            <button type="submit">Submit</button>
          </form>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(2_600);
    await flushPromises();

    expect(context.document.querySelector<HTMLInputElement>("#quiz_access_code")?.value).toBe("");
  });

  it("shows a stale or modified SEB configuration message when proof is rejected", async () => {
    const message =
      "This Safe Online Exam configuration could not be verified. It may be stale, incorrect, or modified. Reopen the quiz from Canvas using the Safe Online Exam link.";
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?user_id=7288",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: {
        security: {
          configKey: "stale-config-key",
          updateKeys(callback: () => void) {
            callback();
          }
        }
      },
      fetchResponses: {
        "/api/seb/access-proof/11825/23455": {
          __status: 403,
          success: false,
          statusCode: 403,
          error_code: "INVALID_SEB_CONFIG_PROOF",
          message
        }
      },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="access_code_form">
            <input name="access_code" type="password" />
            <button type="submit">Submit</button>
          </form>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();

    expect(context.document.body.textContent).toContain("Something went wrong");
    expect(context.document.body.textContent).toContain(message);
  });

  it("does not treat access-code submit buttons as final quiz submissions", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?debug=true",
      debugResponse: { enabled: true },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="access_code_form">
            <input name="access_code" type="password" />
            <button type="submit">Submit access code</button>
          </form>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    const form = context.document.querySelector<HTMLFormElement>("form");
    const submitEvent = new context.Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    Object.defineProperty(submitEvent, "submitter", {
      configurable: true,
      value: context.document.querySelector<HTMLButtonElement>("button")
    });
    form?.dispatchEvent(submitEvent);

    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();
  });

  it("submits Canvas's form-less New Quiz access-code gate and clicks Begin", async () => {
    const submitSpy = vi.fn();
    const beginSpy = vi.fn();
    let submittedCode = "";
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/newquiz%3A11825%3A437577": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/newquiz%3A11825%3A437577": {
          success: true,
          accessCode: "new-quiz-code",
          exitGrant: "e".repeat(43)
        }
      },
      body: `
        <main>
          <section id="access-code-gate">
            <p>An access code is required to start</p>
            <p>Previous submission complete</p>
            <input id="TextInput___0" type="text" />
            <label><input id="Checkbox___0" type="checkbox" /> Show access code</label>
            <button type="button" data-automation="sdk-submit-access-code-button" disabled>Submit</button>
          </section>
        </main>
      `
    });
    const accessCodeInput = context.document.querySelector<HTMLInputElement>("#TextInput___0");
    const accessCodeSubmit = context.document.querySelector<HTMLButtonElement>(
      '[data-automation="sdk-submit-access-code-button"]'
    );
    accessCodeInput?.addEventListener("input", () => {
      if (accessCodeSubmit) accessCodeSubmit.disabled = false;
    });
    context.document
      .querySelector<HTMLButtonElement>('[data-automation="sdk-submit-access-code-button"]')
      ?.addEventListener("click", () => {
        submittedCode = context.document.querySelector<HTMLInputElement>("#TextInput___0")?.value || "";
        submitSpy();

        const successPanel = context.document.createElement("section");
        successPanel.innerHTML = `
          <p>Access code accepted</p>
          <button type="button" data-automation="sdk-start-resume-button">Begin</button>
        `;
        successPanel
          .querySelector<HTMLButtonElement>('[data-automation="sdk-start-resume-button"]')
          ?.addEventListener("click", beginSpy);
        context.document.querySelector("#access-code-gate")?.replaceWith(successPanel);
      });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_500);
    await flushPromises();

    expect(submittedCode).toBe("new-quiz-code");
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();
    expect(context.document.getElementById("seb-access-code-progress-overlay")).toBeNull();

    await vi.advanceTimersByTimeAsync(4_000);

    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-proof/")).length).toBe(
      1
    );
    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-code/")).length).toBe(
      1
    );
  });

  it("waits for a late-rendered New Quiz access-code gate and accepts Canvas submit-selector changes", async () => {
    const submitSpy = vi.fn();
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/launch",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/newquiz%3A11825%3A437577": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/newquiz%3A11825%3A437577": {
          success: true,
          accessCode: "late-new-quiz-code",
          exitGrant: "e".repeat(43)
        }
      },
      body: `
        <main id="new-quiz-root">
          <h1>New Quiz for SEB</h1>
          <div aria-label="Loading assessment">Loading…</div>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-proof/")).length).toBe(
      1
    );
    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-code/")).length).toBe(
      1
    );
    expect(context.document.getElementById("seb-access-code-progress-overlay")).toBeNull();

    const root = context.document.querySelector<HTMLElement>("#new-quiz-root")!;
    root.innerHTML = `
      <h1>New Quiz for SEB</h1>
      <section id="late-access-code-gate">
        <p>An access code is required to start.</p>
        <input id="late-access-code" />
        <button id="late-access-submit" type="button" disabled>Submit</button>
      </section>
    `;
    const field = context.document.querySelector<HTMLInputElement>("#late-access-code")!;
    const submit = context.document.querySelector<HTMLButtonElement>("#late-access-submit")!;
    field.addEventListener("input", () => {
      submit.disabled = false;
    });
    submit.addEventListener("click", submitSpy);

    await vi.advanceTimersByTimeAsync(3_500);
    await flushPromises();

    expect(field.value).toBe("late-new-quiz-code");
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-proof/")).length).toBe(
      1
    );
    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-code/")).length).toBe(
      1
    );
  });

  it("retries New Quiz priming when the SEB Config Key API becomes ready after page load", async () => {
    const security: { configKey?: string; updateKeys: (callback: () => void) => void } = {
      updateKeys: (callback) => callback()
    };
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/launch",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security },
      fetchResponses: {
        "/api/seb/access-proof/11825/newquiz%3A11825%3A437577": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/newquiz%3A11825%3A437577": {
          success: true,
          accessCode: "new-quiz-code",
          exitGrant: "e".repeat(43)
        }
      },
      body: `<main><h1>New Quiz is loading</h1></main>`
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(context.fetch.mock.calls.some(([input]) => String(input).includes("/api/seb/access-proof/"))).toBe(false);
    expect(context.document.getElementById("seb-access-code-progress-overlay")).toBeNull();

    security.configKey = DETECTOR_CONFIG_KEY;
    await vi.advanceTimersByTimeAsync(5_500);
    await flushPromises();

    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-proof/")).length).toBe(
      1
    );
    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-code/")).length).toBe(
      1
    );
  });

  it("selects only the contextual New Quiz access-code input when the gate shares a container with other text fields", async () => {
    const submitSpy = vi.fn();
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31300",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/newquiz%3A11825%3A437577": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/newquiz%3A11825%3A437577": {
          success: true,
          accessCode: "new-quiz-code",
          exitGrant: "e".repeat(43)
        }
      },
      body: `
        <main>
          <label>Search <input id="course-search" type="text" /></label>
          <div>
            <p>An access code is required to start</p>
            <input id="access-code-entry" type="text" />
            <label><input type="checkbox" /> Show access code</label>
            <button type="button" data-automation="sdk-submit-access-code-button" disabled>Submit</button>
          </div>
        </main>
      `
    });
    const accessCodeInput = context.document.querySelector<HTMLInputElement>("#access-code-entry")!;
    const submit = context.document.querySelector<HTMLButtonElement>(
      '[data-automation="sdk-submit-access-code-button"]'
    )!;
    accessCodeInput.addEventListener("input", () => {
      submit.disabled = false;
    });
    submit.addEventListener("click", submitSpy);

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_500);
    await flushPromises();

    expect(accessCodeInput.value).toBe("new-quiz-code");
    expect(context.document.querySelector<HTMLInputElement>("#course-search")?.value).toBe("");
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses an ambiguous New Quiz gate instead of filling an arbitrary password field", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31300",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/newquiz%3A11825%3A437577": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/newquiz%3A11825%3A437577": {
          success: true,
          accessCode: "must-not-be-filled",
          exitGrant: "e".repeat(43)
        }
      },
      body: `
        <main>
          <p>An access code is required to start</p>
          <input id="unrelated-text" type="text" />
          <input id="unrelated-password" type="password" />
          <button type="button" data-automation="sdk-submit-access-code-button">Submit</button>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(41_000);
    await flushPromises();

    expect(context.document.querySelector<HTMLInputElement>("#unrelated-text")?.value).toBe("");
    expect(context.document.querySelector<HTMLInputElement>("#unrelated-password")?.value).toBe("");
    expect(context.document.body.textContent).toContain("Something went wrong");
    expect(context.document.body.textContent).toContain("Canvas access-code field could not be found");
  });

  it("primes once without showing an error or tools on a New Quiz attempt-history page", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31345",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/newquiz%3A11825%3A437577": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/newquiz%3A11825%3A437577": {
          success: true,
          accessCode: "new-quiz-code",
          exitGrant: "e".repeat(43)
        }
      },
      body: `
        <main>
          <h1>New Quiz for SEB</h1>
          <p>An access code is required to start.</p>
          <section><h2>Attempt History</h2><a href="#">Attempt 1</a></section>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(35_000);

    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-proof/")).length).toBe(
      1
    );
    expect(context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-code/")).length).toBe(
      1
    );
    expect(context.document.getElementById("seb-access-code-progress-overlay")).toBeNull();
    expect(context.document.getElementById("seb-exam-tools-sidebar")).toBeNull();
  });

  it("pauses New Quiz priming after a proof rejection until the student explicitly retries", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31358",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/newquiz%3A11825%3A437577": {
          __status: 403,
          success: false,
          error_code: "INVALID_SEB_CONFIG_PROOF"
        }
      },
      body: `
        <main>
          <h1>New Quiz for SEB</h1>
          <p>An access code is required to start.</p>
          <input id="access-code-entry" type="text" />
          <button type="button" data-automation="sdk-submit-access-code-button">Submit</button>
          <section><h2>Attempt History</h2><a href="#">Attempt 1</a></section>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(8_000);
    await flushPromises();

    const proofCalls = () =>
      context.fetch.mock.calls.filter(([input]) => String(input).includes("/api/seb/access-proof/")).length;
    expect(proofCalls()).toBe(1);
    expect(context.document.body.textContent).toContain("Something went wrong");
    expect(context.document.getElementById("seb-access-code-retry-button")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(8_000);
    expect(proofCalls()).toBe(1);

    context.document.querySelector<HTMLButtonElement>("#seb-access-code-retry-button")?.click();
    await flushPromises();
    expect(proofCalls()).toBe(2);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(proofCalls()).toBe(2);
  });

  it("exits a confirmed New Quiz when Canvas renders results without changing the take URL", async () => {
    const exitGrant = "e".repeat(43);
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <button id="initial-submit" data-automation="sdk-submit-button" type="button">Submit</button>
          <div id="confirm-dialog" data-automation="sdk-confirmation-modal" role="dialog" aria-label="Unanswered Questions!" aria-modal="true" style="display: none">
            <h2>Unanswered Questions!</h2>
            <p>Upon submission you will not be able to change your answers. Are you ready to submit?</p>
            <button id="cancel-submit" data-automation="sdk-confirmation-modal-cancel" type="button">Cancel</button>
            <button id="confirm-submit" data-automation="sdk-confirmation-modal-confirm" type="button">Submit</button>
          </div>
        </main>
      `
    });
    context.sessionStorage.setItem(
      "seb_exam_session_capabilities:11825:newquiz:11825:437577",
      JSON.stringify({ tools: [], exitGrant, ts: Date.now() })
    );

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.document.querySelector<HTMLButtonElement>("#initial-submit")?.click();
    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();

    const dialog = context.document.querySelector<HTMLElement>("#confirm-dialog")!;
    dialog.style.display = "block";
    context.document.querySelector<HTMLButtonElement>("#cancel-submit")?.click();
    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();

    context.document.querySelector<HTMLButtonElement>("#confirm-submit")?.click();
    expect(context.sessionStorage.getItem("seb_pending_redirect")).toContain('"quizId":"newquiz:11825:437577"');
    expect(context.document.getElementById("seb-classic-submission-overlay")?.textContent).toContain(
      "Submitting your quiz"
    );

    await vi.advanceTimersByTimeAsync(4_000);
    expect(context.location.assign).not.toHaveBeenCalled();

    context.document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="region" aria-label="Assessment results page"><h1 data-automation="sdk-result-list-title">Results</h1></div>'
    );
    await vi.advanceTimersByTimeAsync(900);

    expect(context.location.assign).toHaveBeenCalledWith(
      `${APP_BASE_URL}/seb/exit/session/11825/newquiz%3A11825%3A437577/${exitGrant}`
    );
    // The overlay stays in its submitting state through the redirect — there
    // is no separate "redirecting" step for the student to read.
    expect(context.document.getElementById("seb-classic-submission-overlay")?.textContent).toContain(
      "Submitting your quiz"
    );

    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(context.location.assign).toHaveBeenCalledTimes(1);
  });

  it("does not redirect a New Quiz when confirmation is followed by a submission error", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <div role="dialog" aria-modal="true">
            <h2>Confirm Submission</h2>
            <p>Are you ready to submit?</p>
            <button id="confirm-submit" type="button">Submit</button>
          </div>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    context.document.querySelector<HTMLButtonElement>("#confirm-submit")?.click();
    expect(context.document.getElementById("seb-classic-submission-overlay")?.textContent).toContain(
      "Submitting your quiz"
    );
    context.document.body.appendChild(
      context.document.createTextNode("We could not submit your assessment. Please try again.")
    );
    await vi.advanceTimersByTimeAsync(12_500);

    expect(context.location.assign).not.toHaveBeenCalled();
    // With no confirmed completion, the overlay surfaces a recoverable error
    // with a way back to the quiz rather than silently vanishing.
    const overlay = context.document.getElementById("seb-classic-submission-overlay");
    expect(overlay?.textContent).toContain("Submission not confirmed yet");
    const dismiss = context.document.getElementById("seb-submission-dismiss-button");
    expect(dismiss?.textContent).toContain("Return to quiz");
    dismiss?.click();
    expect(context.document.getElementById("seb-classic-submission-overlay")).toBeNull();
  });

  it("does not redirect from ambient New Quiz completion content without a verified final submit", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><h1>New Quiz</h1></main>`
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    context.location.href = `${CANVAS_BASE_URL}/courses/11825/assignments/437577/taking/31299/results`;
    context.location.pathname = "/courses/11825/assignments/437577/taking/31299/results";
    context.document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="region" aria-label="Assessment results page"><h1 data-automation="sdk-result-list-title">Results</h1></div>'
    );
    await vi.advanceTimersByTimeAsync(900);

    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();
    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("clears a pending New Quiz redirect when Canvas opens a different attempt", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <div role="dialog" aria-modal="true">
            <h2>Confirm Submission</h2>
            <p>Are you ready to submit?</p>
            <button id="confirm-submit" type="button">Submit</button>
          </div>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    context.document.querySelector<HTMLButtonElement>("#confirm-submit")?.click();
    context.location.href = `${CANVAS_BASE_URL}/courses/11825/assignments/437577/taking/31300`;
    context.location.pathname = "/courses/11825/assignments/437577/taking/31300";
    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(1_200);

    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();
    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("exits a confirmed New Quiz when Canvas routes to the attempt results page without completion markers", async () => {
    const exitGrant = "f".repeat(43);
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <div role="dialog" aria-modal="true">
            <h2>Confirm Submission</h2>
            <p>Upon submission you will not be able to change your answers. Are you ready to submit?</p>
            <button id="confirm-submit" type="button">Submit</button>
          </div>
        </main>
      `
    });
    context.sessionStorage.setItem(
      "seb_exam_session_capabilities:11825:newquiz:11825:437577",
      JSON.stringify({ tools: [], exitGrant, ts: Date.now() })
    );

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    context.document.querySelector<HTMLButtonElement>("#confirm-submit")?.click();
    expect(context.sessionStorage.getItem("seb_pending_redirect")).toContain('"quizId":"newquiz:11825:437577"');

    context.location.href = `${CANVAS_BASE_URL}/courses/11825/assignments/437577/taking/31299/results`;
    context.location.pathname = "/courses/11825/assignments/437577/taking/31299/results";
    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(context.location.assign).toHaveBeenCalledWith(
      `${APP_BASE_URL}/seb/exit/session/11825/newquiz%3A11825%3A437577/${exitGrant}`
    );
  });

  it("does not exit a confirmed New Quiz from the bare assignment route until completion markers render", async () => {
    const exitGrant = "g".repeat(43);
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <div role="dialog" aria-modal="true">
            <h2>Confirm Submission</h2>
            <p>Are you ready to submit?</p>
            <button id="confirm-submit" type="button">Submit</button>
          </div>
        </main>
      `
    });
    context.sessionStorage.setItem(
      "seb_exam_session_capabilities:11825:newquiz:11825:437577",
      JSON.stringify({ tools: [], exitGrant, ts: Date.now() })
    );

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    context.document.querySelector<HTMLButtonElement>("#confirm-submit")?.click();

    // A route without the attempt's post-take segment is not proof of
    // submission; a failed submit followed by navigation must not exit SEB.
    context.location.href = `${CANVAS_BASE_URL}/courses/11825/assignments/437577`;
    context.location.pathname = "/courses/11825/assignments/437577";
    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(context.location.assign).not.toHaveBeenCalled();

    context.document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="region" aria-label="Assessment results page"><h1 data-automation="sdk-result-list-title">Results</h1></div>'
    );
    await vi.advanceTimersByTimeAsync(2_000);

    expect(context.location.assign).toHaveBeenCalledWith(
      `${APP_BASE_URL}/seb/exit/session/11825/newquiz%3A11825%3A437577/${exitGrant}`
    );
    expect(context.location.assign).toHaveBeenCalledTimes(1);
  });

  it("exits a primed New Quiz exam session when results render even if the confirmation click was missed", async () => {
    const exitGrant = "h".repeat(43);
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><h1>New Quiz</h1></main>`
    });
    context.sessionStorage.setItem(
      "seb_exam_session_capabilities:11825:newquiz:11825:437577",
      JSON.stringify({ tools: [], exitGrant, ts: Date.now() })
    );

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();

    context.document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="region" aria-label="Assessment Results Page"><h1>Results</h1></div>'
    );
    await vi.advanceTimersByTimeAsync(2_000);

    expect(context.location.assign).toHaveBeenCalledWith(
      `${APP_BASE_URL}/seb/exit/session/11825/newquiz%3A11825%3A437577/${exitGrant}`
    );
  });

  it("exits a primed New Quiz exam session when Canvas routes to the attempt results page without any visible click", async () => {
    const exitGrant = "j".repeat(43);
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><h1>New Quiz</h1></main>`
    });
    context.sessionStorage.setItem(
      "seb_exam_session_capabilities:11825:newquiz:11825:437577",
      JSON.stringify({ tools: [], exitGrant, ts: Date.now() })
    );

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();

    context.location.href = `${CANVAS_BASE_URL}/courses/11825/assignments/437577/taking/31299/results`;
    context.location.pathname = "/courses/11825/assignments/437577/taking/31299/results";
    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(context.location.assign).toHaveBeenCalledWith(
      `${APP_BASE_URL}/seb/exit/session/11825/newquiz%3A11825%3A437577/${exitGrant}`
    );
  });

  it("does not exit from the attempt results route without a primed exam session grant", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><h1>New Quiz</h1></main>`
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.location.href = `${CANVAS_BASE_URL}/courses/11825/assignments/437577/taking/31299/results`;
    context.location.pathname = "/courses/11825/assignments/437577/taking/31299/results";
    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("does not exit a primed New Quiz exam session while still on the attempt take route", async () => {
    const exitGrant = "k".repeat(43);
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><h1>New Quiz</h1></main>`
    });
    context.sessionStorage.setItem(
      "seb_exam_session_capabilities:11825:newquiz:11825:437577",
      JSON.stringify({ tools: [], exitGrant, ts: Date.now() })
    );

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(12_500);

    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("does not exit a primed New Quiz exam session from the assignment route alone without a verified submit", async () => {
    const exitGrant = "i".repeat(43);
    const context = createDetectorContext({
      path: "/courses/11825/assignments/437577/taking/31299/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><h1>New Quiz</h1></main>`
    });
    context.sessionStorage.setItem(
      "seb_exam_session_capabilities:11825:newquiz:11825:437577",
      JSON.stringify({ tools: [], exitGrant, ts: Date.now() })
    );

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.location.href = `${CANVAS_BASE_URL}/courses/11825/assignments/437577`;
    context.location.pathname = "/courses/11825/assignments/437577";
    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("redirects a Classic Quiz after verified final submit reaches Canvas's completed-submission page", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?debug=true",
      debugResponse: { enabled: true },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="quiz_form">
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.sessionStorage.setItem(
      "seb_pending_redirect",
      JSON.stringify({
        courseId: "11825",
        quizId: "23455",
        contentType: "CLASSIC_QUIZ",
        attemptId: null,
        ts: Date.now()
      })
    );
    context.document.body.appendChild(context.document.createTextNode("Your quiz has been submitted"));
    await vi.advanceTimersByTimeAsync(900);
    expect(context.location.assign).not.toHaveBeenCalled();

    context.location.href = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455`;
    context.location.pathname = "/courses/11825/quizzes/23455";
    context.document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="quiz-submission"><div class="quiz_score"><span class="score_value">10 / 10</span></div></div>'
    );
    await vi.advanceTimersByTimeAsync(900);

    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
  });

  it("submits the official Classic Quiz form through Canvas and exits only after Canvas returns confirmed results", async () => {
    const canvasSubmitUrl = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455/submissions?user_id=7288`;
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/courses/11825/quizzes/23455/submissions": {
          __url: `${CANVAS_BASE_URL}/courses/11825/quizzes/23455`,
          __text: '<main><div class="quiz-submission"><div class="quiz_score">10 / 10</div></div></main>'
        }
      },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="submit_quiz_form" class="all_questions last_page" method="post" action="${canvasSubmitUrl}">
            <input type="hidden" name="attempt" value="1" />
            <input type="hidden" name="question_42" value="answer" />
            <button id="submit_quiz_button" class="submit_quiz_button quiz_submit" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    const form = context.document.querySelector<HTMLFormElement>("#submit_quiz_form")!;
    const submitEvent = new context.Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    Object.defineProperty(submitEvent, "submitter", {
      configurable: true,
      value: context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")
    });
    const nativeSubmissionAllowed = form.dispatchEvent(submitEvent);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1);

    expect(nativeSubmissionAllowed).toBe(false);
    expect(context.fetch).toHaveBeenCalledWith(
      canvasSubmitUrl,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        redirect: "follow",
        cache: "no-store",
        body: expect.anything()
      })
    );
    expect(context.document.getElementById("seb-classic-submission-overlay")?.textContent).toContain(
      "Submitting your quiz"
    );
    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
  });

  it("submits a confirmed Classic Quiz even when Canvas stops the event before document bubbling", async () => {
    const canvasSubmitUrl = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455/submissions?user_id=7288`;
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/courses/11825/quizzes/23455/submissions": {
          __url: `${CANVAS_BASE_URL}/courses/11825/quizzes/23455`,
          __text: '<main><div class="quiz-submission"><div class="quiz_score">10 / 10</div></div></main>'
        }
      },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="submit_quiz_form" class="all_questions last_page" method="post" action="${canvasSubmitUrl}">
            <input type="hidden" name="attempt" value="1" />
            <input type="hidden" name="question_42" value="answer" />
            <button id="submit_quiz_button" class="submit_quiz_button quiz_submit" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    const form = context.document.querySelector<HTMLFormElement>("#submit_quiz_form")!;
    form.addEventListener("submit", (event) => {
      // Canvas has already accepted its synchronous confirmation here, but a
      // form-level handler keeps the event from reaching document listeners.
      event.stopPropagation();
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    const submitEvent = new context.Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    Object.defineProperty(submitEvent, "submitter", {
      configurable: true,
      value: context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")
    });
    const nativeSubmissionAllowed = form.dispatchEvent(submitEvent);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1);

    expect(nativeSubmissionAllowed).toBe(false);
    expect(context.fetch).toHaveBeenCalledWith(
      canvasSubmitUrl,
      expect.objectContaining({ method: "POST", credentials: "same-origin", redirect: "follow" })
    );
    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
  });

  it("does not exit when Canvas returns the quiz page without a completed-submission structure", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/courses/11825/quizzes/23455/submissions": {
          __url: `${CANVAS_BASE_URL}/courses/11825/quizzes/23455`,
          __text: '<main><div class="ic-flash-error">Submission could not be verified.</div></main>'
        }
      },
      body: `
        <main>
          <form id="submit_quiz_form" class="all_questions last_page" method="post"
            action="/courses/11825/quizzes/23455/submissions">
            <input type="hidden" name="attempt" value="1" />
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    const submitEvent = new context.Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    Object.defineProperty(submitEvent, "submitter", {
      configurable: true,
      value: context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")
    });
    context.document.querySelector<HTMLFormElement>("#submit_quiz_form")?.dispatchEvent(submitEvent);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1);

    expect(context.location.assign).not.toHaveBeenCalled();
    expect(context.document.getElementById("seb-classic-submission-overlay")?.textContent).toContain(
      "We could not confirm your submission"
    );
    expect(context.sessionStorage.removeItem).toHaveBeenCalledWith("seb_pending_redirect");
  });

  it("does not send the Classic Quiz request when Canvas cancels the submit event", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <form id="submit_quiz_form" class="all_questions last_page" method="post"
            action="/courses/11825/quizzes/23455/submissions">
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    const form = context.document.querySelector<HTMLFormElement>("#submit_quiz_form")!;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    const submitEvent = new context.Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    Object.defineProperty(submitEvent, "submitter", {
      configurable: true,
      value: context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")
    });
    form.dispatchEvent(submitEvent);
    await vi.advanceTimersByTimeAsync(1);

    expect(context.fetch.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith("/submissions"))).toBe(
      false
    );
    expect(context.sessionStorage.removeItem).toHaveBeenCalledWith("seb_pending_redirect");
  });

  it("does not directly redirect after a verified final submit while Classic Quiz remains on the take page", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="submit_quiz_form" class="all_questions last_page">
            <button id="submit_quiz_button" class="btn submit_button quiz_submit btn-primary" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")?.click();
    await vi.advanceTimersByTimeAsync(1_200);

    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("does not directly redirect from a final-looking click unless a submit event fires", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <button id="submit_quiz_button" class="btn submit_button quiz_submit btn-primary" type="button">Submit Quiz</button>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")?.click();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("requires a Classic Quiz completion structure on the exact Canvas post-submit page", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="quiz_form">
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.sessionStorage.setItem(
      "seb_pending_redirect",
      JSON.stringify({
        courseId: "11825",
        quizId: "23455",
        contentType: "CLASSIC_QUIZ",
        attemptId: null,
        ts: Date.now()
      })
    );
    context.location.href = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455`;
    context.location.pathname = "/courses/11825/quizzes/23455";
    context.document.body.appendChild(context.document.createTextNode("Quiz submitted"));
    await vi.advanceTimersByTimeAsync(900);
    expect(context.location.assign).not.toHaveBeenCalled();

    context.document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="quiz-submission"><div class="quiz_duration">This attempt took 2 minutes.</div></div>'
    );
    await vi.advanceTimersByTimeAsync(900);

    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
  });

  it("redirects a completed Classic Quiz when Canvas withholds the result behind its muted notice", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="quiz_form">
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    context.sessionStorage.setItem(
      "seb_pending_redirect",
      JSON.stringify({
        courseId: "11825",
        quizId: "23455",
        contentType: "CLASSIC_QUIZ",
        attemptId: null,
        ts: Date.now()
      })
    );

    context.location.href = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455`;
    context.location.pathname = "/courses/11825/quizzes/23455";
    context.document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="muted-notice"><h3>Your quiz has been muted</h3></div>'
    );
    await vi.advanceTimersByTimeAsync(900);

    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
  });

  it("does not accept a Classic completion structure on a non-submit quiz subpage", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="quiz_form">
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);
    context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")?.click();

    context.location.href = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455/history?version=1`;
    context.location.pathname = "/courses/11825/quizzes/23455/history";
    context.document.body.insertAdjacentHTML("beforeend", '<div class="quiz-submission"></div>');
    await vi.advanceTimersByTimeAsync(12_500);

    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("does not mistake hidden access-code inputs in the quiz form for the access-code gate", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="quiz_form">
            <input name="access_code" type="hidden" value="already-accepted" />
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")?.click();

    expect(context.sessionStorage.setItem).toHaveBeenCalledWith(
      "seb_pending_redirect",
      expect.stringContaining('"quizId":"23455"')
    );
  });

  it("does not redirect from a Classic Quiz post-submit page without a verified pending submit", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/history?version=1",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main aria-label="Assessment results page"><h1 data-automation="sdk-result-list-title">Results</h1></main>`
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(900);

    expect(context.sessionStorage.getItem("seb_pending_redirect")).toBeNull();
    expect(context.location.assign).not.toHaveBeenCalled();
  });

  it("captures final submits from quiz forms added after initial completion setup", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1></main>`
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      `
        <form id="quiz_form">
          <button type="submit">Submit</button>
        </form>
      `
    );
    const form = context.document.querySelector<HTMLFormElement>("#quiz_form");
    form?.addEventListener("submit", (event) => event.preventDefault());
    const submitEvent = new context.Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    Object.defineProperty(submitEvent, "submitter", {
      configurable: true,
      value: context.document.querySelector<HTMLButtonElement>("#quiz_form button")
    });
    form?.dispatchEvent(submitEvent);

    expect(context.sessionStorage.setItem).toHaveBeenCalledWith(
      "seb_pending_redirect",
      expect.stringContaining('"quizId":"23455"')
    );
  });

  it("does not treat result-like text as completion after Canvas lands on the Classic Quiz detail page", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="quiz_form">
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.sessionStorage.setItem(
      "seb_pending_redirect",
      JSON.stringify({
        courseId: "11825",
        quizId: "23455",
        contentType: "CLASSIC_QUIZ",
        attemptId: null,
        ts: Date.now()
      })
    );
    context.location.href = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455`;
    context.location.pathname = "/courses/11825/quizzes/23455";
    context.document.body.appendChild(context.document.createTextNode("Quiz Results"));
    await vi.advanceTimersByTimeAsync(900);
    expect(context.location.assign).not.toHaveBeenCalled();

    context.document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="region" aria-label="Assessment results page"><h1 data-automation="sdk-result-list-title">Results</h1></div>'
    );
    await vi.advanceTimersByTimeAsync(900);

    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
  });

  it("does not reopen access-code errors on post-submit pages", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/submissions/777",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><p>Your quiz has been submitted</p></main>`
    });

    await context.runDetector();
    context.document.dispatchEvent(new context.Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(31_000);

    expect(context.document.getElementById("seb-access-code-progress-overlay")).toBeNull();
    expect(context.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/seb/access-code/"), expect.anything());
  });

  it("renders only HTTPS exam tools and reuses the named tool window", async () => {
    const toolWindow = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { replace: vi.fn() },
      opener: {}
    };
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?debug=true",
      debugResponse: { enabled: true },
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/23455": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/23455": {
          success: true,
          accessCode: "ACCESS",
          exitGrant: "e".repeat(43),
          tools: [
            { id: "calc", label: "Calculator", url: "https://calc.example.edu" },
            { id: "bad", label: "Bad Tool", url: "http://bad.example.edu" }
          ]
        }
      },
      openWindow: vi.fn(() => toolWindow),
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="access_code_form"><input name="access_code" type="password" /><button type="submit">Submit</button></form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(context.document.querySelectorAll(".seb-tool-button")).toHaveLength(0);

    context.document.querySelector("#access_code_form")?.remove();
    context.document.querySelector("main")?.appendChild(context.document.createElement("section"));
    await vi.advanceTimersByTimeAsync(400);

    const buttons = [...context.document.querySelectorAll<HTMLButtonElement>(".seb-tool-button")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Calculator");
    expect(context.document.body.textContent).not.toContain("Bad Tool");
    expect(context.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/seb/tools/"), expect.anything());

    const sidebar = context.document.getElementById("seb-exam-tools-sidebar");
    expect(sidebar?.getAttribute("data-seb-tools-placement")).toBeTruthy();
    expect(context.document.querySelector(".seb-tools-drag-handle")?.getAttribute("aria-hidden")).toBe("true");
    expect(sidebar?.textContent).toContain("↺");
    const selectStart = new context.Event("selectstart", { cancelable: true });
    sidebar?.dispatchEvent(selectStart);
    expect(selectStart.defaultPrevented).toBe(true);

    const collapse = context.document.querySelector<HTMLButtonElement>(".seb-tools-icon-button[aria-expanded]");
    expect(collapse?.tagName).toBe("BUTTON");
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");
    collapse?.click();
    expect(context.document.getElementById("seb-exam-tools-sidebar")?.classList.contains("is-collapsed")).toBe(true);
    expect(collapse?.getAttribute("aria-expanded")).toBe("false");
    collapse?.click();
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");

    buttons[0].click();
    buttons[0].click();

    expect(context.openWindow).toHaveBeenCalledTimes(1);
    expect(context.openWindow).toHaveBeenCalledWith(
      "https://calc.example.edu",
      expect.stringMatching(/^seb_exam_tool_/u)
    );
    expect(toolWindow.location.replace).not.toHaveBeenCalled();
    expect(toolWindow.opener).toBeNull();
    expect(toolWindow.focus).toHaveBeenCalled();
  });

  it("reasserts focus only while a newly opened Google Sheet completes its startup navigation", async () => {
    const toolWindow = {
      closed: false,
      focus: vi.fn(),
      opener: {}
    };
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?debug=true",
      debugResponse: { enabled: true },
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/23455": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/23455": {
          success: true,
          accessCode: "ACCESS",
          exitGrant: "e".repeat(43),
          tools: [
            {
              id: "sheet",
              label: "Google Sheet",
              url: "https://docs.google.com/spreadsheets/d/example/edit"
            }
          ]
        }
      },
      openWindow: vi.fn(() => toolWindow),
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1><form id="access_code_form"><input name="access_code" type="password" /><button type="submit">Submit</button></form></main>`
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(1_000);
    context.document.querySelector("#access_code_form")?.remove();
    context.document.querySelector("main")?.appendChild(context.document.createElement("section"));
    await vi.advanceTimersByTimeAsync(400);

    context.document.querySelector<HTMLButtonElement>(".seb-tool-button")?.click();
    expect(toolWindow.focus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_100);
    expect(toolWindow.focus).toHaveBeenCalledTimes(4);
  });

  it("does not schedule delayed focus for non-Sheets tools", async () => {
    const toolWindow = {
      closed: false,
      focus: vi.fn(),
      opener: {}
    };
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?debug=true",
      debugResponse: { enabled: true },
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/23455": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/23455": {
          success: true,
          accessCode: "ACCESS",
          exitGrant: "e".repeat(43),
          tools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu" }]
        }
      },
      openWindow: vi.fn(() => toolWindow),
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1><form id="access_code_form"><input name="access_code" type="password" /><button type="submit">Submit</button></form></main>`
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(1_000);
    context.document.querySelector("#access_code_form")?.remove();
    context.document.querySelector("main")?.appendChild(context.document.createElement("section"));
    await vi.advanceTimersByTimeAsync(400);

    context.document.querySelector<HTMLButtonElement>(".seb-tool-button")?.click();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(toolWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("keeps the direct named window when a browser does not expose opener isolation", async () => {
    const toolWindow = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { replace: vi.fn() }
    } as Record<string, any>;
    Object.defineProperty(toolWindow, "opener", {
      configurable: true,
      get: () => ({ retained: true }),
      set: vi.fn()
    });
    const openWindow = vi.fn().mockReturnValueOnce(toolWindow);
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?debug=true",
      debugResponse: { enabled: true },
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      fetchResponses: {
        "/api/seb/access-proof/11825/23455": { success: true, proofToken: "proof-1" },
        "/api/seb/access-code/11825/23455": {
          success: true,
          accessCode: "ACCESS",
          exitGrant: "e".repeat(43),
          tools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu" }]
        }
      },
      openWindow,
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1><form id="access_code_form"><input name="access_code" type="password" /><button type="submit">Submit</button></form></main>`
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(1_000);
    context.document.querySelector("#access_code_form")?.remove();
    context.document.querySelector("main")?.appendChild(context.document.createElement("section"));
    await vi.advanceTimersByTimeAsync(400);
    context.document.querySelector<HTMLButtonElement>(".seb-tool-button")?.click();

    expect(toolWindow.location.replace).not.toHaveBeenCalled();
    expect(toolWindow.close).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith("https://calc.example.edu", expect.stringMatching(/^seb_exam_tool_/u));
  });

  it("emits only structural console markers when server debug mode is enabled", async () => {
    const endpointContext = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      debugResponse: { enabled: true },
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1></main>`
    });
    await endpointContext.runDetector();

    const urlContext = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?seb_debug=1",
      debugResponse: { enabled: true },
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1></main>`
    });
    await urlContext.runDetector();

    for (const context of [endpointContext, urlContext]) {
      expect(context.console.log).toHaveBeenCalled();
      expect(
        context.console.log.mock.calls.every(
          (call) => call[0] === "Safe Online Exam detector:" && ["info", "success", "warn", "error"].includes(call[1])
        )
      ).toBe(true);
      expect(JSON.stringify(context.console.log.mock.calls)).not.toContain("Safe Online Exam detector loaded!");
    }
  });

  it("sends credentialless structural traces without URL, DOM, or secret content", async () => {
    const secretSentinel = "SEB_TEST_SECRET_SENTINEL";
    const context = createDetectorContext({
      path: `/courses/11825/quizzes/23455/take?user_id=7288&debug=true&answer=${secretSentinel}`,
      debugResponse: { enabled: true },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz ${secretSentinel}</h1>
          <form id="quiz_form">
            <input name="access_code" type="hidden" value="${secretSentinel}" />
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(700);

    const traceCalls = context.fetch.mock.calls.filter(([input]) =>
      String(input).endsWith("/api/debug/canvas-detector-trace")
    );
    expect(traceCalls.length).toBeGreaterThan(0);
    expect(traceCalls.every(([, init]) => init?.credentials === "omit")).toBe(true);
    const payloads = traceCalls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    for (const payload of payloads) {
      expect(Object.keys(payload).sort()).toEqual(["events", "source", "traceId", "version"]);
      for (const event of payload.events as Array<Record<string, unknown>>) {
        expect(Object.keys(event).sort()).toEqual([
          "at",
          "event",
          "hidden",
          "readyState",
          "sebDetected",
          "seq",
          "type"
        ]);
      }
    }
    const renderedPayloads = JSON.stringify(payloads);
    expect(renderedPayloads).toContain("canvas-seb-detector");
    expect(renderedPayloads).not.toContain("user_id=7288");
    expect(renderedPayloads).not.toContain(secretSentinel);
    expect(renderedPayloads).not.toContain("quiz_title");
  });

  it("keeps debug logs quiet when server debug mode is disabled", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      debugResponse: { enabled: false },
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1></main>`
    });

    await context.runDetector();

    expect(context.console.log).not.toHaveBeenCalled();
    expect(context.fetch).not.toHaveBeenCalledWith(
      `${APP_BASE_URL}/api/debug/canvas-detector-trace`,
      expect.anything()
    );
  });

  it("does not allow URL parameters to force debug logs when server debug mode is disabled", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?seb_debug=1",
      debugResponse: { enabled: false },
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1></main>`
    });

    await context.runDetector();

    expect(context.console.log).not.toHaveBeenCalled();
    expect(context.fetch).not.toHaveBeenCalledWith(
      `${APP_BASE_URL}/api/debug/canvas-detector-trace`,
      expect.anything()
    );
  });

  it("does not attach duplicate final-submit handlers after SPA reruns", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?debug=true",
      debugResponse: { enabled: true },
      body: `
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="quiz_form">
            <button id="submit_quiz_button" type="submit">Submit Quiz</button>
          </form>
        </main>
      `
    });
    context.document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(3_100);

    context.location.href = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455/take?debug=true&view=one`;
    context.document.body.appendChild(context.document.createElement("span"));
    await vi.advanceTimersByTimeAsync(4_200);

    const form = context.document.querySelector<HTMLFormElement>("form");
    const submitEvent = new context.Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    Object.defineProperty(submitEvent, "submitter", {
      configurable: true,
      value: context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")
    });
    form?.dispatchEvent(submitEvent);

    expect(context.sessionStorage.setItem).toHaveBeenCalledTimes(1);
  });
});

type FetchResponse = Record<string, unknown>;

interface DetectorContextOptions {
  path: string;
  body: string;
  userAgent?: string;
  debugResponse?: FetchResponse;
  fetchResponses?: Record<string, FetchResponse>;
  safeExamBrowser?: unknown;
  openWindow?: ReturnType<typeof vi.fn>;
}

function createDetectorContext(options: DetectorContextOptions) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${options.body}</body></html>`, {
    url: `${CANVAS_BASE_URL}${options.path}`
  });
  const storage = createStorage();
  const localStorage = createStorage();
  const location = {
    href: `${CANVAS_BASE_URL}${options.path}`,
    origin: CANVAS_BASE_URL,
    pathname: new URL(options.path, CANVAS_BASE_URL).pathname,
    assign: vi.fn((url: string) => {
      location.href = url;
      location.pathname = new URL(url, APP_BASE_URL).pathname;
    })
  };
  const consoleMock = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/debug/canvas-detector-trace") {
      return jsonResponse({ enabled: true });
    }
    const response = options.fetchResponses?.[url.pathname];
    if (response) {
      return jsonResponse(response);
    }
    return jsonResponse({ success: true, tools: [] });
  });
  const openWindow = options.openWindow || vi.fn(() => ({ closed: false, focus: vi.fn(), opener: {} }));
  const historyBack = vi.fn();
  const windowObject: Record<string, unknown> = {
    document: dom.window.document,
    location,
    navigator: { userAgent: options.userAgent || "Mozilla/5.0 Safari/605.1.15" },
    SafeExamBrowser: options.safeExamBrowser,
    SEB: undefined,
    FormData: dom.window.FormData,
    open: openWindow,
    history: { back: historyBack },
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    innerWidth: 1280,
    innerHeight: 900
  };

  Object.defineProperty(dom.window.document, "hidden", {
    configurable: true,
    get: () => false
  });

  return {
    document: dom.window.document,
    fetch,
    console: consoleMock,
    sessionStorage: storage,
    location,
    openWindow,
    historyBack,
    Event: dom.window.Event,
    async runDetector() {
      const debugEnabled = options.debugResponse?.enabled === true || options.debugResponse?.debugEnabled === true;
      const source = readFileSync(DETECTOR_PATH, "utf8")
        .replaceAll('"__SEB_BASE_URL__"', JSON.stringify(APP_BASE_URL))
        .replaceAll('"__SEB_DEBUG_ENABLED__"', JSON.stringify(debugEnabled));
      const execute = new Function(
        "window",
        "document",
        "navigator",
        "location",
        "fetch",
        "sessionStorage",
        "localStorage",
        "setTimeout",
        "clearTimeout",
        "MutationObserver",
        "Node",
        "Event",
        "URL",
        "console",
        "XMLHttpRequest",
        source
      );
      execute(
        windowObject,
        dom.window.document,
        windowObject.navigator,
        location,
        fetch,
        storage,
        localStorage,
        setTimeout,
        clearTimeout,
        dom.window.MutationObserver,
        dom.window.Node,
        dom.window.Event,
        URL,
        consoleMock,
        undefined
      );
      await flushPromises();
    }
  };
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear())
  };
}

function jsonResponse(body: FetchResponse) {
  const { __status, __text, __url, ...payload } = body;
  const status = typeof __status === "number" ? __status : 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    url: typeof __url === "string" ? __url : "",
    async json() {
      return payload;
    },
    async text() {
      return typeof __text === "string" ? __text : JSON.stringify(payload);
    }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
