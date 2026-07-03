# SEB–Canvas LTI: Issues & Fixes

Status report and remediation plan for the Safe Exam Browser ↔ Canvas LTI 1.3 integration.
Written 2026-07-01. Ranked most-critical first.

> **Bottom line:** The architecture is correct and about as close to Respondus as a third
> party can get without an Instructure-side plugin partnership. No overhaul is needed. The
> work left is (a) hardening the security model so it *actually* enforces, (b) reacting to
> Canvas New Quizzes Native Integration (live as of today), and (c) productizing for
> multi-tenant distribution.

---

## Context: what "Respondus parity" can and cannot mean

Respondus LockDown Browser is **not a pure LTI tool**. Its Canvas integration has two halves:

1. **A Canvas-native plugin** that Instructure enables per-institution. Canvas core contains
   Respondus-specific hooks: the `require_lockdown_browser` field, `Canvas::LockdownBrowser.plugin`,
   and the `Canvas.assignment.lockdownEnabled` LTI variable. This is what makes a quiz refuse to
   load in a normal browser *server-side*.
2. **An LTI dashboard + custom-protocol launch** (`ldb1:` URLs) for the teacher UI and one-click
   student launch.

**We cannot replicate half #1** — there is no public API that grants it, and setting
`require_lockdown_browser` ourselves would hand students to Respondus's enforcement, not ours
(see [`NEW_QUIZZES_SUPPORT.md`](NEW_QUIZZES_SUPPORT.md)).

**The replicable equivalent** — which this project already implements — is the same pattern
Proctorio uses: lock the quiz with a secret **access code**, reveal that code *only inside SEB*,
and control the launch route. The security of the whole system therefore rests entirely on the
access code staying secret. Several issues below are variations of "the access code is not
actually secret."

---

## 🔴 Critical

### C1. The quiz access code is effectively public (breaks the entire security model)

**What:** The access code is the only real server-side gate (SEB User-Agent detection is trivially
spoofable). But the code can be extracted by any student from a normal browser:

1. `GET /api/seb/canvas-detector.js` is **unauthenticated** and returns the script with the API
   key already substituted in (`SebApiController.getCanvasDetectorScript`,
   [`SebApiController.java:174`](src/main/java/org/kentdenver/sebcanvas/controller/SebApiController.java)).
2. `GET /api/seb/access-code/{courseId}/{quizId}` requires only that API key plus a User-Agent
   containing `"SEB"` (`ApiSecurityService.validateSebApiRequest`,
   [`ApiSecurityService.java:33`](src/main/java/org/kentdenver/sebcanvas/service/ApiSecurityService.java)).

**Attack:** From Chrome — fetch the script, read the key out of the JS, replay the request with a
spoofed `User-Agent: ...SEB/3.7...` header, receive the access code, take the exam in a normal
browser. Rate limiting does not help.

**Why it matters:** This defeats the one mechanism that actually enforces SEB. Everything else is
UX.

**Solution:** Stop trusting the User-Agent and a shared static key. Gate the access code on
**cryptographic proof that the request comes from our exact, unmodified SEB config** — i.e. the
SEB Config Key (see C2). Concretely:

- Serve a launch/interstitial page *inside SEB* that reads `window.SafeExamBrowser.security.configKey`
  (already URL-hashed by SEB) via the SEB JavaScript API.
- POST that value to the server; validate `SHA256(requestURL + storedConfigKey)` against it.
- Only on success, mint a **short-lived, single-use token** (or set a session flag) that the
  access-code endpoint requires. No valid Config Key proof → no access code, ever.
- As defense-in-depth, scope the access-code response to the authenticated LTI session (we already
  store `launchData` / `canvas_user_id` in session) so a raw replay without a live launch fails.

This single change closes the hole in C1 and gives us the real enforcement described in C2.

---

### C2. Browser Exam Key / Config Key are implemented against the wrong model (validate nothing)

**What:** Per the [official SEB Config Key spec](https://safeexambrowser.org/developer/seb-config-key.html):

- The **Config Key is computed by the SEB client from the config file's own contents**
  (ordered-JSON serialization of the plist → SHA256). The server cannot invent a value and place
  it in the plist. Today `SebConfigurationService.generateConfigKey`
  ([`SebConfigurationService.java:527`](src/main/java/org/kentdenver/sebcanvas/service/SebConfigurationService.java))
  writes a `configKey` string derived from `System.currentTimeMillis()`, which SEB treats as an
  unknown key and ignores.
- The HTTP values are **hashes, not raw keys**: `X-SafeExamBrowser-ConfigKeyHash` =
  `SHA256(requestURL + configKey)`. `SebDetector.validateConfigKeyHash`
  ([`SebDetector.java:230`](src/main/java/org/kentdenver/sebcanvas/util/SebDetector.java)) does this
  correctly — but the code paths that actually run compare **raw stored strings** to the header
  (`SebEnforcementController.detectSebBrowser`
  [`SebEnforcementController.java:152`](src/main/java/org/kentdenver/sebcanvas/controller/SebEnforcementController.java),
  and `SebDetector.validateBrowserExamKey`), so they can never match.
- Because the generated keys embed a timestamp, **every download produces a different key**, so
  nothing persisted could validate later anyway.
- `sendBrowserExamKey=false` is set and the detector explicitly accepts requests when the header is
  absent ([`SebDetector.java:182`](src/main/java/org/kentdenver/sebcanvas/util/SebDetector.java)), so
  BEK validation is a **no-op** — everything falls through to User-Agent matching.
- Modern SEB uses WKWebView (we force `browserWindowWebView=3`) which **does not send these
  headers** — it exposes `SafeExamBrowser.security.configKey` / `.browserExamKey` via the
  **JavaScript API**. (This is the root of the "Fixed classic webview issue" commit.)

**Why it matters:** Without a real Config Key check, anyone can craft their own permissive `.seb`
file pointed at the same quiz and satisfy every check we perform.

**Solution:**
1. Generate a **deterministic** config per quiz (no timestamps, stable key ordering).
2. Compute the Config Key **server-side per spec**: strip `originatorVersion`, serialize the plist
   to ordered JSON (alphabetical keys at every level, no whitespace, UTF-8, `<data>`→Base64,
   `<date>`→ISO-8601, correct number formatting), `SHA256` → Base16. Use a known reference
   implementation rather than hand-rolling; validate output against the SEB Config Tool for one
   sample file.
3. Persist the Config Key with the quiz's SEB setting.
4. Validate via the **SEB JavaScript API** on our in-SEB launch page (preferred for WKWebView), and
   accept the `X-SafeExamBrowser-ConfigKeyHash` header as a fallback for classic WebView clients.
   In both cases compare against `SHA256(url + storedConfigKey)`.
5. Wire this into C1 as the gate for releasing the access code.

*(Browser Exam Key is optional on top of Config Key; if used, it requires `examKeySalt` and the
same URL-hashing scheme. Config Key alone is sufficient for enforcement — do it first.)*

---

### C3. New Quizzes Native Integration is live and likely breaks New Quizzes handling

**What:** Instructure's [New Quizzes Native Integration](https://community.instructure.com/en/discussion/665555/new-quizzes-native-integration-in-canvas-q1-2026)
(GA 2026-03-26) moves New Quizzes **out of the LTI iframe** to render natively in the Canvas page.
**Enabled by default 2026-07-01 (today); enforced 2026-08-15.** Affected code:

- Theme-JS New Quizzes heuristics — DOM selectors, `window.ENV` fields, and post-submit text
  matching in [`canvas-seb-detector.js`](src/main/resources/static/js/canvas-seb-detector.js) —
  were written against the iframe UI.
- The `.seb` URL-filter allowlist hardcodes `quiz-lti-*.instructure.com` domains
  ([`SebConfigurationService.java:285`](src/main/java/org/kentdenver/sebcanvas/service/SebConfigurationService.java));
  native rendering may change which domains are actually hit.
- New Quiz launch resolution relies on `canvasLaunchUrl`
  ([`SebLtiLaunchController.java:283`](src/main/java/org/kentdenver/sebcanvas/controller/SebLtiLaunchController.java)),
  which may change shape.

**Why it matters:** This is the most time-sensitive item — behavior may already be changing in
production, with hard enforcement in ~6 weeks.

**Solution:**
- Retest the entire New Quizzes path end-to-end against a course with native integration enabled
  **now**.
- Re-derive selectors/URL patterns from the native DOM; add resilient fallbacks.
- Re-verify the allowlist domains against actual network traffic under native rendering.
- Upside: native rendering shares the Canvas page origin, so detection and URL filtering may get
  *simpler* (closer to Classic Quizzes). Fold both quiz types toward one code path where possible.

---

## 🟠 High

### H1. Not multi-tenant — "any school installs it, zero config" is not yet wired

**What:** The tool is hardwired to one Canvas instance and one deployment:

- `https://kentdenver.instructure.com` hardcoded as a fallback in
  [`CanvasApiService.java:878`](src/main/java/org/kentdenver/sebcanvas/service/CanvasApiService.java)
  and [`SebEnforcementController.java:199`](src/main/java/org/kentdenver/sebcanvas/controller/SebEnforcementController.java).
- The detector JS hardcodes the dev Cloud Run URL
  ([`canvas-seb-detector.js:15`](src/main/resources/static/js/canvas-seb-detector.js)).
- Canvas domain / base URL come from single injected env vars, not per-launch context.

**Why it matters:** This is the biggest gap versus the stated product vision (install once, works
for any Canvas with no extra config). It's a product blocker, not a security one.

**Solution:**
- Resolve tenant identity from the LTI launch: key configuration off `iss` + `deployment_id` +
  `client_id`, stored in a `tenants` collection (issuer, Canvas domain, API base URL, client id,
  private key ref, OAuth redirect).
- Derive the Canvas domain in `SebConfigurationService` from launch/tenant context, not from a
  global property; remove all hardcoded instance URLs.
- Serve the detector JS with the tool's own base URL injected server-side (it already templates
  `${SEB_API_KEY}` — inject the origin the same way) so no per-school JS edit is needed.
- Support a multi-tenant OAuth developer-key onboarding flow (or LTI Dynamic Registration) so a
  school admin can self-install.

### H2. Password-protected `.seb` cryptography is fake and must not ship

**What:** In [`SebConfigGenerator`](src/main/java/org/kentdenver/sebcanvas/util/SebConfigGenerator.java):

- `encryptAES` returns the plaintext unchanged ([line 382](src/main/java/org/kentdenver/sebcanvas/util/SebConfigGenerator.java)).
- `derivePBKDF2Key` does a single SHA-256, not PBKDF2 ([line 365](src/main/java/org/kentdenver/sebcanvas/util/SebConfigGenerator.java)).
- `generateRandomBytes` uses `Math.random()` ([line 348](src/main/java/org/kentdenver/sebcanvas/util/SebConfigGenerator.java)).

**Why it matters:** Currently only the plain (`plnd`) path is used, so this isn't live — but if it
ever ships it produces `.seb` files that are unencrypted-but-labeled-encrypted, and `Math.random()`
for salts/IVs is a security bug anywhere it's used.

**Solution:** Either implement the real SEB format (RNCryptor: AES-256-CBC, PBKDF2-HMAC-SHA256,
proper HMAC, `SecureRandom` salts/IV) and verify a produced file opens in SEB, **or delete the
password-protected path entirely** until it's needed. Replace all `Math.random()` crypto use with
`java.security.SecureRandom`.

### H3. Enforcement silently depends on account-wide Canvas theme JS

**What:** The redirect-to-SEB and access-code auto-fill only work if the school pastes
[`canvas-seb-detector.js`](src/main/resources/static/js/canvas-seb-detector.js) into their Canvas
**global/account theme JS** (admin-only, account-wide).

**Why it matters:** Contradicts "no extra configuration," and if the script doesn't run on a given
page load, the module-link route + access code are the only gates.

**Solution:**
- Treat theme JS as **UX enhancement only**, never as an enforcement layer. The access code (C1/C2)
  must remain the real gate.
- Document the theme-JS install as an optional "smoother experience" step.
- Prefer routing students through our own LTI launch page (which we fully control) over relying on
  injected JS running on Canvas-owned pages.

---

## 🟡 Medium

### M1. Duplicate, divergent implementations cause the bugs above to survive

**What:** Multiple overlapping implementations of the same responsibilities:

- **Two config generators:** `SebConfigGenerator` (string-built plist, `plnd` prefix + GZIP) and
  `SebConfigurationService` (DOM-built plist, uncompressed).
- **Multiple `.seb` download endpoints:** two in `SebEnforcementController` alone
  (`/seb/config/{courseId}/{quizId}` and `/seb/config/{courseId}/{quizId}.seb`), plus more in
  `QuizController` (`/{courseId}/{quizId}/seb/config`).
- **Two SEB-detection paths:** `SebDetector` vs. the private `detectSebBrowser` in
  `SebEnforcementController`, with different logic.

**Why it matters:** Behavior depends on which path executes, which is exactly why the BEK/Config Key
mismatch (C2) went unnoticed.

**Solution:** Consolidate to **one** config service and **one** detector. Delete the dead
generator and redundant endpoints. Route all detection through `SebDetector`. Do this before/while
fixing C2 so there's a single correct place to fix.

### M2. `.seb` config-key filter allowlist is broad and fragile

**What:** [`SebConfigurationService`](src/main/java/org/kentdenver/sebcanvas/service/SebConfigurationService.java)
allowlists very broad patterns — `https://*.amazonaws.com/*`, `https://*.googleapis.com/*`,
`https://cdnjs.cloudflare.com/*`, analytics domains, etc.

**Why it matters:** Overly broad allowances (whole `amazonaws.com`, analytics/tag-manager) widen
the exam's escape surface — a student could reach non-Canvas content hosted on shared CDNs.
Conversely, per-school IdP domains that *aren't* listed will leave students stuck at a blank login.

**Solution:** Narrow AWS/CDN rules to specific Canvas buckets/hosts where feasible; drop analytics
domains. Make SSO domains **per-tenant configurable** (Google/Microsoft/Okta/Shibboleth vary by
school) rather than a fixed superset. Validate the final allowlist against real traffic captured in
SEB.

### M3. LTI launch on `/seb/launch/{contentId}` accepts requests with no `id_token`

**What:** `SebLtiLaunchController.handleLtiLaunch`
([`SebLtiLaunchController.java:65`](src/main/java/org/kentdenver/sebcanvas/controller/SebLtiLaunchController.java))
proceeds when `id_token` is null by falling back to session data, and the GET handler always passes
`null`.

**Why it matters:** Weakens the guarantee that a launch is a genuine, current Canvas LTI launch;
combined with C1 it broadens replay options.

**Solution:** Require a validated LTI launch (fresh `id_token` or a verified session established by
one) before serving protected content or the download page. Reject unauthenticated launches rather
than degrading to "trust the session."

### M4. `.seb` double-click UX is clunky vs. Respondus's one-click launch

**What:** Students download a `.seb` file and double-click it
([`sebDownload.html`](src/main/resources/templates/sebDownload.html)). Respondus uses a custom
protocol handler (`ldb1:`) for a one-click handoff.

**Why it matters:** The "native feel" you're benchmarking against comes largely from that one-click
launch.

**Solution:** Use the SEB [`sebs://` URL scheme](https://safeexambrowser.org/developer/seb-integration.html)
— a link like `sebs://<host>/seb/config/<...>.seb` makes a click launch SEB directly into the exam
(cross-platform). Keep the file download as a fallback.

### M5. LTI 1.3 replay protections need an audit

**What:** `LtiService` validates issuer, audience, and deployment id, and supports nonce validation,
but there is a deprecated `validateToken` path without nonce checks
([`LtiService.java:261`](src/main/java/org/kentdenver/sebcanvas/service/LtiService.java)) and it's
worth confirming nonce+state are enforced end-to-end and single-use.

**Why it matters:** Nonce/state reuse enables launch replay/CSRF.

**Solution:** Ensure every production launch path uses the nonce-validating method with a
server-stored, single-use, expiring nonce and state; remove or block the deprecated path. Add a
test that a replayed `id_token`/nonce is rejected.

---

## 🟢 Lower / cleanup

### L1. iOS/iPadOS SEB behaves differently

iOS SEB uses AppConfig/MDM or per-institution setup and won't consume a plain downloaded `.seb`
the same way as desktop. **Solution:** document supported platforms; test iOS separately; consider
SEB Server or MDM guidance for mobile.

### L2. Debug surface and verbose logging

`DebugController` (768 lines) and extensive `log.info` of security-relevant values (IPs, partial
keys, access-code lengths) should be gated to non-prod. **Solution:** ensure `/debug/*` is disabled
unless `DEBUG_MODE=true` and behind auth; drop security-sensitive fields from info-level logs.

### L3. Access-code strength & rotation

Confirm generated access codes are long/random (CSPRNG) and support rotation (toggle off/on →
new code + new config). **Solution:** verify the generator uses `SecureRandom`; expose a
"regenerate" action; consider per-offering rotation.

### L4. Tests don't cover the security-critical paths

Existing tests exist for controllers/services, but the Config Key validation, access-code gating,
and replay scenarios are the ones that matter. **Solution:** add tests for: Config Key hash
match/mismatch, access-code endpoint rejecting non-proofed requests, nonce replay rejection, and a
golden-file test that a generated `.seb` opens in SEB and yields the expected Config Key.

---

## Suggested order of work

1. **C3** — Retest New Quizzes against native integration (live now, enforced Aug 15).
2. **C1 + C2** — Real Config Key validation via the SEB JS API, and gate the access code on it.
   (Do **M1** consolidation as part of this so there's one correct place to fix.)
3. **H2** — Remove or properly implement the fake `.seb` crypto; kill `Math.random()` in crypto.
4. **H1** — Multi-tenant launch/config resolution → the "any school, zero config" goal.
5. **M4** — `sebs://` one-click launch for the native feel.
6. **H3, M2, M3, M5**, then the 🟢 cleanup items.

---

## References

- [Respondus: supported LMS integrations](https://support.respondus.com/hc/en-us/articles/4409595377179-Which-learning-management-systems-does-LockDown-Browser-integrate-with)
- [Enabling LockDown Browser (Instructure plugin request)](https://cteresources.bc.edu/documentation/assignments-and-grades/getting-started-with-lockdown-browser-respondus-monitor/enabling-lockdown-browser/)
- [Respondus + Canvas New Quizzes](https://support.respondus.com/hc/en-us/articles/46832915666587-Resolved-LockDown-Browser-Mac-and-iPad-Failing-to-Launch-with-Canvas-New-Quizzes)
- [Respondus `ldb1:` launch protocol / user agents](https://bbadmin.uark.edu/respondus-ldb-user-agents/)
- [SEB Config Key specification](https://safeexambrowser.org/developer/seb-config-key.html)
- [SEB integration & `seb://` / `sebs://` scheme](https://safeexambrowser.org/developer/seb-integration.html)
- [SEB integration walkthrough (Config Key algorithm in JS)](https://schof.co/integrating-safe-exam-browser/)
- [New Quizzes Native Integration in Canvas — Q1 2026](https://community.instructure.com/en/discussion/665555/new-quizzes-native-integration-in-canvas-q1-2026)
- [Canvas New Quizzes REST API](https://www.canvas.instructure.com/doc/api/new_quizzes.html)
- [Proctorio access-code enforcement pattern](https://onlinehelp.mpc.edu/support/solutions/articles/4000109614-quiz-asks-for-access-code-when-using-proctorio)
- Project notes: [`NEW_QUIZZES_SUPPORT.md`](NEW_QUIZZES_SUPPORT.md), [`Implmentation-Plan.md`](Implmentation-Plan.md)
</content>
</invoke>
