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

describe("Canvas SEB detector script", () => {
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
        <main>
          <h1 id="quiz_title">Midterm Quiz</h1>
          <form id="access_code_form">
            <label>Access Code <input name="access_code" type="password" /></label>
          </form>
        </main>
      `
    });

    await context.runDetector();

    expect(context.document.body.textContent).toContain("Safe Exam Browser Required");
    const openSebLink = context.document.querySelector<HTMLAnchorElement>('a[href^="sebs://"]');

    expect(openSebLink?.href).toContain("sebs://tool.example.edu/seb/config/11825/23455.seb");
    expect(context.document.querySelector('a[href^="https://tool.example.edu/seb/config"]')).toBeNull();
    expect(decodeURIComponent(openSebLink?.href || "")).toContain(
      "canvas_url=https://canvas.example.edu/courses/11825/quizzes/23455/take?user_id=7288"
    );
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

    expect(context.document.body.textContent).toContain("Safe Exam Browser Required");
    expect(context.console.log).not.toHaveBeenCalledWith(
      "Canvas SEB Detector:",
      "Quiz completion handler active for Course 11825, Quiz 23455"
    );
  });

  it("uses New Quiz assignment IDs when rendering the SEB launch prompt", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/assignments/991/take",
      body: `
        <main>
          <h1>New Quiz</h1>
          <form id="access_code_form">
            <input name="access_code" type="password" />
          </form>
        </main>
      `
    });

    await context.runDetector();

    expect(context.document.body.textContent).toContain("Safe Exam Browser Required");
    const openSebLink = context.document.querySelector<HTMLAnchorElement>('a[href^="sebs://"]');
    expect(openSebLink?.href).toContain("sebs://tool.example.edu/seb/config/11825/newquiz%3A11825%3A991.seb");
  });

  it("proves SEB config key, retrieves the one-time access code, fills it, and submits the access-code form", async () => {
    const submitSpy = vi.fn((event: Event) => event.preventDefault());
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?user_id=7288",
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
        "/api/seb/access-code/11825/23455": { success: true, accessCode: "sensitive-code-123" },
        "/api/seb/tools/11825/23455": { success: true, tools: [] }
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
    context.document.querySelector("form")?.addEventListener("submit", submitSpy);

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(2_600);

    const field = context.document.querySelector<HTMLInputElement>('input[name="access_code"]');
    expect(field?.value).toBe("sensitive-code-123");
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(context.fetch).toHaveBeenCalledWith(
      `${APP_BASE_URL}/api/seb/access-proof/11825/23455`,
      expect.objectContaining({ method: "POST" })
    );
    expect(context.fetch).toHaveBeenCalledWith(
      `${APP_BASE_URL}/api/seb/access-code/11825/23455`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-SEB-Proof-Token": "proof-1" })
      })
    );
    const logOutput = JSON.stringify(context.console.log.mock.calls);
    expect(logOutput).not.toContain("sensitive");
    expect(logOutput).not.toContain("sen***");
    expect(logOutput).not.toContain("user_id=7288");
    expect(logOutput).toContain("user_id=%5Bredacted%5D");
  });

  it("shows a stale or modified SEB configuration message when proof is rejected", async () => {
    const message =
      "This SEB configuration could not be verified. It may be stale, incorrect, or modified. Reopen the quiz from Canvas using the Safe Exam Browser link.";
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
        },
        "/api/seb/tools/11825/23455": { success: true, tools: [] }
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

  it("redirects to the SEB exit page after a verified final submit and completion indicator", async () => {
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

    context.document.querySelector<HTMLButtonElement>("#submit_quiz_button")?.click();
    context.document.body.appendChild(context.document.createTextNode("Your quiz has been submitted"));
    await vi.advanceTimersByTimeAsync(900);

    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
  });

  it("redirects after a verified final submit when Classic Quiz remains on the take page", async () => {
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

    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
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

  it("redirects after Classic Quiz final submit when Canvas navigates to quiz history", async () => {
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
    context.document.body.appendChild(context.document.createTextNode("Attempt History"));
    await vi.advanceTimersByTimeAsync(900);

    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
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

  it("redirects from a Classic Quiz post-submit page in SEB even if no pending flag was recorded", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/history?version=1",
      userAgent: "Mozilla/5.0 SafeExamBrowser",
      safeExamBrowser: { security: { configKey: DETECTOR_CONFIG_KEY } },
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1><p>Attempt History</p></main>`
    });

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(900);

    expect(context.location.assign).toHaveBeenCalledWith(`${APP_BASE_URL}/seb/exit/11825/23455`);
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

  it("redirects after pending final submit when Canvas lands on the Classic Quiz detail page", async () => {
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
    context.location.href = `${CANVAS_BASE_URL}/courses/11825/quizzes/23455`;
    context.location.pathname = "/courses/11825/quizzes/23455";
    context.document.body.appendChild(context.document.createTextNode("Quiz Results"));
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
    const toolWindow = { closed: false, focus: vi.fn(), opener: {} };
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?debug=true",
      debugResponse: { enabled: true },
      fetchResponses: {
        "/api/seb/tools/11825/23455": {
          success: true,
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
          <form id="quiz_form"><button type="submit">Submit Quiz</button></form>
        </main>
      `
    });

    await context.runDetector();
    await vi.runOnlyPendingTimersAsync();

    const buttons = [...context.document.querySelectorAll<HTMLButtonElement>(".seb-tool-button")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Calculator");
    expect(context.document.body.textContent).not.toContain("Bad Tool");

    buttons[0].click();
    buttons[0].click();

    expect(context.openWindow).toHaveBeenCalledTimes(1);
    expect(context.openWindow).toHaveBeenCalledWith(
      "https://calc.example.edu",
      expect.stringMatching(/^seb_exam_tool_/u)
    );
    expect(toolWindow.focus).toHaveBeenCalled();
  });

  it("enables debug logging from injected app debug mode and URL override parameters", async () => {
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

    expect(endpointContext.console.log).toHaveBeenCalledWith(
      "Canvas SEB Detector:",
      "Canvas SEB Detector Script Loaded!"
    );
    expect(urlContext.console.log).toHaveBeenCalledWith("Canvas SEB Detector:", "Canvas SEB Detector Script Loaded!");
  });

  it("sends sanitized server-side detector traces when debug mode is enabled", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?user_id=7288&debug=true",
      debugResponse: { enabled: true },
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

    await context.runDetector();
    await vi.advanceTimersByTimeAsync(700);

    const traceCalls = context.fetch.mock.calls.filter(([input]) =>
      String(input).endsWith("/api/debug/canvas-detector-trace")
    );
    expect(traceCalls.length).toBeGreaterThan(0);
    const renderedPayloads = JSON.stringify(traceCalls.map(([, init]) => JSON.parse(String(init?.body))));
    expect(renderedPayloads).toContain("canvas-seb-detector");
    expect(renderedPayloads).not.toContain("user_id=7288");
    expect(renderedPayloads).not.toContain("already-accepted");
    expect(renderedPayloads).toContain("user_id=%5Bredacted%5D");
  });

  it("keeps debug logs quiet when server debug mode is disabled", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take",
      debugResponse: { enabled: false },
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1></main>`
    });

    await context.runDetector();

    expect(context.console.log).not.toHaveBeenCalledWith("Canvas SEB Detector:", "Canvas SEB Detector Script Loaded!");
  });

  it("does not allow URL parameters to force debug logs when server debug mode is disabled", async () => {
    const context = createDetectorContext({
      path: "/courses/11825/quizzes/23455/take?seb_debug=1",
      debugResponse: { enabled: false },
      body: `<main><h1 id="quiz_title">Midterm Quiz</h1></main>`
    });

    await context.runDetector();

    expect(context.console.log).not.toHaveBeenCalledWith("Canvas SEB Detector:", "Canvas SEB Detector Script Loaded!");
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
  const windowObject: Record<string, unknown> = {
    document: dom.window.document,
    location,
    navigator: { userAgent: options.userAgent || "Mozilla/5.0 Safari/605.1.15" },
    SafeExamBrowser: options.safeExamBrowser,
    SEB: undefined,
    open: openWindow,
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
  const { __status, ...payload } = body;
  const status = typeof __status === "number" ? __status : 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
