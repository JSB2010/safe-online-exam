/**
 * Safe Online Exam browser detection and redirection script
 *
 * Injected by a Canvas theme loader. Keep this file dependency-free because it
 * runs inside Canvas and Safe Exam Browser.
 */
(function () {
    'use strict';

    const SEB_DOWNLOAD_BASE_URL = "__SEB_BASE_URL__";
    const SERVER_DEBUG_ENABLED = "__SEB_DEBUG_ENABLED__";
    const SERVER_DIAGNOSTIC_MODE = "__SEB_DIAGNOSTIC_MODE__";
    // Diagnostic tracing ships event details (sanitized DOM/URL snapshots) to
    // the trace endpoint. The server only honors it on non-production
    // deployments; see APP_DETECTOR_DIAGNOSTICS_ENABLED.
    const DIAGNOSTIC_TRACING = SERVER_DIAGNOSTIC_MODE === true || SERVER_DIAGNOSTIC_MODE === 'true';
    const DETECTOR_VERSION = '4.0 route-verified New Quiz completion';
    const DETECTOR_TRACE_ENDPOINT = `${SEB_DOWNLOAD_BASE_URL}/api/debug/canvas-detector-trace`;
    const SAFE_ONLINE_EXAM_ICON_URL = `${SEB_DOWNLOAD_BASE_URL}/assets/safe-online-exam-icon.png`;
    const DETECTOR_TRACE_BATCH_SIZE = 15;
    const LATE_ACCESS_CODE_CHECK_DELAY_MS = 300;
    const SEB_REQUIREMENT_CACHE_TTL_MS = 30 * 1000;
    const PENDING_REDIRECT_TTL_MS = 10 * 60 * 1000;
    const EXAM_SESSION_CAPABILITY_TTL_MS = 12 * 60 * 60 * 1000;
    const REDIRECT_FLAG_KEY = 'seb_pending_redirect';
    const EXAM_SESSION_CAPABILITY_PREFIX = 'seb_exam_session_capabilities:';
    const SENSITIVE_TRACE_KEY_PATTERN = /(?:access.?code|authorization|config.?key|cookie|encryption.?key|id.?token|password|private.?key|proof(?:.?token)?|secret|token|(?:^|[_-])state(?:$|[_-]))/iu;
    const ACCESS_CODE_PROGRESS_OVERLAY_ID = 'seb-access-code-progress-overlay';
    const ACCESS_CODE_PROGRESS_CARD_ID = 'seb-access-code-progress-card';
    const ACCESS_CODE_PROGRESS_STYLE_ID = 'seb-access-code-progress-style';
    const CLASSIC_SUBMISSION_OVERLAY_ID = 'seb-classic-submission-overlay';
    const SUBMISSION_OVERLAY_STYLE_ID = 'seb-submission-overlay-style';
    const SEB_LAUNCH_PROMPT_ID = 'seb-launch-prompt';
    const EXAM_TOOLS_SIDEBAR_ID = 'seb-exam-tools-sidebar';
    const EXAM_TOOLS_STYLE_ID = 'seb-exam-tools-style';

    const ACCESS_CODE_FIELD_SELECTORS = [
        'input[name="access_code"]',
        'input[name*="access_code"]',
        'input[name*="access-code"]',
        'input[id*="access_code"]',
        'input[id*="access-code"]',
        'input[placeholder*="access code"]',
        'input[placeholder*="Access Code"]',
        'input[aria-label*="access code"]',
        'input[aria-label*="Access Code"]',
        '.quiz-access-code input',
        '#quiz_access_code',
        '#access_code',
        'input[type="password"][name*="access"]',
        'input[type="text"][name*="access"]'
    ];
    const ACCESS_CODE_FORM_SELECTORS = [
        ...ACCESS_CODE_FIELD_SELECTORS,
        '.access_code',
        '.access_code_form',
        '#access_code_form',
        'form[action*="access_code"]',
        'form[action*="access-code"]'
    ];
    const ACCESS_CODE_TEXT_INDICATORS = [
        'access code',
        'enter the access code',
        'quiz access code',
        'this quiz requires an access code'
    ];
    const NEW_QUIZ_ACCESS_CODE_PROMPT_INDICATORS = [
        'an access code is required to start',
        'access code is required to start',
        'enter the access code',
        'this quiz requires an access code'
    ];
    const ACCESS_CODE_EXCLUDE_SIGNALS = [
        'email',
        'username',
        'login',
        'signin',
        'google',
        'oauth',
        'sso'
    ];
    const NEW_QUIZ_BEGIN_SELECTOR = '[data-automation="sdk-start-resume-button"]';

    const COMPLETION_TEXT_INDICATORS = [
        'your quiz has been submitted',
        'quiz submitted',
        'submission successful',
        'quiz completed',
        'thank you for taking',
        'quiz submission complete',
        'your submission has been recorded',
        'submission recorded',
        'assignment submitted',
        'assignment turned in',
        'submission complete',
        'successfully submitted',
        'turned in successfully',
        'submission received',
        'submission confirmed',
        'thank you for your submission'
    ];
    const COMPLETION_PAGE_SELECTORS = [
        '[aria-label="Assessment results page" i]',
        '[data-automation="sdk-result-list-title"]'
    ];
    const CLASSIC_COMPLETION_PAGE_SELECTORS = [
        '.quiz-submission',
        '.muted-notice'
    ];
    const POST_SUBMIT_URL_PATTERNS = [
        /\/quizzes\/\d+\/submissions\b/,
        /\/quizzes\/\d+\/results\b/,
        /\/quizzes\/\d+\/history\b/,
        /\/assignments\/\d+\/submissions\b/,
        /\/assignments\/\d+\/results\b/,
        /\/assignments\/\d+\/taking\/[^/?#]+\/(?:results?|summary|completed?)\b/,
        /\/courses\/\d+\/quizzes(?:[?#]|$)/,
        /\/courses\/\d+\/assignments(?:[?#]|$)/,
        /submitted=true\b/,
        /submission_id=\d+/,
        /quiz_submission_id=\d+/,
        /submission_attempt=/
    ];
    const COMPLETION_URL_PATTERNS = [
        ...POST_SUBMIT_URL_PATTERNS,
        /\/courses\/\d+$/,
        /\/courses\/\d+\/grades\b/,
        /\/courses\/\d+\/gradebook\b/,
        /quiz.*complete/i,
        /submission.*complete/i,
        /assignment.*complete/i,
        /quiz.*submitted/i,
        /assignment.*submitted/i
    ];
    const NON_FINAL_SUBMIT_SIGNALS = [
        'access code',
        'access_code',
        'access-code',
        'save',
        'draft',
        'continue',
        'next',
        'previous',
        'back',
        'cancel',
        'close',
        'global navigation'
    ];
    const FINAL_SUBMIT_SIGNALS = [
        'submit quiz',
        'submit assignment',
        'submit assessment',
        'turn in',
        'finish attempt',
        'finish quiz',
        'complete quiz',
        'complete attempt',
        'submit_quiz',
        'submit-quiz',
        'quiz_submit',
        'quiz-submit',
        'submit_quiz_button',
        'submit_assignment',
        'submit-assignment'
    ];
    const QUIZ_PAGE_SELECTORS = [
        '#quiz_title',
        '.quiz-header',
        '#quiz-instructions',
        '.take_quiz_button',
        '#submit_quiz_button',
        '[data-testid*="quiz"]',
        '[class*="quiz"]'
    ];
    const SEB_WINDOW_PROPERTIES = ['SafeExamBrowser', 'SEB', 'seb', 'SafeBrowser'];

    const state = {
        debugMode: false,
        sebDetected: null,
        currentQuizKey: null,
        finalSubmitClickHandlerInstalled: false,
        finalSubmitFormHandlerInstalled: false,
        classicSubmitHandlerInstalled: false,
        classicSubmitInFlight: false,
        finalSubmitClickQuizInfo: null,
        observedForms: new WeakSet(),
        completionQuizKey: null,
        completionObserver: null,
        urlCompletionObserver: null,
        accessCodeObserver: null,
        accessCodeObserverTimer: null,
        accessCodeProgressHideTimer: null,
        accessCodeRequestKey: null,
        accessCodeRequestPromise: null,
        accessCodeAutomationKey: null,
        newQuizPrimeAttemptCounts: new Map(),
        newQuizPrimeTimers: new Map(),
        newQuizProofFailureKeys: new Set(),
        accessCodeSubmitClickKey: null,
        accessCodeChallengeHandledKey: null,
        dismissedLaunchPromptKey: null,
        newQuizBeginObserver: null,
        newQuizBeginObserverTimer: null,
        newQuizBeginClickKey: null,
        lateAccessCodeCheckTimer: null,
        pendingRedirectKey: null,
        pendingRedirectMarkedAt: 0,
        newQuizOverlayHideTimer: null,
        exitRedirectScheduledKey: null,
        postSubmitTimers: [],
        spaObserver: null,
        spaRerunTimer: null,
        detectorTraceId: null,
        detectorTraceSequence: 0,
        detectorTraceQueue: [],
        detectorTraceTimer: null,
        examToolWindows: new Map(),
        examToolLaunchVersion: 0,
        authorizedExamTools: new Map(),
        sebRequirementChecks: new Map()
    };

    function initializeScript() {
        loadDebugStatus();

        debugLog('Safe Online Exam detector loaded!', 'success');
        debugLog('Version: ' + DETECTOR_VERSION);
        debugLog('Debug Mode: ' + (state.debugMode ? 'ENABLED' : 'DISABLED'));
        debugLog('User Agent: ' + navigator.userAgent);
        debugLog('Current URL: ' + debugSafeUrl(window.location.href));
        debugLog('SEB Detection Result: ' + (isSafeBrowser() ? 'SEB DETECTED' : 'NOT SEB'));
        detectorTrace('initialized', collectDetectorTraceSnapshot, 'success');

        continueInitialization();
    }

    function isSebDebugOverrideEnabled() {
        try {
            const params = new URL(window.location.href).searchParams;
            return params.get('seb_debug') === '1' || params.get('debug') === 'true';
        } catch (error) {
            const href = window.location.href;
            return href.includes('seb_debug=1') || href.includes('debug=true');
        }
    }

    function isNonSebDebugBehaviorAllowed() {
        return state.debugMode && isSebDebugOverrideEnabled();
    }

    function loadDebugStatus() {
        const urlRequestedDebug = isSebDebugOverrideEnabled();
        state.debugMode = SERVER_DEBUG_ENABLED === true || SERVER_DEBUG_ENABLED === 'true' || DIAGNOSTIC_TRACING;
        if (urlRequestedDebug && state.debugMode) {
            debugLog('Debug mode requested by URL parameter and allowed by server flag');
        }
        return state.debugMode;
    }

    function debugLog(message, type = 'info') {
        if (!state.debugMode && type !== 'warn' && type !== 'error') {
            return;
        }

        const logger = type === 'warn' ? console.warn : type === 'error' ? console.error : console.log;
        logger('Safe Online Exam detector:', type);
    }

    function detectorTrace(event, details = {}, type = 'info') {
        if (!state.debugMode) {
            return;
        }

        try {
            if (!/^[a-z0-9-]{1,64}$/u.test(event)) {
                return;
            }
            const entry = {
                seq: ++state.detectorTraceSequence,
                at: new Date().toISOString(),
                event,
                type: ['info', 'success', 'warn', 'error'].includes(type) ? type : 'info',
                readyState: document.readyState,
                hidden: document.hidden === true,
                sebDetected: state.sebDetected === true
            };
            if (DIAGNOSTIC_TRACING) {
                const resolved = typeof details === 'function' ? details() : details;
                entry.details = sanitizeTraceValue(resolved || {});
            }
            state.detectorTraceQueue.push(entry);

            if (state.detectorTraceQueue.length >= detectorTraceBatchSize()) {
                flushDetectorTrace();
            } else {
                scheduleDetectorTraceFlush();
            }
        } catch (error) {
            // Tracing is diagnostic only; it must never affect quiz behavior.
        }
    }

    function detectorTraceBatchSize() {
        // Detail-rich diagnostic events are much larger, so flush smaller
        // batches to stay well under sendBeacon payload limits.
        return DIAGNOSTIC_TRACING ? 5 : DETECTOR_TRACE_BATCH_SIZE;
    }

    function scheduleDetectorTraceFlush() {
        if (state.detectorTraceTimer) {
            return;
        }
        state.detectorTraceTimer = setTimeout(() => {
            state.detectorTraceTimer = null;
            flushDetectorTrace();
        }, 500);
    }

    function flushDetectorTrace() {
        if (!state.detectorTraceQueue.length) {
            return;
        }

        const events = state.detectorTraceQueue.splice(0, detectorTraceBatchSize());
        const payload = {
            traceId: getDetectorTraceId(),
            source: 'canvas-seb-detector',
            version: DETECTOR_VERSION,
            events
        };

        try {
            const body = JSON.stringify(payload);
            if (navigator.sendBeacon && typeof Blob !== 'undefined') {
                const sent = navigator.sendBeacon(DETECTOR_TRACE_ENDPOINT, new Blob([body], { type: 'application/json' }));
                if (sent) {
                    return;
                }
            }

            fetch(DETECTOR_TRACE_ENDPOINT, {
                method: 'POST',
                credentials: 'omit',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body
            }).catch(() => {});
        } catch (error) {
            // Tracing is best-effort only.
        }
    }

    function getDetectorTraceId() {
        if (!state.detectorTraceId) {
            state.detectorTraceId = `seb-detector-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        }
        return state.detectorTraceId;
    }

    function sanitizeTraceValue(value, key = '', depth = 0) {
        if (SENSITIVE_TRACE_KEY_PATTERN.test(key)) {
            return '[redacted]';
        }
        if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            return traceSafeString(value);
        }
        if (depth >= 4) {
            return '[max-depth]';
        }
        if (Array.isArray(value)) {
            return value.slice(0, 20).map((item) => sanitizeTraceValue(item, key, depth + 1));
        }
        if (typeof value === 'object') {
            const sanitized = {};
            Object.keys(value).slice(0, 30).forEach((entryKey) => {
                sanitized[entryKey] = sanitizeTraceValue(value[entryKey], entryKey, depth + 1);
            });
            return sanitized;
        }
        return traceSafeString(String(value));
    }

    function traceSafeString(value) {
        const text = value.length > 400 ? value.slice(0, 400) + '...[truncated]' : value;
        return /^https?:\/\//iu.test(text) ? debugSafeUrl(text) : text;
    }

    function markPendingRedirect(quizInfo) {
        const key = quizKey(quizInfo);
        const now = Date.now();
        if (state.pendingRedirectKey === key && now - state.pendingRedirectMarkedAt < 1000) {
            return;
        }

        state.pendingRedirectKey = key;
        state.pendingRedirectMarkedAt = now;
        const payload = {
            courseId: quizInfo.courseId,
            quizId: quizInfo.quizId,
            contentType: quizInfo.contentType,
            attemptId: quizInfo.attemptId || null,
            ts: now
        };
        try {
            sessionStorage.setItem(REDIRECT_FLAG_KEY, JSON.stringify(payload));
            debugLog('Marked pending redirect for Course ' + quizInfo.courseId + ', Quiz ' + quizInfo.quizId, 'success');
            detectorTrace('pending-redirect-marked', { quizInfo }, 'success');
        } catch (error) {
            debugLog('Failed to mark pending redirect: ' + errorMessage(error), 'warn');
            detectorTrace('pending-redirect-mark-failed', { error: errorMessage(error), quizInfo }, 'warn');
        }
    }

    function clearPendingRedirect() {
        try {
            sessionStorage.removeItem(REDIRECT_FLAG_KEY);
            debugLog('Cleared pending redirect flag');
        } catch (error) {
            debugLog('Failed to clear pending redirect: ' + errorMessage(error), 'warn');
        }
        state.pendingRedirectKey = null;
        state.pendingRedirectMarkedAt = 0;
    }

    function getPendingRedirect() {
        try {
            const raw = sessionStorage.getItem(REDIRECT_FLAG_KEY);
            if (!raw) {
                return null;
            }
            const data = JSON.parse(raw);
            if (!data || !data.courseId || !data.quizId || !data.ts || Date.now() - data.ts > PENDING_REDIRECT_TTL_MS) {
                clearPendingRedirect();
                return null;
            }
            return data;
        } catch (error) {
            debugLog('Failed to get pending redirect: ' + errorMessage(error), 'warn');
            return null;
        }
    }

    function isOnTakePage(quizInfo = extractQuizInfo()) {
        if (!quizInfo) {
            return false;
        }

        if (quizInfo.contentType === 'NEW_QUIZ') {
            return new RegExp(
                '^/courses/' + escapeRegexValue(quizInfo.courseId) +
                '/assignments/' + escapeRegexValue(quizInfo.assignmentId) +
                '/taking/[^/]+/take/?$'
            ).test(location.pathname);
        }

        return new RegExp(
            '^/courses/' + escapeRegexValue(quizInfo.courseId) +
            '/quizzes/' + escapeRegexValue(quizInfo.quizId) +
            '/take(?:/|$)'
        ).test(location.pathname);
    }

    function isStudentAssessmentAccessPage(quizInfo = extractQuizInfo()) {
        if (!quizInfo) {
            return false;
        }

        if (quizInfo.contentType === 'NEW_QUIZ') {
            // New Quiz authoring screens also contain the access-code control.
            // Do not treat a known instructor workspace as an assessment
            // launch. Canvas can use /launch before it creates an attempt,
            // so rejecting every non-/taking route would break valid student
            // handoffs. This intentionally keeps the exclusion narrow.
            return !new RegExp(
                '^/courses/' + escapeRegexValue(quizInfo.courseId) +
                '/assignments/' + escapeRegexValue(quizInfo.assignmentId) +
                '/(?:build|settings|moderate|reports|exports)(?:/|$)'
            ).test(location.pathname);
        }

        return new RegExp(
            '^/courses/' + escapeRegexValue(quizInfo.courseId) +
            '/quizzes/' + escapeRegexValue(quizInfo.quizId) +
            '/take(?:/|$)'
        ).test(location.pathname);
    }

    function looksLikePostSubmitPage(pending = getPendingRedirect()) {
        return hasCompletionPageIndicator()
            || hasClassicCompletionPageIndicator(pending)
            || hasNewQuizPostSubmitRoute(pending);
    }

    function hasNewQuizPostSubmitRoute(pending) {
        if (!pending || pending.contentType !== 'NEW_QUIZ') {
            return false;
        }
        return isNewQuizPostAttemptRoute(quizInfoFromPending(pending));
    }

    function hasClassicCompletionPageIndicator(pending) {
        if (!pending || pending.contentType !== 'CLASSIC_QUIZ') {
            return false;
        }

        const expectedPath = `/courses/${pending.courseId}/quizzes/${pending.quizId}`;
        if (location.pathname !== expectedPath && location.pathname !== expectedPath + '/') {
            return false;
        }

        return CLASSIC_COMPLETION_PAGE_SELECTORS.some((selector) => document.querySelector(selector));
    }

    function maybeRedirectAfterSubmission() {
        const pending = getPendingRedirect();
        if (!pending) {
            maybeRedirectUnflaggedNewQuizCompletion();
            return;
        }
        const postSubmit = looksLikePostSubmitPage(pending);
        const currentQuizInfo = extractQuizInfo();
        if (pending && currentQuizInfo && !pendingMatchesQuizContext(pending, currentQuizInfo)) {
            detectorTrace('pending-redirect-context-mismatch', { pending, currentQuizInfo }, 'warn');
            clearPendingRedirect();
            clearNewQuizOverlayHideTimer();
            hideSubmissionOverlay();
            return;
        }
        const pendingQuizInfo = pending ? quizInfoFromPending(pending) : currentQuizInfo;
        const leftTakePage = pendingQuizInfo ? !isOnTakePage(pendingQuizInfo) : false;
        const verifiedNewQuizSameRouteCompletion = pending.contentType === 'NEW_QUIZ'
            && hasCompletionPageIndicator();

        detectorTrace('redirect-check', () => ({
            pending: pending ? { courseId: pending.courseId, quizId: pending.quizId, ageMs: Date.now() - pending.ts } : null,
            postSubmit,
            leftTakePage,
            snapshot: collectDetectorTraceSnapshot()
        }));

        debugLog('Checking for post-submission redirect...');
        debugLog('On take page: ' + isOnTakePage(pendingQuizInfo) + ', Looks like post-submit: ' + postSubmit);

        if (!postSubmit || (!leftTakePage && !verifiedNewQuizSameRouteCompletion)) {
            debugLog('Post-submission conditions not yet met, waiting...');
            return;
        }

        debugLog('Post-submission detected. Redirecting to SEB exit page.', 'success');
        clearPendingRedirect();
        if (pending.contentType === 'NEW_QUIZ') {
            clearNewQuizOverlayHideTimer();
            // Keep the "Submitting your quiz" overlay up through the short
            // redirect delay; the exit page takes over from there.
            showSubmissionOverlay('loading', NEW_QUIZ_SUBMISSION_LOADING);
            redirectToSebExitPage(pending.courseId, pending.quizId, 300);
            return;
        }
        redirectToSebExitPage(pending.courseId, pending.quizId);
    }

    function maybeRedirectUnflaggedNewQuizCompletion() {
        if (!isSafeBrowser()) {
            return;
        }

        const quizInfo = extractQuizInfo();
        if (!quizInfo || quizInfo.contentType !== 'NEW_QUIZ') {
            return;
        }

        if (state.exitRedirectScheduledKey === examToolsKey(quizInfo.courseId, quizInfo.quizId)) {
            return;
        }

        // The New Quiz player (questions, confirmation dialog, results) runs
        // inside the quiz-engine iframe, so the top-document detector never
        // sees the final submit click. Canvas only routes the top page to the
        // attempt's post-take view (e.g. /taking/{attempt}/results) once the
        // attempt is actually submitted, which makes that same-origin route
        // the completion signal page content cannot forge.
        if (!isNewQuizPostAttemptRoute(quizInfo) && !hasCompletionPageIndicator()) {
            return;
        }

        // This path stays inert unless this SEB session already proved this
        // exact exam session: the exit grant is only minted server-side after
        // a valid Config Key proof on the quiz-taking page, so results-like
        // content or URLs in any other context cannot trigger an exit.
        if (!readExamSessionCapabilities(quizInfo.courseId, quizInfo.quizId).exitGrant) {
            return;
        }

        debugLog('New Quiz completion detected for the active SEB exam session; redirecting to exit page', 'success');
        detectorTrace('new-quiz-unflagged-completion-redirect', { quizInfo }, 'warn');
        clearNewQuizOverlayHideTimer();
        // A missed submit click means no overlay is showing yet; briefly show
        // the submitting state so the exit is never a jarring blank jump.
        showSubmissionOverlay('loading', NEW_QUIZ_SUBMISSION_LOADING);
        redirectToSebExitPage(quizInfo.courseId, quizInfo.quizId, 300);
    }

    function isNewQuizPostAttemptRoute(quizInfo) {
        if (!quizInfo || quizInfo.contentType !== 'NEW_QUIZ' || !quizInfo.assignmentId || !quizInfo.attemptId) {
            return false;
        }
        // Canvas routes the top page to the attempt's results view once the
        // attempt is submitted. Only known post-take segments count, so an
        // unknown pre-attempt route can never masquerade as completion; the
        // results DOM markers remain the fallback if Canvas renames these.
        return new RegExp(
            '^/courses/' + escapeRegexValue(quizInfo.courseId) +
            '/assignments/' + escapeRegexValue(quizInfo.assignmentId) +
            '/taking/' + escapeRegexValue(quizInfo.attemptId) +
            '/(?:results?|summary|scores?|history|completed?)(?:/[^/]+)*/?$'
        ).test(location.pathname);
    }

    function redirectToSebExitPage(courseId, quizId, delayMs = 500) {
        const redirectKey = examToolsKey(courseId, quizId);
        if (state.exitRedirectScheduledKey === redirectKey) {
            return;
        }
        state.exitRedirectScheduledKey = redirectKey;
        const exitGrant = readExamSessionCapabilities(courseId, quizId).exitGrant;
        const exitUrl = exitGrant
            ? `${SEB_DOWNLOAD_BASE_URL}/seb/exit/session/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}/${exitGrant}`
            : `${SEB_DOWNLOAD_BASE_URL}/seb/exit/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}`;
        detectorTrace('exit-redirect-scheduled', { courseId, quizId, exitUrl, delayMs }, 'success');
        flushDetectorTrace();
        setTimeout(() => {
            debugLog('Executing redirect to SEB exit page...', 'success');
            window.location.assign(exitUrl);
        }, delayMs);
    }

    function schedulePostSubmitChecks() {
        state.postSubmitTimers.forEach((timer) => clearTimeout(timer));
        state.postSubmitTimers = [300, 1000, 2000, 4000, 8000, 12000].map((delay) =>
            setTimeout(maybeRedirectAfterSubmission, delay)
        );
    }

    function showAccessCodeProgressOverlay() {
        if (!document.body) {
            return;
        }

        if (state.accessCodeProgressHideTimer) {
            clearTimeout(state.accessCodeProgressHideTimer);
            state.accessCodeProgressHideTimer = null;
        }

        if (document.getElementById(ACCESS_CODE_PROGRESS_OVERLAY_ID)) {
            renderAccessCodeOverlayContent('loading');
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = ACCESS_CODE_PROGRESS_OVERLAY_ID;
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: grid;
            place-items: center;
            padding: 24px;
            background: rgba(12, 18, 32, 0.72);
            color: #172033;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        `;
        overlay.innerHTML = `<div id="${ACCESS_CODE_PROGRESS_CARD_ID}"></div>`;

        if (!document.getElementById(ACCESS_CODE_PROGRESS_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = ACCESS_CODE_PROGRESS_STYLE_ID;
            style.textContent = '@keyframes sebProgressSpin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { #seb-access-code-progress-card [data-seb-spinner="true"] { animation: none !important; } }';
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);
        renderAccessCodeOverlayContent('loading');
    }

    function showAccessCodeErrorOverlay(message) {
        showAccessCodeProgressOverlay();
        renderAccessCodeOverlayContent('error', message);
    }

    function renderAccessCodeOverlayContent(stateName, message) {
        const card = document.getElementById(ACCESS_CODE_PROGRESS_CARD_ID);
        if (!card) {
            return;
        }

        const isError = stateName === 'error';
        const isSuccess = stateName === 'success';
        const iconColor = isError ? '#b42318' : isSuccess ? '#05603a' : '#075985';
        const iconBackground = isError ? '#fff1f0' : isSuccess ? '#ecfdf3' : '#e0f2fe';
        const iconBorder = isError ? '#fecdca' : isSuccess ? '#abefc6' : '#bae6fd';
        const title = isError ? 'Something went wrong' : isSuccess ? 'Success' : 'Preparing your quiz';
        const body = isError
            ? escapeHtml(message || 'The access code could not be entered automatically. Reload the quiz through Safe Online Exam, or ask your instructor for help.')
            : isSuccess
                ? 'Entering your quiz now.'
                : 'Entering the access code automatically.';
        card.style.cssText = 'width: min(420px, 100%); background: #ffffff; border: 1px solid #dbe2ea; border-radius: 8px; box-shadow: 0 16px 34px rgba(24,36,56,0.16); padding: 28px; text-align: left;';
        card.innerHTML = `
            <div style="width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 18px; color: ${iconColor}; background: ${iconBackground}; border: 1px solid ${iconBorder}; border-radius: 8px;">
                ${
                    isError
                        ? '<div style="width: 22px; height: 22px; display: grid; place-items: center; border: 2px solid #b42318; border-radius: 999px; font-size: 15px; font-weight: 900; line-height: 1;">!</div>'
                        : isSuccess
                            ? '<div style="width: 22px; height: 22px; display: grid; place-items: center; font-size: 21px; font-weight: 900; line-height: 1;">✓</div>'
                            : '<div data-seb-spinner="true" style="width: 18px; height: 18px; border: 2px solid #bae6fd; border-top-color: #075985; border-radius: 999px; animation: sebProgressSpin 0.8s linear infinite;"></div>'
                }
            </div>
            <h2 style="margin: 0 0 10px; color: #182230; font-size: 24px; line-height: 1.15; font-weight: 800;">
                ${title}
            </h2>
            <p style="margin: 0; color: #667085; font-size: 15px; line-height: 1.45;">
                ${body}
            </p>
            ${
                isError
                    ? '<button type="button" id="seb-access-code-retry-button" style="margin-top: 18px; min-height: 38px; padding: 0 14px; border: 1px solid #0b63ce; border-radius: 8px; background: #0b63ce; color: #ffffff; font-weight: 800; cursor: pointer;">Try again</button>'
                    : ''
            }
        `;

        const retryButton = document.getElementById('seb-access-code-retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                const quizInfo = extractQuizInfo();
                if (quizInfo && quizInfo.contentType === 'NEW_QUIZ') {
                    resumeNewQuizAccessCodePrime(quizInfo);
                }
                resetAccessCodeAutomation();
                hideAccessCodeProgressOverlay();
                if (quizInfo && quizInfo.contentType === 'NEW_QUIZ') {
                    primeNewQuizAccessCode(quizInfo);
                } else {
                    autoFillAccessCode();
                }
            });
        }
    }

    function hideAccessCodeProgressOverlay(delay = 0) {
        if (state.accessCodeProgressHideTimer) {
            clearTimeout(state.accessCodeProgressHideTimer);
            state.accessCodeProgressHideTimer = null;
        }

        const removeOverlay = () => {
            const overlay = document.getElementById(ACCESS_CODE_PROGRESS_OVERLAY_ID);
            if (overlay) {
                overlay.remove();
            }
        };

        if (delay > 0) {
            state.accessCodeProgressHideTimer = setTimeout(removeOverlay, delay);
        } else {
            removeOverlay();
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function isSafeBrowser() {
        if (state.sebDetected === true) {
            return state.sebDetected;
        }

        const previousResult = state.sebDetected;
        const userAgent = navigator.userAgent || '';
        const uaLooksLikeSeb = /SafeExamBrowser|Safe Exam Browser|SEB[\/; _-]|SEB$/iu.test(userAgent);
        const hasSebProperty = !!(window.SafeExamBrowser || window.SEB);
        state.sebDetected = uaLooksLikeSeb || hasSebProperty;

        if (state.sebDetected) {
            debugLog('SEB detected via ' + (hasSebProperty ? 'window properties' : 'user agent'), 'success');
        } else if (previousResult !== false) {
            debugLog('SEB not detected - User Agent: ' + userAgent);
        }

        return state.sebDetected;
    }

    function isCanvasQuizPage() {
        const url = window.location.href;
        if (/\/courses\/\d+\/quizzes\/\d+/u.test(url) || /\/courses\/\d+\/assignments\/\d+/u.test(url)) {
            return true;
        }

        const env = window.ENV || {};
        if ((env.COURSE_ID || env.course_id) && (env.ASSIGNMENT_ID || env.assignment_id)) {
            const text = pageText();
            if (text.includes('quiz') || text.includes('access code')) {
                return true;
            }
        }

        return QUIZ_PAGE_SELECTORS.some((selector) => document.querySelector(selector));
    }

    function extractQuizInfo() {
        const url = window.location.href;
        const classicMatch = url.match(/\/courses\/(\d+)\/quizzes\/(\d+)/u);

        if (classicMatch) {
            return {
                courseId: classicMatch[1],
                quizId: classicMatch[2],
                contentType: 'CLASSIC_QUIZ'
            };
        }

        const assignmentMatch = url.match(/\/courses\/(\d+)\/assignments\/(\d+)(?:\/taking\/([^/?#]+))?/u);
        if (assignmentMatch) {
            return {
                courseId: assignmentMatch[1],
                assignmentId: assignmentMatch[2],
                attemptId: assignmentMatch[3] || null,
                quizId: `newquiz:${assignmentMatch[1]}:${assignmentMatch[2]}`,
                contentType: 'NEW_QUIZ'
            };
        }

        const env = window.ENV || {};
        const envCourseId = env.COURSE_ID || env.course_id;
        const envAssignmentId = env.ASSIGNMENT_ID || env.assignment_id;
        if (envCourseId && envAssignmentId) {
            return {
                courseId: String(envCourseId),
                assignmentId: String(envAssignmentId),
                quizId: `newquiz:${envCourseId}:${envAssignmentId}`,
                contentType: 'NEW_QUIZ'
            };
        }

        return null;
    }

    function checkForAccessCodeRequirement() {
        if (ACCESS_CODE_FORM_SELECTORS.some((selector) => document.querySelector(selector))) {
            debugLog('Access code requirement detected via selector', 'success');
            return true;
        }

        const text = pageText();
        for (const indicator of ACCESS_CODE_TEXT_INDICATORS) {
            if (text.includes(indicator)) {
                debugLog('Access code requirement detected via text: ' + indicator, 'success');
                return true;
            }
        }

        return false;
    }

    async function isSebRequiredForAssessment(quizInfo) {
        const key = quizInfo.courseId + ':' + quizInfo.quizId;
        const now = Date.now();
        const cached = state.sebRequirementChecks.get(key);
        if (cached && cached.expiresAt > now) {
            return cached.promise;
        }

        const promise = fetch(
            `${SEB_DOWNLOAD_BASE_URL}/api/seb/requirement/${encodeURIComponent(quizInfo.courseId)}/${encodeURIComponent(quizInfo.quizId)}`,
            {
                method: 'GET',
                credentials: 'omit',
                headers: { 'Accept': 'application/json' }
            }
        ).then(async (response) => {
            if (!response.ok) {
                throw new Error('Requirement status returned HTTP ' + response.status);
            }
            const data = await response.json();
            return data?.success === true && data.sebRequired === true;
        }).catch((error) => {
            debugLog('Could not verify Safe Online Exam requirement: ' + errorMessage(error), 'warn');
            return false;
        });

        state.sebRequirementChecks.set(key, {
            expiresAt: now + SEB_REQUIREMENT_CACHE_TTL_MS,
            promise
        });
        return promise;
    }

    function isCurrentQuizContext(quizInfo) {
        const current = extractQuizInfo();
        return !!current && quizKey(current) === quizKey(quizInfo);
    }

    async function shouldShowSebLaunchPrompt(quizInfo) {
        return await isSebRequiredForAssessment(quizInfo)
            && isCurrentQuizContext(quizInfo)
            && !isSafeBrowser()
            && checkForAccessCodeRequirement();
    }

    function findAccessCodeField() {
        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            return null;
        }
        return quizInfo.contentType === 'NEW_QUIZ'
            ? findTrustedNewQuizAccessCodeField()
            : findTrustedClassicAccessCodeField(quizInfo);
    }

    function findTrustedClassicAccessCodeField(quizInfo) {
        const forms = Array.from(document.querySelectorAll('form.access_code_form, form#access_code_form'))
            .filter((form) => isSameOriginClassicQuizForm(form, quizInfo));
        if (forms.length !== 1) {
            return null;
        }
        const form = forms[0];
        const submitters = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
        if (submitters.length !== 1) {
            return null;
        }
        const fields = Array.from(form.querySelectorAll('input[name="access_code"]'))
            .filter((field) => !field.disabled
                && !isDetectorOwnedElement(field)
                && isVisibleElement(field)
                && isAccessCodeField(field));
        return fields.length === 1 ? fields[0] : null;
    }

    function isSameOriginClassicQuizForm(form, quizInfo) {
        try {
            const action = new URL(form.getAttribute('action') || location.href, location.href);
            const current = new URL(location.href);
            const expectedQuizPath = `/courses/${quizInfo.courseId}/quizzes/${quizInfo.quizId}`;
            const currentPathIsAccessGate = current.pathname === expectedQuizPath
                || current.pathname === expectedQuizPath + '/take';
            return currentPathIsAccessGate
                && action.origin === current.origin
                && action.pathname === current.pathname;
        } catch (error) {
            return false;
        }
    }

    function findTrustedNewQuizAccessCodeField() {
        const gate = findTrustedNewQuizAccessCodeGate();
        return gate ? gate.field : null;
    }

    function findTrustedNewQuizAccessCodeGate() {
        const gates = findNewQuizAccessCodeSubmitters(document)
            .map((submitter) => findNewQuizAccessCodeGateForSubmitter(submitter))
            .filter(Boolean);
        const uniqueFields = new Set(gates.map((gate) => gate.field));
        const uniqueSubmitters = new Set(gates.map((gate) => gate.submitter));
        return uniqueFields.size === 1 && uniqueSubmitters.size === 1 ? gates[0] : null;
    }

    function findNewQuizAccessCodeGateForSubmitter(submitter) {
        const container = findNewQuizAccessCodePromptContainer(submitter);
        if (!container) {
            return null;
        }

        const fields = Array.from(
            container.querySelectorAll('input[type="password"], input[type="text"], input:not([type])')
        ).filter((field) => !field.disabled
            && !isDetectorOwnedElement(field)
            && isVisibleElement(field)
            && isAccessCodeField(field));
        const semanticFields = fields.filter(hasAccessCodeFieldIdentity);
        const field = semanticFields.length === 1
            ? semanticFields[0]
            : fields.length === 1
                ? fields[0]
                : null;
        return field ? { container, field, submitter } : null;
    }

    function findNewQuizAccessCodePromptContainer(submitter) {
        let container = submitter && submitter.parentElement;
        while (container && container !== document.documentElement) {
            if (isDetectorOwnedElement(container)) {
                return null;
            }
            const summary = normalizeElementText(container);
            const isStableCanvasSubmitter = submitter.getAttribute('data-automation') === 'sdk-submit-access-code-button';
            const promptIndicators = isStableCanvasSubmitter
                ? ACCESS_CODE_TEXT_INDICATORS
                : NEW_QUIZ_ACCESS_CODE_PROMPT_INDICATORS;
            if (promptIndicators.some((indicator) => summary.includes(indicator))) {
                return container;
            }
            if (container === document.body) {
                break;
            }
            container = container.parentElement;
        }
        return null;
    }

    function hasTrustedNewQuizAccessCodePrompt() {
        return findNewQuizAccessCodeSubmitters(document)
            .some((submitter) => Boolean(findNewQuizAccessCodePromptContainer(submitter)));
    }

    function hasAccessCodeFieldIdentity(field) {
        const identity = normalizeTextParts([
            field.name,
            field.id,
            field.placeholder,
            typeof field.getAttribute === 'function' ? field.getAttribute('aria-label') : null,
            typeof field.getAttribute === 'function' ? field.getAttribute('data-testid') : null,
            typeof field.getAttribute === 'function' ? field.getAttribute('data-automation') : null
        ]);
        return identity.includes('access code')
            || identity.includes('access_code')
            || identity.includes('access-code');
    }

    function findNewQuizAccessCodeSubmitters(container) {
        const automationSubmitters = Array.from(
            container.querySelectorAll('[data-automation="sdk-submit-access-code-button"]')
        ).filter((button) => isVisibleElement(button) && !isDetectorOwnedElement(button));
        if (automationSubmitters.length) {
            return automationSubmitters;
        }
        return Array.from(container.querySelectorAll('button, input[type="submit"], input[type="button"]'))
            .filter((button) => {
                if (!isVisibleElement(button) || isDetectorOwnedElement(button)) {
                    return false;
                }
                const label = String(button.textContent || button.value || '').trim().toLowerCase();
                return label === 'submit';
            });
    }

    function findContextualAccessCodeField(root) {
        if (!root || !hasCanvasAccessCodePrompt()) {
            return null;
        }

        const candidates = Array.from(root.querySelectorAll('input[type="password"], input[type="text"]'))
            .filter((field) => !field.disabled && !isDetectorOwnedElement(field) && isAccessCodeField(field));
        if (!candidates.length) {
            return null;
        }

        const passwordCandidates = candidates.filter((field) => field.type === 'password');
        if (passwordCandidates.length === 1) {
            return passwordCandidates[0];
        }
        if (candidates.length === 1) {
            return candidates[0];
        }

        const contextMatches = candidates.filter((field) => {
            const container = field.closest('form, [role="dialog"], section, article, main');
            const summary = normalizeElementText(container);
            return ACCESS_CODE_TEXT_INDICATORS.some((indicator) => summary.includes(indicator));
        });
        const contextualPasswords = contextMatches.filter((field) => field.type === 'password');
        if (contextualPasswords.length === 1) {
            return contextualPasswords[0];
        }
        return contextMatches.length === 1 ? contextMatches[0] : null;
    }

    function hasCanvasAccessCodePrompt() {
        if (!document.body) {
            return false;
        }

        const snapshot = document.body.cloneNode(true);
        [SEB_LAUNCH_PROMPT_ID, ACCESS_CODE_PROGRESS_OVERLAY_ID, EXAM_TOOLS_SIDEBAR_ID].forEach((id) => {
            const detectorElement = snapshot.querySelector('#' + id);
            if (detectorElement) {
                detectorElement.remove();
            }
        });
        const text = (snapshot.textContent || '').toLowerCase();
        return ACCESS_CODE_TEXT_INDICATORS.some((indicator) => text.includes(indicator));
    }

    function isDetectorOwnedElement(element) {
        if (!element || typeof element.closest !== 'function') {
            return false;
        }
        return Boolean(element.closest(
            '#' + SEB_LAUNCH_PROMPT_ID +
            ', #' + ACCESS_CODE_PROGRESS_OVERLAY_ID +
            ', #' + EXAM_TOOLS_SIDEBAR_ID
        ));
    }

    function isAccessCodeChallengePage() {
        const quizInfo = extractQuizInfo();
        if (findAccessCodeField()) {
            return true;
        }

        if (quizInfo && quizInfo.contentType === 'NEW_QUIZ') {
            return hasTrustedNewQuizAccessCodePrompt();
        }

        if (document.querySelector('#access_code_form, .access_code_form, form[action*="access_code"], form[action*="access-code"], .access_code')) {
            return true;
        }

        const hasAccessCodePrompt = ACCESS_CODE_TEXT_INDICATORS.some((indicator) => pageText().includes(indicator));
        if (!hasAccessCodePrompt) {
            return false;
        }

        return Boolean(document.querySelector('form, input, button[type="submit"], input[type="submit"]'));
    }

    function shouldAttemptAccessCodeAutofill() {
        if (!isSafeBrowser()) {
            return false;
        }

        if (!isCanvasQuizPage()) {
            return false;
        }

        return isAccessCodeChallengePage();
    }

    function findSebCourseNavigationUrl(courseId) {
        const courseIdValue = String(courseId || '');
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const anchor of anchors) {
            const identifyingText = [anchor.textContent, anchor.getAttribute('aria-label'), anchor.getAttribute('title')]
                .filter(Boolean)
                .join(' ')
                .trim()
                .toLowerCase();
            if (
                !identifyingText.includes('safe online exam') &&
                !identifyingText.includes('safe exam browser') &&
                identifyingText !== 'seb'
            ) {
                continue;
            }
            try {
                const url = new URL(anchor.href, window.location.origin);
                const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
                if (
                    url.origin === window.location.origin &&
                    segments.length === 4 &&
                    segments[0] === 'courses' &&
                    segments[1] === courseIdValue &&
                    segments[2] === 'external_tools' &&
                    /^[a-z0-9_-]{1,128}$/i.test(segments[3])
                ) {
                    return url.href;
                }
            } catch {
                // Ignore malformed or cross-origin course-navigation links.
            }
        }
        return null;
    }

    function buildAssessmentLtiLaunchUrl(courseId, quizId) {
        const courseNavigationUrl = findSebCourseNavigationUrl(courseId);
        const rawContentId = String(quizId || '');
        const contentId = /^\d{1,20}$/u.test(rawContentId)
            ? `classicquiz_${rawContentId}`
            : /^newquiz:\d{1,20}:\d{1,20}$/u.test(rawContentId)
                ? rawContentId
                : null;
        if (!courseNavigationUrl || !contentId) {
            return null;
        }
        try {
            const canvasLaunch = new URL(courseNavigationUrl);
            const target = new URL(`/seb/launch/${contentId}`, SEB_DOWNLOAD_BASE_URL);
            if (canvasLaunch.origin !== window.location.origin || target.origin !== new URL(SEB_DOWNLOAD_BASE_URL).origin) {
                return null;
            }
            // Canvas validates that launch_url belongs to the configured tool,
            // then performs the normal signed LTI launch for this exact target.
            canvasLaunch.searchParams.set('display', 'borderless');
            canvasLaunch.searchParams.set('launch_url', target.href);
            return canvasLaunch.href;
        } catch {
            return null;
        }
    }

    function redirectToSebDownload(courseId, quizId) {
        if (document.getElementById(SEB_LAUNCH_PROMPT_ID)) {
            return;
        }
        const quizInfo = extractQuizInfo();
        if (!isStudentAssessmentAccessPage(quizInfo)) {
            debugLog('Not a student assessment access route, skipping browser launch prompt');
            return;
        }
        const promptKey = quizInfo ? quizKey(quizInfo) : courseId + ':' + quizId;
        const isNewQuiz = quizInfo
            ? quizInfo.contentType === 'NEW_QUIZ'
            : typeof quizId === 'string' && quizId.startsWith('newquiz:');
        if (isNewQuiz && state.dismissedLaunchPromptKey === promptKey) {
            debugLog('New Quiz SEB launch prompt was dismissed for this attempt');
            return;
        }
        const secureLaunchUrl = buildAssessmentLtiLaunchUrl(courseId, quizId);
        const fallbackUrl = `${window.location.origin}/courses/${encodeURIComponent(courseId)}`;

        const message = document.createElement('div');
        message.id = SEB_LAUNCH_PROMPT_ID;
        message.setAttribute('role', 'dialog');
        message.setAttribute('aria-modal', 'true');
        message.setAttribute('aria-labelledby', 'seb-launch-dialog-title');
        message.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(12, 18, 32, 0.72);
            color: #172033;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            padding: 24px;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        `;

        message.innerHTML = `
            <div style="width: min(560px, 100%); overflow: hidden; background: #ffffff; color: #182230; border: 1px solid #dbe2ea; border-radius: 8px; box-shadow: 0 16px 34px rgba(24,36,56,0.16); text-align: left;">
                <div style="padding: 32px 32px 22px;">
                <div style="width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 18px; overflow: hidden; background: #ffffff; border: 1px solid #dbe2ea; border-radius: 10px;">
                    <img src="${escapeHtml(SAFE_ONLINE_EXAM_ICON_URL)}" alt="" width="40" height="40" loading="lazy" decoding="async" style="display: block; width: 40px; height: 40px; object-fit: contain;" />
                </div>
                <p style="margin: 0 0 6px; color: #0b63ce; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0;">
                    Safe Online Exam
                </p>
                <h2 id="seb-launch-dialog-title" style="color: #182230; margin: 0 0 12px; font-size: 24px; line-height: 1.15; font-weight: 800;">
                    Open Safe Exam Browser
                </h2>
                <p style="margin: 0; font-size: 15px; line-height: 1.45; color: #667085;">
                    ${isNewQuiz
                        ? 'Open this assessment in Safe Exam Browser, or stay here to review previous attempts.'
                        : 'Open this assessment in Safe Exam Browser.'}
                </p>
                </div>
                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 32px 18px; background: #f8fafc; border-top: 1px solid #dbe2ea; flex-wrap: wrap;">
                        ${isNewQuiz
                            ? '<button id="seb-launch-view-page-button" type="button" style="min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid #cfd7e3; border-radius: 8px; background: #ffffff; color: #344054; font-weight: 800; cursor: pointer;">View quiz page</button>'
                            : '<button id="seb-launch-back-button" type="button" style="min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid #cfd7e3; border-radius: 8px; background: #ffffff; color: #344054; font-weight: 800; cursor: pointer;">Back</button>'}
                        <a id="seb-launch-open-link" href="${escapeHtml(secureLaunchUrl || fallbackUrl)}" rel="noopener noreferrer" referrerpolicy="no-referrer" style="min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; border-radius: 8px; background: #0b63ce; color: #ffffff; text-decoration: none; font-weight: 800;">
                        ${secureLaunchUrl ? 'Open Safe Exam Browser' : 'Open Safe Online Exam'}
                        </a>
                </div>
            </div>
        `;

        const previousFocus = document.activeElement;
        document.body.appendChild(message);
        const dismissPrompt = (rememberForAttempt = false) => {
            if (rememberForAttempt) {
                state.dismissedLaunchPromptKey = promptKey;
            }
            message.remove();
            if (previousFocus && typeof previousFocus.focus === 'function') {
                previousFocus.focus();
            }
        };
        const backButton = document.getElementById('seb-launch-back-button');
        const viewPageButton = document.getElementById('seb-launch-view-page-button');
        const openLink = document.getElementById('seb-launch-open-link');
        if (backButton) {
            backButton.addEventListener('click', () => {
                if (window.history && typeof window.history.back === 'function') {
                    window.history.back();
                    return;
                }
                dismissPrompt();
            });
        }
        if (viewPageButton) {
            viewPageButton.addEventListener('click', () => {
                debugLog('New Quiz launch prompt dismissed to view the quiz page');
                detectorTrace('new-quiz-launch-prompt-dismissed', { quizInfo }, 'success');
                dismissPrompt(true);
            });
        }
        message.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                dismissPrompt(isNewQuiz);
            }
        });
        if (openLink) {
            openLink.focus();
        }
    }

    function setupExamToolsSidebar(quizInfo) {
        if (!quizInfo || document.getElementById(EXAM_TOOLS_SIDEBAR_ID)) {
            return;
        }

        const capabilities = readExamSessionCapabilities(quizInfo.courseId, quizInfo.quizId);
        if (capabilities.tools.length) {
            state.authorizedExamTools.set(examToolsKey(quizInfo.courseId, quizInfo.quizId), capabilities.tools);
        }
        const tools = state.authorizedExamTools.get(examToolsKey(quizInfo.courseId, quizInfo.quizId)) || [];
        if (!tools.length) {
            debugLog('No external exam tools configured for this quiz');
            return;
        }

        renderExamToolsSidebar(quizInfo, tools);
    }

    function removeExamToolsSidebar() {
        const sidebar = document.getElementById(EXAM_TOOLS_SIDEBAR_ID);
        if (sidebar) {
            sidebar.remove();
        }
    }

    function examToolsKey(courseId, quizId) {
        return `${String(courseId)}:${String(quizId)}`;
    }

    function examSessionCapabilityKey(courseId, quizId) {
        return EXAM_SESSION_CAPABILITY_PREFIX + examToolsKey(courseId, quizId);
    }

    function persistExamSessionCapabilities(courseId, quizId, tools, exitGrant) {
        const safeTools = Array.isArray(tools) ? tools.filter(isUsableExamTool) : [];
        const safeExitGrant = typeof exitGrant === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(exitGrant)
            ? exitGrant
            : // A capability refresh without a fresh grant must not discard the
              // one this session already earned, or the exit redirect loses it.
              readExamSessionCapabilities(courseId, quizId).exitGrant;
        state.authorizedExamTools.set(examToolsKey(courseId, quizId), safeTools);
        try {
            sessionStorage.setItem(
                examSessionCapabilityKey(courseId, quizId),
                JSON.stringify({ tools: safeTools, exitGrant: safeExitGrant, ts: Date.now() })
            );
        } catch (error) {
            // Session storage can be unavailable in hardened or private browser contexts.
        }
    }

    function readExamSessionCapabilities(courseId, quizId) {
        try {
            const raw = sessionStorage.getItem(examSessionCapabilityKey(courseId, quizId));
            if (!raw) {
                return { tools: [], exitGrant: null };
            }
            const parsed = JSON.parse(raw);
            if (!parsed || !Number.isFinite(parsed.ts) || Date.now() - parsed.ts > EXAM_SESSION_CAPABILITY_TTL_MS) {
                sessionStorage.removeItem(examSessionCapabilityKey(courseId, quizId));
                return { tools: [], exitGrant: null };
            }
            return {
                tools: Array.isArray(parsed.tools) ? parsed.tools.filter(isUsableExamTool) : [],
                exitGrant: typeof parsed.exitGrant === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(parsed.exitGrant)
                    ? parsed.exitGrant
                    : null
            };
        } catch (error) {
            return { tools: [], exitGrant: null };
        }
    }

    function isUsableExamTool(tool) {
        if (!tool || typeof tool.label !== 'string' || typeof tool.url !== 'string') {
            return false;
        }
        try {
            const parsed = new URL(tool.url);
            return parsed.protocol === 'https:' && tool.label.trim().length > 0;
        } catch (error) {
            return false;
        }
    }

    function renderExamToolsSidebar(quizInfo, tools) {
        if (!document.body) {
            return;
        }
        injectExamToolsStyles();

        const storageKey = `seb_exam_tools_${quizInfo.courseId}_${quizInfo.quizId}`;
        const savedState = readExamToolsState(storageKey);
        const sidebar = document.createElement('aside');
        sidebar.id = EXAM_TOOLS_SIDEBAR_ID;
        sidebar.setAttribute('aria-label', 'Exam tools');
        sidebar.setAttribute('data-seb-tools-placement', 'automatic');
        sidebar.addEventListener('dragstart', (event) => event.preventDefault());
        sidebar.addEventListener('selectstart', (event) => event.preventDefault());
        if (savedState.collapsed) {
            sidebar.classList.add('is-collapsed');
        }
        if (savedState.left !== null && savedState.top !== null) {
            sidebar.style.left = savedState.left + 'px';
            sidebar.style.top = savedState.top + 'px';
            sidebar.style.right = 'auto';
        }

        const header = document.createElement('div');
        header.className = 'seb-tools-header';

        const dragHandle = document.createElement('span');
        dragHandle.className = 'seb-tools-drag-handle';
        dragHandle.setAttribute('aria-hidden', 'true');
        dragHandle.title = 'Drag to move exam tools';
        dragHandle.textContent = '\u2807';

        const title = document.createElement('div');
        title.className = 'seb-tools-title';
        const titleStrong = document.createElement('strong');
        titleStrong.textContent = 'Exam tools';
        const titleSmall = document.createElement('small');
        titleSmall.textContent = `${tools.length} available`;
        title.append(titleStrong, titleSmall);

        const controls = document.createElement('div');
        controls.className = 'seb-tools-controls';
        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'seb-tools-icon-button';
        resetButton.title = 'Move tools to the best available corner';
        resetButton.setAttribute('aria-label', 'Move tools to the best available corner');
        resetButton.textContent = '\u21ba';
        resetButton.addEventListener('click', () => {
            placeExamToolsAutomatically(sidebar);
            persistExamToolsState(storageKey, sidebar);
        });
        const collapseButton = document.createElement('button');
        collapseButton.type = 'button';
        collapseButton.className = 'seb-tools-icon-button';
        collapseButton.title = 'Collapse tools';
        collapseButton.setAttribute('aria-label', 'Collapse exam tools');
        collapseButton.setAttribute('aria-expanded', String(!sidebar.classList.contains('is-collapsed')));
        collapseButton.textContent = '-';
        collapseButton.addEventListener('click', () => {
            sidebar.classList.toggle('is-collapsed');
            const collapsed = sidebar.classList.contains('is-collapsed');
            collapseButton.textContent = collapsed ? '+' : '-';
            collapseButton.title = collapsed ? 'Expand tools' : 'Collapse tools';
            collapseButton.setAttribute('aria-label', collapsed ? 'Expand exam tools' : 'Collapse exam tools');
            collapseButton.setAttribute('aria-expanded', String(!collapsed));
            clampExamToolsPosition(sidebar);
            persistExamToolsState(storageKey, sidebar);
        });
        controls.append(resetButton, collapseButton);
        header.append(dragHandle, title, controls);

        const body = document.createElement('div');
        body.className = 'seb-tools-body';
        tools.forEach((tool) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'seb-tool-button';
            button.title = `Open ${tool.label}`;
            button.setAttribute('aria-label', `Open ${tool.label}`);
            button.addEventListener('click', (event) => openExamTool(event, tool), true);

            const mark = document.createElement('span');
            mark.className = 'seb-tool-mark';
            mark.textContent = tool.label.trim().slice(0, 1).toUpperCase();
            const text = document.createElement('span');
            text.className = 'seb-tool-text';
            const name = document.createElement('strong');
            name.textContent = tool.label;
            const host = document.createElement('small');
            host.textContent = examToolDisplayHost(tool.url);
            text.append(name, host);
            button.append(mark, text);
            body.append(button);
        });

        sidebar.append(header, body);
        document.body.appendChild(sidebar);
        collapseButton.textContent = sidebar.classList.contains('is-collapsed') ? '+' : '-';
        if (savedState.left !== null && savedState.top !== null) {
            clampExamToolsPosition(sidebar);
        } else {
            placeExamToolsAutomatically(sidebar);
        }
        makeExamToolsDraggable(sidebar, header, storageKey);
        window.addEventListener('resize', () => {
            if (document.getElementById(EXAM_TOOLS_SIDEBAR_ID) === sidebar) {
                clampExamToolsPosition(sidebar);
                persistExamToolsState(storageKey, sidebar);
            }
        }, { passive: true });
    }

    function openExamTool(event, tool) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
        }

        // A new user action supersedes any short focus recovery scheduled for
        // a prior tool launch.
        const launchVersion = ++state.examToolLaunchVersion;
        const windowName = getExamToolWindowName(tool);
        const existingWindow = state.examToolWindows.get(windowName);
        if (focusExamToolWindow(existingWindow)) {
            debugLog('Focused existing exam tool window: ' + tool.label, 'success');
            return;
        }

        // SEB's macOS WKWebView can create a window for about:blank but ignore
        // a later cross-origin location.replace(), leaving an empty window. A
        // direct user-gesture navigation is both reliable and subject to the
        // generated URL filter.
        const openedWindow = window.open(tool.url, windowName);
        if (!openedWindow) {
            debugLog('Exam tool window could not be opened: ' + tool.label, 'warn');
            return;
        }
        try {
            openedWindow.opener = null;
        } catch (error) {
            // Some embedded browser engines do not expose opener across a
            // newly-created cross-origin window. The named window remains
            // safe to reuse and SEB's allowlist remains the enforcement layer.
        }
        state.examToolWindows.set(windowName, openedWindow);
        focusNewExamToolWindow(tool, windowName, openedWindow, launchVersion);
    }

    function focusNewExamToolWindow(tool, windowName, toolWindow, launchVersion) {
        focusExamToolWindow(toolWindow);

        // Sheets performs a second, cross-origin startup navigation after its
        // initial document appears. In SEB's macOS WKWebView that navigation
        // can return focus to the Canvas window after the direct user-gesture
        // focus above. Reassert focus only for Sheets, and only for this most
        // recent tool launch, so normal tools and a student's later tool click
        // are never interrupted.
        if (!isGoogleSheetsToolUrl(tool.url)) {
            return;
        }
        [150, 500, 1100].forEach((delay) => {
            setTimeout(() => {
                if (
                    state.examToolLaunchVersion !== launchVersion ||
                    state.examToolWindows.get(windowName) !== toolWindow
                ) {
                    return;
                }
                focusExamToolWindow(toolWindow);
            }, delay);
        });
    }

    function isGoogleSheetsToolUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' &&
                parsed.hostname.toLowerCase() === 'docs.google.com' &&
                /^\/spreadsheets(?:\/|$)/i.test(parsed.pathname);
        } catch (error) {
            return false;
        }
    }

    function examToolDisplayHost(url) {
        try {
            const parsed = new URL(url);
            if (/\/seb\/tool\/youtube\/[A-Za-z0-9_-]{11}$/i.test(parsed.pathname)) {
                return 'youtube.com';
            }
            return parsed.hostname;
        } catch (error) {
            return 'approved tool';
        }
    }

    function focusExamToolWindow(toolWindow) {
        if (!toolWindow) {
            return false;
        }
        try {
            if (toolWindow.closed) {
                return false;
            }
            toolWindow.focus();
            return true;
        } catch (error) {
            return false;
        }
    }

    function getExamToolWindowName(tool) {
        let hash = 0;
        const source = tool.id || tool.url || tool.label || 'tool';
        for (let index = 0; index < source.length; index += 1) {
            hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
        }
        return 'seb_exam_tool_' + Math.abs(hash).toString(36);
    }

    function injectExamToolsStyles() {
        if (document.getElementById(EXAM_TOOLS_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = EXAM_TOOLS_STYLE_ID;
        style.textContent = `
            #${EXAM_TOOLS_SIDEBAR_ID} {
                position: fixed;
                top: 12px;
                right: 12px;
                z-index: 2147483000;
                width: min(260px, calc(100vw - 24px));
                max-height: calc(100dvh - 24px);
                color: #172033;
                background: #ffffff;
                border: 1px solid #d0d5dd;
                border-radius: 12px;
                box-shadow: 0 18px 44px rgba(24, 36, 56, 0.24);
                font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                overflow: hidden;
                isolation: isolate;
                -webkit-user-select: none;
                user-select: none;
                -webkit-touch-callout: none;
                touch-action: manipulation;
                transition: left 160ms ease-out, top 160ms ease-out, width 160ms ease-out;
            }
            #${EXAM_TOOLS_SIDEBAR_ID}.is-moving {
                cursor: grabbing;
                transition: none;
            }
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed {
                width: 182px;
            }
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed .seb-tools-body,
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed .seb-tools-title small {
                display: none;
            }
            .seb-tools-header {
                min-height: 48px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 9px 9px 9px 8px;
                background: #f8fafc;
                border-bottom: 1px solid #eaecf0;
            }
            .seb-tools-drag-handle {
                width: 24px;
                height: 32px;
                display: grid;
                place-items: center;
                flex: 0 0 auto;
                color: #98a2b3;
                border-radius: 7px;
                cursor: grab;
                font-size: 19px;
                line-height: 1;
                letter-spacing: -3px;
                touch-action: none;
            }
            .seb-tools-drag-handle:hover {
                color: #475467;
                background: #eaecf0;
            }
            .seb-tools-title strong,
            .seb-tool-text strong {
                display: block;
                color: #172033;
                font-size: 14px;
                line-height: 1.2;
                font-weight: 800;
            }
            .seb-tools-title small,
            .seb-tool-text small {
                display: block;
                margin-top: 2px;
                color: #667085;
                font-size: 12px;
                line-height: 1.2;
                font-weight: 700;
            }
            .seb-tools-controls {
                display: flex;
                margin-left: auto;
                gap: 6px;
            }
            .seb-tools-icon-button {
                width: 30px;
                height: 30px;
                border: 1px solid #d0d5dd;
                border-radius: 8px;
                background: #ffffff;
                color: #344054;
                font-size: 18px;
                font-weight: 800;
                line-height: 1;
                cursor: pointer;
            }
            .seb-tools-icon-button:hover {
                border-color: #98a2b3;
                background: #f9fafb;
            }
            .seb-tools-icon-button:focus-visible,
            .seb-tool-button:focus-visible {
                outline: 3px solid rgba(11, 99, 206, 0.36);
                outline-offset: 2px;
            }
            .seb-tools-body {
                display: grid;
                gap: 8px;
                padding: 10px;
                max-height: min(420px, calc(100dvh - 88px));
                overflow: auto;
                overscroll-behavior: contain;
            }
            .seb-tool-button {
                width: 100%;
                min-height: 48px;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 10px;
                border: 1px solid #dfe3ea;
                border-radius: 8px;
                background: #ffffff;
                color: #172033;
                text-align: left;
                cursor: pointer;
                -webkit-user-select: none;
                user-select: none;
                transition: border-color 120ms ease-out, background 120ms ease-out, transform 120ms ease-out;
            }
            .seb-tool-button:hover {
                border-color: #0b63ce;
                background: #eff8ff;
            }
            .seb-tool-button:active {
                transform: translateY(1px);
            }
            .seb-tool-mark {
                width: 30px;
                height: 30px;
                display: grid;
                place-items: center;
                flex: 0 0 auto;
                color: #175cd3;
                background: #eff8ff;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 900;
            }
            @media (prefers-reduced-motion: reduce) {
                #${EXAM_TOOLS_SIDEBAR_ID},
                .seb-tool-button {
                    transition: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function makeExamToolsDraggable(sidebar, handle, storageKey) {
        let drag = null;
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.isPrimary === false) {
                return;
            }
            const target = event.target;
            if (target && typeof target.closest === 'function' && target.closest('button')) {
                return;
            }
            event.preventDefault();
            const rect = sidebar.getBoundingClientRect();
            drag = {
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top
            };
            sidebar.classList.add('is-moving');
            sidebar.style.left = rect.left + 'px';
            sidebar.style.top = rect.top + 'px';
            sidebar.style.right = 'auto';
            sidebar.style.bottom = 'auto';
            sidebar.setAttribute('data-seb-tools-placement', 'manual');
            try {
                handle.setPointerCapture(event.pointerId);
            } catch (error) {
                // Pointer capture is unavailable in some embedded browser engines.
            }
        });
        const move = (event) => {
            if (!drag) {
                return;
            }
            const bounds = getExamToolsSafeBounds();
            const rect = sidebar.getBoundingClientRect();
            const maxLeft = Math.max(bounds.left, window.innerWidth - rect.width - bounds.right);
            const maxTop = Math.max(bounds.top, window.innerHeight - rect.height - bounds.bottom);
            const left = Math.min(Math.max(bounds.left, event.clientX - drag.offsetX), maxLeft);
            const top = Math.min(Math.max(bounds.top, event.clientY - drag.offsetY), maxTop);
            sidebar.style.left = left + 'px';
            sidebar.style.top = top + 'px';
        };
        const finish = (event) => {
            if (!drag) {
                return;
            }
            drag = null;
            sidebar.classList.remove('is-moving');
            try {
                handle.releasePointerCapture(event.pointerId);
            } catch (error) {
                // Pointer capture may already be released.
            }
            snapExamToolsToNearbyEdge(sidebar);
            persistExamToolsState(storageKey, sidebar);
        };
        // Listen on the window as well as using pointer capture. This keeps a
        // drag usable in embedded browsers that implement pointer events but
        // do not support setPointerCapture.
        window.addEventListener('pointermove', move, { passive: true });
        window.addEventListener('pointerup', finish, { passive: true });
        window.addEventListener('pointercancel', finish, { passive: true });
    }

    function clampExamToolsPosition(sidebar) {
        const rect = sidebar.getBoundingClientRect();
        const hasStoredPosition = sidebar.style.left && sidebar.style.top;
        if (!hasStoredPosition) {
            return;
        }
        const bounds = getExamToolsSafeBounds();
        const maxLeft = Math.max(bounds.left, window.innerWidth - rect.width - bounds.right);
        const maxTop = Math.max(bounds.top, window.innerHeight - rect.height - bounds.bottom);
        sidebar.style.left = Math.min(Math.max(bounds.left, rect.left), maxLeft) + 'px';
        sidebar.style.top = Math.min(Math.max(bounds.top, rect.top), maxTop) + 'px';
        sidebar.style.right = 'auto';
        sidebar.style.bottom = 'auto';
    }

    function placeExamToolsAutomatically(sidebar) {
        const bounds = getExamToolsSafeBounds();
        const rect = sidebar.getBoundingClientRect();
        const width = rect.width || Math.min(260, Math.max(160, window.innerWidth - bounds.left - bounds.right));
        const height = rect.height || 160;
        const candidates = [
            { name: 'top-right', left: window.innerWidth - width - bounds.right, top: bounds.top },
            { name: 'bottom-right', left: window.innerWidth - width - bounds.right, top: window.innerHeight - height - bounds.bottom },
            { name: 'top-left', left: bounds.left, top: bounds.top },
            { name: 'bottom-left', left: bounds.left, top: window.innerHeight - height - bounds.bottom }
        ].map((candidate, index) => {
            const positioned = {
                ...candidate,
                left: Math.min(Math.max(bounds.left, candidate.left), Math.max(bounds.left, window.innerWidth - width - bounds.right)),
                top: Math.min(Math.max(bounds.top, candidate.top), Math.max(bounds.top, window.innerHeight - height - bounds.bottom))
            };
            return { ...positioned, score: examToolsPlacementScore(positioned, width, height) + index / 100 };
        });
        const best = candidates.reduce((current, candidate) => candidate.score < current.score ? candidate : current);
        sidebar.style.left = Math.round(best.left) + 'px';
        sidebar.style.top = Math.round(best.top) + 'px';
        sidebar.style.right = 'auto';
        sidebar.style.bottom = 'auto';
        sidebar.setAttribute('data-seb-tools-placement', best.name);
    }

    function getExamToolsSafeBounds() {
        const margin = 12;
        let top = margin;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const chrome = document.querySelectorAll('#header, .ic-app-header, .ic-app-nav-toggle-and-crumbs, header, [role="banner"]');
        chrome.forEach((element) => {
            const rect = element.getBoundingClientRect();
            const spansMostOfViewport = rect.width >= viewportWidth * 0.45;
            const isTopChrome = rect.top <= margin && rect.bottom > margin && rect.bottom < viewportHeight * 0.4;
            if (spansMostOfViewport && isTopChrome) {
                top = Math.max(top, Math.round(rect.bottom) + margin);
            }
        });
        return { left: margin, top, right: margin, bottom: margin };
    }

    function examToolsPlacementScore(candidate, width, height) {
        const left = candidate.left;
        const top = candidate.top;
        const right = left + width;
        const bottom = top + height;
        let score = 0;
        const obstructions = document.querySelectorAll(
            '#header, .ic-app-header, .ic-app-nav-toggle-and-crumbs, #left-side, .ic-app-course-menu, header, [role="banner"], [role="navigation"]'
        );
        obstructions.forEach((element) => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) {
                return;
            }
            const overlapWidth = Math.max(0, Math.min(right, rect.right) - Math.max(left, rect.left));
            const overlapHeight = Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top));
            score += overlapWidth * overlapHeight;
        });
        return score;
    }

    function snapExamToolsToNearbyEdge(sidebar) {
        const rect = sidebar.getBoundingClientRect();
        const bounds = getExamToolsSafeBounds();
        const maxLeft = Math.max(bounds.left, window.innerWidth - rect.width - bounds.right);
        const maxTop = Math.max(bounds.top, window.innerHeight - rect.height - bounds.bottom);
        const snapDistance = 44;
        let left = Math.min(Math.max(bounds.left, rect.left), maxLeft);
        let top = Math.min(Math.max(bounds.top, rect.top), maxTop);
        if (Math.abs(left - bounds.left) <= snapDistance) {
            left = bounds.left;
        } else if (Math.abs(left - maxLeft) <= snapDistance) {
            left = maxLeft;
        }
        if (Math.abs(top - bounds.top) <= snapDistance) {
            top = bounds.top;
        } else if (Math.abs(top - maxTop) <= snapDistance) {
            top = maxTop;
        }
        sidebar.style.left = Math.round(left) + 'px';
        sidebar.style.top = Math.round(top) + 'px';
    }

    function readExamToolsState(storageKey) {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                return { collapsed: false, left: null, top: null };
            }
            const parsed = JSON.parse(raw);
            return {
                collapsed: !!parsed.collapsed,
                left: Number.isFinite(parsed.left) ? parsed.left : null,
                top: Number.isFinite(parsed.top) ? parsed.top : null
            };
        } catch (error) {
            return { collapsed: false, left: null, top: null };
        }
    }

    function persistExamToolsState(storageKey, sidebar) {
        try {
            const rect = sidebar.getBoundingClientRect();
            localStorage.setItem(
                storageKey,
                JSON.stringify({
                    collapsed: sidebar.classList.contains('is-collapsed'),
                    left: Math.round(rect.left),
                    top: Math.round(rect.top)
                })
            );
        } catch (error) {
            // Storage can be disabled in hardened browser contexts.
        }
    }

    function autoFillAccessCode(options = {}) {
        debugLog('Checking for access code auto-fill');

        if (!isSafeBrowser()) {
            debugLog('Not in SEB, skipping auto-fill');
            return;
        }

        if (looksLikePostSubmitPage() && !isAccessCodeChallengePage()) {
            debugLog('Post-submit page detected, skipping auto-fill');
            return;
        }

        const trustedChallengeVisible = isAccessCodeChallengePage();
        if (!trustedChallengeVisible && options.waitForNewQuizField !== true) {
            debugLog('No trusted Canvas access-code field is visible, skipping auto-fill');
            return;
        }

        const quizInfo = options.quizInfo || extractQuizInfo();
        if (!quizInfo) {
            debugLog('Could not extract quiz info for auto-fill', 'warn');
            showAccessCodeErrorOverlay('The quiz page could not be identified. Reload the quiz through Safe Online Exam, or ask your instructor for help.');
            return;
        }

        const key = quizKey(quizInfo);
        const shouldShowAccessCodeErrors = trustedChallengeVisible;

        if (state.accessCodeAutomationKey === key) {
            debugLog('Access-code automation already active for this quiz');
            return;
        }

        if (state.accessCodeRequestKey === key && state.accessCodeRequestPromise) {
            debugLog('Access-code request already in flight for this quiz');
            return;
        }

        state.accessCodeAutomationKey = key;
        if (shouldShowAccessCodeErrors) {
            showAccessCodeProgressOverlay();
        }

        state.accessCodeRequestKey = key;
        state.accessCodeRequestPromise = requestAndFillAccessCode(quizInfo, shouldShowAccessCodeErrors)
            .finally(() => {
                state.accessCodeRequestKey = null;
                state.accessCodeRequestPromise = null;
            });
    }

    function primeNewQuizAccessCode(quizInfo) {
        if (
            !quizInfo
            || quizInfo.contentType !== 'NEW_QUIZ'
            || !isSafeBrowser()
            || isOnTakePage(quizInfo)
            || looksLikePostSubmitPage()
        ) {
            return;
        }
        if (readExamSessionCapabilities(quizInfo.courseId, quizInfo.quizId).exitGrant) {
            state.newQuizPrimeAttemptCounts.delete(quizKey(quizInfo));
            return;
        }
        const key = quizKey(quizInfo);
        if (state.newQuizProofFailureKeys.has(key)) {
            debugLog('New Quiz access-code priming is paused after a failed verification');
            return;
        }
        const currentQuizInfo = extractQuizInfo();
        if (!currentQuizInfo || quizKey(currentQuizInfo) !== key) {
            return;
        }
        const attempts = state.newQuizPrimeAttemptCounts.get(key) || 0;
        if (attempts >= 6) {
            debugLog('Stopped New Quiz access-code priming after six proof attempts', 'warn');
            return;
        }
        state.newQuizPrimeAttemptCounts.set(key, attempts + 1);
        debugLog('Priming the proof-gated New Quiz access code before Canvas finishes rendering');
        detectorTrace('new-quiz-access-code-prime-started', { quizInfo }, 'success');
        removeExamToolsSidebar();
        autoFillAccessCode({ waitForNewQuizField: true, quizInfo });
        scheduleNewQuizAccessCodePrime(quizInfo, 5000);
    }

    function scheduleNewQuizAccessCodePrime(quizInfo, delayMs = 2000) {
        if (!quizInfo || quizInfo.contentType !== 'NEW_QUIZ') {
            return;
        }
        const key = quizKey(quizInfo);
        if (state.newQuizProofFailureKeys.has(key)) {
            return;
        }
        if (state.newQuizPrimeTimers.has(key)) {
            return;
        }
        const timer = setTimeout(() => {
            state.newQuizPrimeTimers.delete(key);
            primeNewQuizAccessCode(quizInfo);
        }, delayMs);
        state.newQuizPrimeTimers.set(key, timer);
    }

    function pauseNewQuizAccessCodePrime(quizInfo) {
        if (!quizInfo || quizInfo.contentType !== 'NEW_QUIZ') {
            return;
        }
        const key = quizKey(quizInfo);
        state.newQuizProofFailureKeys.add(key);
        const timer = state.newQuizPrimeTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            state.newQuizPrimeTimers.delete(key);
        }
    }

    function resumeNewQuizAccessCodePrime(quizInfo) {
        if (!quizInfo || quizInfo.contentType !== 'NEW_QUIZ') {
            return;
        }
        const key = quizKey(quizInfo);
        state.newQuizProofFailureKeys.delete(key);
        state.newQuizPrimeAttemptCounts.delete(key);
        const timer = state.newQuizPrimeTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            state.newQuizPrimeTimers.delete(key);
        }
    }

    async function requestAndFillAccessCode(quizInfo, shouldShowAccessCodeErrors) {
        try {
            debugLog('Requesting SEB access proof...');
            const proofResult = await requestAccessProofToken(quizInfo.courseId, quizInfo.quizId);
            if (!proofResult.proofToken) {
                debugLog('No SEB access proof available', 'warn');
                if (proofResult.retryable !== true) {
                    pauseNewQuizAccessCodePrime(quizInfo);
                }
                releaseAccessCodeAutomation(quizInfo);
                showAutoFillError(
                    proofResult.errorMessage ||
                        'Safe Online Exam could not verify this quiz configuration. Reload the quiz through Safe Online Exam, or ask your instructor for help.',
                    shouldShowAccessCodeErrors
                );
                return;
            }

            debugLog('Fetching access code from backend...');
            const accessCode = await fetchAccessCodeForQuiz(quizInfo.courseId, quizInfo.quizId, proofResult.proofToken);
            if (accessCode) {
                debugLog('Access code retrieved from backend', 'success');
                attemptAutoFillWithRetry(accessCode, 0, shouldShowAccessCodeErrors);
            } else {
                debugLog('No access code available for auto-fill', 'warn');
                pauseNewQuizAccessCodePrime(quizInfo);
                releaseAccessCodeAutomation(quizInfo);
                showAutoFillError(
                    'The quiz access code could not be retrieved. Reload the quiz in SEB, or ask your instructor for help.',
                    shouldShowAccessCodeErrors
                );
            }
        } catch (error) {
            debugLog('Error fetching access code: ' + errorMessage(error), 'warn');
            pauseNewQuizAccessCodePrime(quizInfo);
            releaseAccessCodeAutomation(quizInfo);
            showAutoFillError(
                'The quiz access code could not be retrieved. Check your connection, reload the quiz in SEB, or ask your instructor for help.',
                shouldShowAccessCodeErrors
            );
        }
    }

    function showAutoFillError(message, shouldShowError) {
        if (shouldShowError) {
            showAccessCodeErrorOverlay(message);
        } else {
            hideAccessCodeProgressOverlay();
        }
    }

    function primeExamSessionCapabilities(quizInfo) {
        if (!quizInfo || !isSafeBrowser() || !isOnTakePage(quizInfo) || isAccessCodeChallengePage()) {
            return;
        }
        const cached = readExamSessionCapabilities(quizInfo.courseId, quizInfo.quizId);
        if (cached.exitGrant) {
            setupExamToolsSidebar(quizInfo);
            return;
        }
        const key = quizKey(quizInfo);
        if (state.accessCodeRequestKey === key && state.accessCodeRequestPromise) {
            return;
        }
        state.accessCodeRequestKey = key;
        state.accessCodeRequestPromise = (async () => {
            const proofResult = await requestAccessProofToken(quizInfo.courseId, quizInfo.quizId);
            if (!proofResult.proofToken) {
                debugLog('Could not prime exam session capabilities', 'warn');
                return;
            }
            await fetchAccessCodeForQuiz(quizInfo.courseId, quizInfo.quizId, proofResult.proofToken);
            setupExamToolsSidebar(quizInfo);
        })().finally(() => {
            state.accessCodeRequestKey = null;
            state.accessCodeRequestPromise = null;
        });
    }

    async function getSebConfigKeyHash() {
        const seb = window.SafeExamBrowser;
        if (!seb || !seb.security) {
            debugLog('SEB JavaScript security API not available', 'warn');
            return null;
        }

        if (typeof seb.security.updateKeys === 'function') {
            await new Promise((resolve) => {
                let resolved = false;
                const finish = () => {
                    if (!resolved) {
                        resolved = true;
                        resolve();
                    }
                };

                try {
                    seb.security.updateKeys(finish);
                    setTimeout(finish, 1500);
                } catch (error) {
                    debugLog('Could not refresh SEB security keys: ' + errorMessage(error), 'warn');
                    finish();
                }
            });
        }

        return readSebConfigKeyHash(seb.security.configKey);
    }

    function readSebConfigKeyHash(configKey) {
        if (typeof configKey === 'string' && configKey.length > 0) {
            return configKey;
        }

        if (typeof configKey === 'function') {
            try {
                const value = configKey();
                return typeof value === 'string' && value.length > 0 ? value : null;
            } catch (error) {
                debugLog('Could not read SEB config key: ' + errorMessage(error), 'warn');
            }
        }

        return null;
    }

    async function requestAccessProofToken(courseId, quizId) {
        const configKeyHash = await getSebConfigKeyHash();
        if (!configKeyHash) {
            debugLog('No SEB Config Key hash available from SEB security API', 'warn');
            return {
                proofToken: null,
                retryable: true,
                errorMessage:
                    'Safe Online Exam could not read the Config Key for this quiz. Reopen the quiz from Canvas using the Safe Online Exam link.'
            };
        }

        try {
            const url = `${SEB_DOWNLOAD_BASE_URL}/api/seb/access-proof/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}`;
            const proofPageUrl = window.location.href.split('#')[0];
            debugLog('Sending access proof for page URL: ' + debugSafeUrl(proofPageUrl));
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'omit',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    configKeyHash,
                    url: proofPageUrl
                })
            });

            debugLog('Proof response status: ' + response.status);
            if (!response.ok) {
                debugLog('Failed to create access proof: ' + response.status, 'warn');
                const responseText = await response.text();
                if (state.debugMode) {
                    debugLog('Access proof error response: ' + responseText);
                }
                return {
                    proofToken: null,
                    errorMessage: accessProofErrorMessage(response.status, responseText)
                };
            }

            const data = await response.json();
            return data.success
                ? { proofToken: data.proofToken, errorMessage: null }
                : {
                      proofToken: null,
                      errorMessage: accessProofErrorMessage(response.status, JSON.stringify({ error_code: data.error_code }))
                  };
        } catch (error) {
            debugLog('Error creating access proof: ' + errorMessage(error), 'warn');
            return {
                proofToken: null,
                errorMessage:
                    'Safe Online Exam could not verify this quiz configuration because the verification request failed. Check your connection, then reload the quiz through Safe Online Exam.'
            };
        }
    }

    function accessProofErrorMessage(status, responseText) {
        const fallback =
            status === 403 || status === 409
                ? 'This Safe Online Exam configuration could not be verified. It may be stale, incorrect, or modified. Reopen the quiz from Canvas using the Safe Online Exam link.'
                : 'Safe Online Exam could not verify this quiz configuration. Reload the quiz through Safe Online Exam, or ask your instructor for help.';

        if (!responseText) {
            return fallback;
        }

        try {
            const payload = JSON.parse(responseText);
            if (payload && payload.error_code === 'CANVAS_SESSION_AUTHORIZATION_REQUIRED') {
                return 'Your Canvas connection has expired. Return to Canvas, reconnect Safe Online Exam, then reopen this quiz.';
            }
            if (payload && (payload.error_code === 'INVALID_SEB_CONFIG_PROOF' || payload.error_code === 'SEB_CONFIGURATION_UNAVAILABLE')) {
                return fallback;
            }
            return fallback;
        } catch (error) {
            return fallback;
        }
    }

    function attemptAutoFillWithRetry(accessCode, attempt, shouldShowMissingFieldError) {
        const maxAttempts = 10;
        const retryDelay = 1000;

        debugLog(`Auto-fill attempt ${attempt + 1}/${maxAttempts}`);

        if (fillAccessCodeField(accessCode)) {
            debugLog('Access code auto-filled successfully', 'success');
            return;
        }

        if (attempt < maxAttempts - 1) {
            debugLog(`Access code field not found, retrying in ${retryDelay}ms`);
            setTimeout(() => {
                attemptAutoFillWithRetry(accessCode, attempt + 1, shouldShowMissingFieldError);
            }, retryDelay);
        } else {
            debugLog('Failed to auto-fill access code after all attempts, setting up mutation observer', 'warn');
            setupAccessCodeObserver(accessCode, shouldShowMissingFieldError);
        }
    }

    async function fetchAccessCodeForQuiz(courseId, quizId, proofToken) {
        try {
            const url = `${SEB_DOWNLOAD_BASE_URL}/api/seb/access-code/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}`;
            debugLog('Fetching from URL: ' + url);

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'omit',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json',
                    'X-SEB-Proof-Token': proofToken
                }
            });

            debugLog('Response status: ' + response.status);

            if (response.ok) {
                const data = await response.json();
                debugLog('Response data: ' + JSON.stringify({ success: data.success, hasAccessCode: !!data.accessCode }));
                const tools = Array.isArray(data.tools) ? data.tools.filter(isUsableExamTool) : [];
                persistExamSessionCapabilities(courseId, quizId, tools, data.exitGrant);
                return data.accessCode;
            }

            debugLog('Failed to fetch access code: ' + response.status, 'warn');
            if (state.debugMode) {
                debugLog('Access-code error response: ' + await response.text());
            }
            return null;
        } catch (error) {
            debugLog('Error fetching access code: ' + errorMessage(error), 'warn');
            return null;
        }
    }

    function fillAccessCodeField(accessCode) {
        debugLog('Attempting to fill access code field');
        debugLog('Searching for access code field with ' + ACCESS_CODE_FIELD_SELECTORS.length + ' selectors');

        const field = findAccessCodeField();
        if (!field) {
            debugLog('Could not find access code field');
            if (state.debugMode) {
                const allInputs = document.querySelectorAll('input');
                debugLog('Total inputs found on page: ' + allInputs.length);
                allInputs.forEach((input, index) => {
                    debugLog('Input ' + index + ': type=' + input.type + ', name=' + input.name + ', id=' + input.id + ', placeholder=' + input.placeholder);
                });
            }
            return false;
        }

        showAccessCodeProgressOverlay();
        setNativeInputValue(field, accessCode);
        debugLog('Access code field value set');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));

        debugLog('Access code auto-filled successfully!', 'success');
        const quizInfo = extractQuizInfo();
        if (autoSubmitAccessCode(field, quizInfo)) {
            hideAccessCodeProgressOverlay(8000);
        } else {
            hideAccessCodeProgressOverlay(700);
        }
        return true;
    }

    function setNativeInputValue(field, value) {
        const ownSetter = Object.getOwnPropertyDescriptor(field, 'value')?.set;
        const prototype = Object.getPrototypeOf(field);
        const prototypeSetter = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : null;

        if (prototypeSetter && ownSetter !== prototypeSetter) {
            prototypeSetter.call(field, value);
            return;
        }
        if (ownSetter) {
            ownSetter.call(field, value);
            return;
        }
        field.value = value;
    }

    function isAccessCodeField(field) {
        const fieldName = (field.name || '').toLowerCase();
        const fieldId = (field.id || '').toLowerCase();
        const fieldPlaceholder = (field.placeholder || '').toLowerCase();
        const fieldAriaLabel = (field.getAttribute('aria-label') || '').toLowerCase();
        const summary = [fieldName, fieldId, fieldPlaceholder, fieldAriaLabel].join(' ');

        for (const signal of ACCESS_CODE_EXCLUDE_SIGNALS) {
            if (summary.includes(signal)) {
                debugLog('Excluding field due to pattern: ' + signal);
                return false;
            }
        }

        const parentElement = field.closest('.google-signin, .oauth-signin, .sso-signin, [class*="google"], [id*="google"]');
        if (parentElement) {
            debugLog('Excluding field in Google sign-in context');
            return false;
        }

        if (field.type !== 'text' && field.type !== 'password') {
            return false;
        }

        debugLog('Field validation passed for access code');
        return true;
    }

    function autoSubmitAccessCode(accessCodeField, quizInfo) {
        const submitButton = findAccessCodeSubmitButton(accessCodeField);
        if (submitButton) {
            scheduleAccessCodeSubmit(accessCodeField, submitButton, quizInfo, 'trusted-challenge');
            return true;
        }

        debugLog('No submit button found for auto-submission');
        return false;
    }

    function scheduleAccessCodeSubmit(accessCodeField, initialSubmitButton, quizInfo, source) {
        const key = quizInfo ? quizKey(quizInfo) : state.currentQuizKey;
        debugLog('Access-code Submit control found; waiting until Canvas enables it', 'success');

        if (quizInfo && quizInfo.contentType === 'NEW_QUIZ') {
            setupNewQuizBeginObserver(quizInfo);
        }

        const trySubmit = (attempt) => {
            if (key && state.currentQuizKey && state.currentQuizKey !== key) {
                return;
            }
            if (key && state.newQuizBeginClickKey === key) {
                return;
            }

            const currentSubmitButton = findAccessCodeSubmitButton(accessCodeField) || initialSubmitButton;
            const buttonReady = currentSubmitButton
                && currentSubmitButton.isConnected
                && !currentSubmitButton.disabled
                && currentSubmitButton.getAttribute('aria-disabled') !== 'true'
                && isVisibleElement(currentSubmitButton);

            if (!buttonReady) {
                if (attempt < 40) {
                    setTimeout(() => trySubmit(attempt + 1), 250);
                    return;
                }

                debugLog('Canvas access-code Submit control did not become available', 'warn');
                detectorTrace('access-code-submit-timeout', () => ({
                    source,
                    quizInfo,
                    submitButton: summarizeTraceElement(currentSubmitButton)
                }), 'warn');
                releaseAccessCodeAutomation(quizInfo);
                showAccessCodeErrorOverlay('The Canvas Submit button could not be activated. Try again, or reload the quiz through Safe Online Exam.');
                return;
            }

            if (key && state.accessCodeSubmitClickKey === key) {
                return;
            }
            state.accessCodeSubmitClickKey = key;
            debugLog('Clicking the Canvas access-code Submit control', 'success');
            detectorTrace('access-code-submit-clicked', () => ({
                source,
                quizInfo,
                submitButton: summarizeTraceElement(currentSubmitButton)
            }), 'success');
            renderAccessCodeOverlayContent('success');
            currentSubmitButton.click();
        };

        setTimeout(() => trySubmit(0), 500);
    }

    function findAccessCodeSubmitButton(accessCodeField) {
        const quizInfo = extractQuizInfo();
        if (!quizInfo || !accessCodeField) {
            return null;
        }
        if (quizInfo.contentType === 'NEW_QUIZ') {
            const gate = findTrustedNewQuizAccessCodeGate();
            return gate && gate.field === accessCodeField ? gate.submitter : null;
        }
        const form = accessCodeField && accessCodeField.closest('form');
        if (
            !form
            || (form.id !== 'access_code_form' && !form.classList.contains('access_code_form'))
            || !isSameOriginClassicQuizForm(form, quizInfo)
        ) {
            return null;
        }
        const submitters = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
        return submitters.length === 1 ? submitters[0] : null;
    }

    function setupNewQuizBeginObserver(quizInfo) {
        disconnectNewQuizBeginObserver();
        if (clickNewQuizBeginIfReady(quizInfo)) {
            return;
        }

        const observer = new MutationObserver(() => {
            if (clickNewQuizBeginIfReady(quizInfo)) {
                disconnectNewQuizBeginObserver();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        state.newQuizBeginObserver = observer;
        state.newQuizBeginObserverTimer = setTimeout(() => {
            if (state.newQuizBeginObserver !== observer) {
                return;
            }

            disconnectNewQuizBeginObserver();
            if (state.newQuizBeginClickKey !== quizKey(quizInfo)) {
                debugLog('Canvas did not show the New Quiz Begin control after access-code submission', 'warn');
                detectorTrace('new-quiz-begin-timeout', { quizInfo }, 'warn');
                releaseAccessCodeAutomation(quizInfo);
                showAccessCodeErrorOverlay('The access code was entered, but Canvas did not show the Begin button. Try again, or reload the quiz through Safe Online Exam.');
            }
        }, 30000);
    }

    function clickNewQuizBeginIfReady(quizInfo) {
        const key = quizKey(quizInfo);
        if (state.newQuizBeginClickKey === key) {
            return true;
        }

        const beginButton = document.querySelector(NEW_QUIZ_BEGIN_SELECTOR);
        if (!beginButton
            || beginButton.disabled
            || beginButton.getAttribute('aria-disabled') === 'true'
            || !isVisibleElement(beginButton)) {
            return false;
        }

        state.newQuizBeginClickKey = key;
        debugLog('Clicking the Canvas New Quiz Begin control', 'success');
        detectorTrace('new-quiz-begin-clicked', () => ({
            quizInfo,
            beginButton: summarizeTraceElement(beginButton)
        }), 'success');
        renderAccessCodeOverlayContent('success');
        beginButton.click();
        hideAccessCodeProgressOverlay(700);
        return true;
    }

    function disconnectNewQuizBeginObserver() {
        if (state.newQuizBeginObserver) {
            state.newQuizBeginObserver.disconnect();
            state.newQuizBeginObserver = null;
        }
        if (state.newQuizBeginObserverTimer) {
            clearTimeout(state.newQuizBeginObserverTimer);
            state.newQuizBeginObserverTimer = null;
        }
    }

    function releaseAccessCodeAutomation(quizInfo) {
        const key = quizInfo ? quizKey(quizInfo) : state.currentQuizKey;
        if (!key || state.accessCodeAutomationKey === key) {
            state.accessCodeAutomationKey = null;
            state.accessCodeSubmitClickKey = null;
            disconnectNewQuizBeginObserver();
        }
    }

    function resetAccessCodeAutomation() {
        state.accessCodeAutomationKey = null;
        state.accessCodeSubmitClickKey = null;
        state.newQuizBeginClickKey = null;
        disconnectNewQuizBeginObserver();
    }

    function setupQuizCompletionHandler() {
        debugLog('Setting up quiz completion handler');

        const debugOverrideAllowed = isNonSebDebugBehaviorAllowed();
        const sebDetected = isSafeBrowser();
        detectorTrace('completion-handler-requested', () => ({
            debugOverrideAllowed,
            sebDetected,
            snapshot: collectDetectorTraceSnapshot()
        }));

        if (!sebDetected && !debugOverrideAllowed) {
            debugLog('Not in SEB and no debug URL override is active, skipping quiz completion handler');
            return;
        }

        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            debugLog('Could not extract quiz info for completion handler');
            return;
        }

        debugLog('Quiz completion handler active for Course ' + quizInfo.courseId + ', Quiz ' + quizInfo.quizId);
        detectorTrace('completion-handler-active', () => ({ quizInfo, snapshot: collectDetectorTraceSnapshot() }), 'success');
        interceptQuizSubmission(quizInfo);

        const key = quizKey(quizInfo);
        if (state.completionQuizKey === key && state.completionObserver && state.urlCompletionObserver) {
            return;
        }

        disconnectCompletionObservers();
        state.completionQuizKey = key;
        watchForCompletionIndicators(quizInfo);
        monitorUrlForCompletion(quizInfo);
    }

    function interceptQuizSubmission(quizInfo) {
        debugLog('Setting up quiz submission interceptor');
        state.finalSubmitClickQuizInfo = quizInfo;

        if (!state.finalSubmitClickHandlerInstalled) {
            document.addEventListener('click', handlePotentialFinalSubmitClick, true);
            state.finalSubmitClickHandlerInstalled = true;
            debugLog('Installed verified final submit click handler');
        }

        if (!state.finalSubmitFormHandlerInstalled) {
            document.addEventListener('submit', handlePotentialFinalSubmitForm, true);
            state.finalSubmitFormHandlerInstalled = true;
            debugLog('Installed document-level final submit handler');
        }

        if (!state.classicSubmitHandlerInstalled) {
            document.addEventListener('submit', handleClassicQuizSubmission, false);
            state.classicSubmitHandlerInstalled = true;
            debugLog('Installed response-verified Classic Quiz submit handler');
        }

        const allForms = document.querySelectorAll('form');
        debugLog('Found ' + allForms.length + ' total forms on page');
        detectorTrace('submission-interceptor-installed', () => ({
            quizInfo,
            formCount: allForms.length,
            forms: Array.from(allForms).slice(0, 10).map(summarizeTraceForm)
        }));

        allForms.forEach((form, index) => {
            if (state.observedForms.has(form)) {
                return;
            }
            state.observedForms.add(form);
            debugLog('Form ' + index + ': action=' + debugSafeUrlOrFallback(form.action, 'no action') + ', id=' + (form.id || 'no id'));

            form.addEventListener('submit', function (event) {
                debugLog('FORM SUBMISSION DETECTED on form ' + index + '!', 'success');
                debugLog('Form action: ' + debugSafeUrlOrFallback(this.action, 'no action'));
                debugLog('Form method: ' + (this.method || 'no method'));

                const submitButton = event.submitter || document.activeElement;
                debugLog('Submit button: ' + describeElement(submitButton));
                detectorTrace('form-submit-event', () => ({
                    source: 'form listener',
                    index,
                    form: summarizeTraceForm(this),
                    submitButton: summarizeTraceElement(submitButton)
                }), 'success');

                if (isAccessCodeForm(this)) {
                    debugLog('Ignoring access code form submission for completion redirect');
                    detectorTrace('form-submit-ignored-access-code-form', () => ({
                        source: 'form listener',
                        form: summarizeTraceForm(this),
                        submitButton: summarizeTraceElement(submitButton)
                    }));
                    return;
                }

                if (markPendingRedirectForFinalSubmit(submitButton, this, quizInfo, 'form listener')) {
                    return;
                } else {
                    debugLog('Form submission detected but not a verified final quiz submit');
                }
            });
        });
    }

    function handlePotentialFinalSubmitForm(event) {
        const form = event.target;
        if (!form || typeof form.querySelector !== 'function') {
            return;
        }

        if (isAccessCodeForm(form)) {
            debugLog('Ignoring access code form submission for completion redirect');
            detectorTrace('form-submit-ignored-access-code-form', () => ({
                source: 'document submit listener',
                form: summarizeTraceForm(form),
                submitButton: summarizeTraceElement(event.submitter || document.activeElement)
            }));
            return;
        }

        const submitButton = event.submitter || document.activeElement;
        detectorTrace('form-submit-event', () => ({
            source: 'document submit listener',
            form: summarizeTraceForm(form),
            submitButton: summarizeTraceElement(submitButton)
        }), 'success');
        const quizInfo = state.finalSubmitClickQuizInfo || extractQuizInfo();
        if (!quizInfo) {
            debugLog('Potential final form submit but quiz info is unavailable');
            detectorTrace('form-submit-no-quiz-info', () => ({
                source: 'document submit listener',
                form: summarizeTraceForm(form),
                submitButton: summarizeTraceElement(submitButton)
            }), 'warn');
            return;
        }

        const marked = markPendingRedirectForFinalSubmit(submitButton, form, quizInfo, 'document submit listener');
        if (marked && quizInfo.contentType === 'CLASSIC_QUIZ' && arbitrateClassicQuizSubmission(
            event,
            form,
            submitButton,
            quizInfo
        )) {
            return;
        }
        if (marked && quizInfo.contentType === 'CLASSIC_QUIZ') {
            setTimeout(() => {
                if (event.defaultPrevented && !state.classicSubmitInFlight) {
                    clearPendingRedirect();
                }
            }, 0);
        }
    }

    function arbitrateClassicQuizSubmission(event, form, submitButton, quizInfo) {
        const action = trustedClassicSubmissionAction(form, quizInfo);
        if (
            event.defaultPrevented
            || state.classicSubmitInFlight
            || !action
            || (!isLikelyFinalQuizSubmit(submitButton, form) && !isLikelyQuizSubmissionForm(form))
        ) {
            return false;
        }

        const originalPreventDefault = event.preventDefault;
        if (typeof originalPreventDefault !== 'function') {
            return false;
        }

        let detectorPreventing = true;
        let downstreamPrevented = false;
        try {
            // Stop the browser's native navigation now, but continue dispatching the
            // event so Canvas can run its own validation and window.confirm flow.
            Object.defineProperty(event, 'preventDefault', {
                configurable: true,
                value: () => {
                    if (!detectorPreventing) {
                        downstreamPrevented = true;
                    }
                    return originalPreventDefault.call(event);
                }
            });
            event.preventDefault();
            detectorPreventing = false;
        } catch (error) {
            try {
                delete event.preventDefault;
            } catch (restoreError) {
                // Fall back to the existing bubble-phase handler if interception is unsupported.
            }
            return false;
        }

        detectorTrace('classic-submit-arbitration-started', { quizInfo }, 'success');
        Promise.resolve().then(() => {
            try {
                delete event.preventDefault;
            } catch (error) {
                // The event is no longer reused after dispatch; restoration is best-effort.
            }

            if (downstreamPrevented) {
                clearPendingRedirect();
                detectorTrace('classic-submit-cancelled-by-canvas', { quizInfo });
                return;
            }

            const currentQuizInfo = extractQuizInfo();
            const currentAction = trustedClassicSubmissionAction(form, quizInfo);
            if (
                !currentQuizInfo
                || !pendingMatchesQuizContext(quizInfo, currentQuizInfo)
                || !currentAction
                || currentAction.href !== action.href
                || state.classicSubmitInFlight
            ) {
                clearPendingRedirect();
                detectorTrace('classic-submit-arbitration-invalidated', { quizInfo }, 'warn');
                return;
            }

            state.classicSubmitInFlight = true;
            markPendingRedirect(quizInfo);
            showSubmissionOverlay('loading', CLASSIC_SUBMISSION_LOADING);
            void submitClassicQuizAndRedirect(form, submitButton, quizInfo, action);
        });
        return true;
    }

    function handleClassicQuizSubmission(event) {
        const form = event.target;
        if (!form || typeof form.querySelector !== 'function' || event.defaultPrevented || isAccessCodeForm(form)) {
            return;
        }

        const quizInfo = state.finalSubmitClickQuizInfo || extractQuizInfo();
        if (!quizInfo || quizInfo.contentType !== 'CLASSIC_QUIZ') {
            return;
        }

        const submitButton = event.submitter || document.activeElement;
        const action = trustedClassicSubmissionAction(form, quizInfo);
        if (!action || (!isLikelyFinalQuizSubmit(submitButton, form) && !isLikelyQuizSubmissionForm(form))) {
            return;
        }

        event.preventDefault();
        if (state.classicSubmitInFlight) {
            return;
        }

        state.classicSubmitInFlight = true;
        markPendingRedirect(quizInfo);
        showSubmissionOverlay('loading', CLASSIC_SUBMISSION_LOADING);
        void submitClassicQuizAndRedirect(form, submitButton, quizInfo, action);
    }

    function trustedClassicSubmissionAction(form, quizInfo) {
        try {
            if ((form.method || 'get').toLowerCase() !== 'post') {
                return null;
            }
            const action = new URL(form.action || form.getAttribute('action') || location.href, location.href);
            const expectedPath = `/courses/${quizInfo.courseId}/quizzes/${quizInfo.quizId}/submissions`;
            return action.origin === location.origin
                && (action.pathname === expectedPath || action.pathname === expectedPath + '/')
                ? action
                : null;
        } catch (error) {
            return null;
        }
    }

    async function submitClassicQuizAndRedirect(form, submitButton, quizInfo, action) {
        try {
            if (typeof window.FormData !== 'function') {
                throw new Error('FormData is unavailable');
            }

            const body = new window.FormData(form);
            if (submitButton && submitButton.name && !body.has(submitButton.name)) {
                body.append(submitButton.name, submitButton.value || '');
            }

            detectorTrace('classic-submit-request-started', { quizInfo }, 'success');
            const response = await fetch(action.href, {
                method: 'POST',
                credentials: 'same-origin',
                redirect: 'follow',
                cache: 'no-store',
                headers: {
                    'Accept': 'text/html'
                },
                body
            });

            if (!await isConfirmedClassicSubmissionResponse(response, quizInfo)) {
                throw new Error('Canvas did not return a confirmed Classic Quiz result');
            }

            detectorTrace('classic-submit-response-confirmed', { quizInfo }, 'success');
            // Canvas confirmed the submission; keep the "Submitting your quiz"
            // overlay up and go straight to the exit page — no extra step.
            clearPendingRedirect();
            redirectToSebExitPage(quizInfo.courseId, quizInfo.quizId, 0);
        } catch (error) {
            state.classicSubmitInFlight = false;
            clearPendingRedirect();
            detectorTrace('classic-submit-response-unconfirmed', { quizInfo }, 'warn');
            debugLog('Canvas did not confirm the Classic Quiz submission', 'warn');
            // A submission may still have reached Canvas, so do not invite a
            // blind retry; let the student return to the quiz and get help.
            showSubmissionOverlay('error', {
                title: 'We could not confirm your submission',
                message: 'Safe Exam Browser is still open. Do not submit again — return to your quiz and ask your proctor or instructor for help.',
                dismissLabel: 'Return to quiz'
            });
        }
    }

    async function isConfirmedClassicSubmissionResponse(response, quizInfo) {
        if (!response || !response.ok || typeof response.text !== 'function' || !response.url) {
            return false;
        }

        try {
            const responseUrl = new URL(response.url, location.href);
            const expectedPath = `/courses/${quizInfo.courseId}/quizzes/${quizInfo.quizId}`;
            if (
                responseUrl.origin !== location.origin
                || (responseUrl.pathname !== expectedPath && responseUrl.pathname !== expectedPath + '/')
            ) {
                return false;
            }

            const html = await response.text();
            const parsed = document.implementation.createHTMLDocument('');
            parsed.documentElement.innerHTML = html;
            return CLASSIC_COMPLETION_PAGE_SELECTORS.some((selector) => parsed.querySelector(selector));
        } catch (error) {
            return false;
        }
    }

    const NEW_QUIZ_SUBMISSION_LOADING = {
        title: 'Submitting your quiz',
        message: 'Waiting for Canvas to confirm your submission. Safe Exam Browser will close automatically once it finishes.'
    };
    const CLASSIC_SUBMISSION_LOADING = {
        title: 'Submitting your quiz',
        message: 'Please wait while your answers are sent to Canvas. Do not close Safe Exam Browser.'
    };

    function showNewQuizSubmissionProgress() {
        showSubmissionOverlay('loading', NEW_QUIZ_SUBMISSION_LOADING);
        clearNewQuizOverlayHideTimer();
        // Canvas owns the New Quiz submission request. If no confirmed
        // completion arrives, surface a recoverable message instead of
        // trapping the student, so they can read any Canvas error and retry.
        state.newQuizOverlayHideTimer = setTimeout(() => {
            state.newQuizOverlayHideTimer = null;
            if (state.exitRedirectScheduledKey || hasCompletionPageIndicator()) {
                return;
            }
            showSubmissionOverlay('error', {
                title: 'Submission not confirmed yet',
                message: 'Safe Exam Browser is still open. Return to your quiz to check for a message from Canvas, then submit again if you need to.',
                dismissLabel: 'Return to quiz'
            });
        }, 10000);
    }

    function clearNewQuizOverlayHideTimer() {
        if (state.newQuizOverlayHideTimer) {
            clearTimeout(state.newQuizOverlayHideTimer);
            state.newQuizOverlayHideTimer = null;
        }
    }

    function hideSubmissionOverlay() {
        const overlay = document.getElementById(CLASSIC_SUBMISSION_OVERLAY_ID);
        if (overlay) {
            overlay.remove();
        }
    }

    function ensureSubmissionOverlayStyle() {
        if (document.getElementById(SUBMISSION_OVERLAY_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = SUBMISSION_OVERLAY_STYLE_ID;
        style.textContent = '@keyframes sebSubmissionSpin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { #seb-classic-submission-overlay [data-seb-spinner="true"] { animation: none !important; } }';
        (document.head || document.body).appendChild(style);
    }

    function showSubmissionOverlay(mode, options = {}) {
        if (!document.body) {
            return;
        }
        ensureSubmissionOverlayStyle();

        let overlay = document.getElementById(CLASSIC_SUBMISSION_OVERLAY_ID);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = CLASSIC_SUBMISSION_OVERLAY_ID;
            overlay.style.cssText = `
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: grid;
                place-items: center;
                padding: 24px;
                background: rgba(12, 18, 32, 0.72);
                color: #182230;
                font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            `;
            document.body.appendChild(overlay);
        }

        const isError = mode === 'error';
        overlay.setAttribute('role', isError ? 'alertdialog' : 'status');
        overlay.setAttribute('aria-live', isError ? 'assertive' : 'polite');

        const iconColor = isError ? '#b42318' : '#075985';
        const iconBackground = isError ? '#fff1f0' : '#e0f2fe';
        const iconBorder = isError ? '#fecdca' : '#bae6fd';
        const title = options.title || (isError ? 'Something went wrong' : 'Working');
        const message = options.message || '';
        const iconInner = isError
            ? '<div style="width: 22px; height: 22px; display: grid; place-items: center; border: 2px solid #b42318; border-radius: 999px; font-size: 15px; font-weight: 900; line-height: 1;">!</div>'
            : '<div data-seb-spinner="true" style="width: 18px; height: 18px; border: 2px solid #bae6fd; border-top-color: #075985; border-radius: 999px; animation: sebSubmissionSpin 0.8s linear infinite;"></div>';
        const dismissButton = isError && options.dismissLabel
            ? `<button type="button" id="seb-submission-dismiss-button" style="margin-top: 18px; min-height: 38px; padding: 0 14px; border: 1px solid #cfd6e4; border-radius: 8px; background: #ffffff; color: #344054; font-weight: 700; cursor: pointer;">${escapeHtml(options.dismissLabel)}</button>`
            : '';

        overlay.innerHTML = `
            <div style="width: min(440px, 100%); background: #ffffff; border: 1px solid #dbe2ea; border-radius: 8px; box-shadow: 0 16px 34px rgba(24,36,56,0.16); padding: 28px; text-align: left;">
                <div style="width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 18px; color: ${iconColor}; background: ${iconBackground}; border: 1px solid ${iconBorder}; border-radius: 8px;">
                    ${iconInner}
                </div>
                <h2 style="margin: 0 0 10px; color: #182230; font-size: 24px; line-height: 1.15; font-weight: 800;">${escapeHtml(title)}</h2>
                <p style="margin: 0; color: #667085; font-size: 15px; line-height: 1.45;">${escapeHtml(message)}</p>
                ${dismissButton}
            </div>
        `;

        const dismiss = document.getElementById('seb-submission-dismiss-button');
        if (dismiss) {
            dismiss.addEventListener('click', hideSubmissionOverlay);
        }
    }

    function handlePotentialFinalSubmitClick(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        const control = target.closest('button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]');
        if (!control) {
            return;
        }

        const form = control.form || (typeof control.closest === 'function' ? control.closest('form') : null);
        if (form && isAccessCodeForm(form)) {
            debugLog('Ignoring access code submit click for completion redirect');
            detectorTrace('submit-click-ignored-access-code-form', () => ({
                form: summarizeTraceForm(form),
                control: summarizeTraceElement(control)
            }));
            return;
        }

        const quizInfo = state.finalSubmitClickQuizInfo || extractQuizInfo();
        if (!quizInfo) {
            debugLog('Verified final submit click but quiz info is unavailable');
            detectorTrace('submit-click-no-quiz-info', () => ({
                form: summarizeTraceForm(form),
                control: summarizeTraceElement(control)
            }), 'warn');
            return;
        }

        markPendingRedirectForFinalSubmit(control, form, quizInfo, 'click listener');
    }

    function markPendingRedirectForFinalSubmit(submitButton, form, quizInfo, source) {
        const newQuizConfirmationSubmit = isNewQuizConfirmationSubmit(submitButton, quizInfo);
        const likelyFinalSubmit = isLikelyFinalQuizSubmit(submitButton, form);
        const likelyQuizSubmissionForm = isLikelyQuizSubmissionForm(form);
        detectorTrace('final-submit-evaluation', () => ({
            source,
            newQuizConfirmationSubmit,
            likelyFinalSubmit,
            likelyQuizSubmissionForm,
            form: summarizeTraceForm(form),
            submitButton: summarizeTraceElement(submitButton),
            quizInfo
        }));

        if (quizInfo.contentType === 'NEW_QUIZ' && !newQuizConfirmationSubmit) {
            debugLog('Ignoring New Quiz submit control outside the final confirmation dialog');
            return false;
        }

        if (quizInfo.contentType !== 'NEW_QUIZ' && !likelyFinalSubmit && !likelyQuizSubmissionForm) {
            return false;
        }

        debugLog('FINAL QUIZ SUBMISSION DETECTED by ' + source + '. Marking pending redirect...', 'success');
        debugLog('Submit control details: ' + describeElement(submitButton));
        markPendingRedirect(quizInfo);
        schedulePostSubmitChecks();
        if (quizInfo.contentType === 'NEW_QUIZ') {
            showNewQuizSubmissionProgress();
        }
        return true;
    }

    function isNewQuizConfirmationSubmit(submitButton, quizInfo) {
        if (!submitButton || quizInfo.contentType !== 'NEW_QUIZ' || typeof submitButton.closest !== 'function') {
            return false;
        }

        const buttonSummary = normalizeElementText(submitButton);
        const automation = submitButton.getAttribute('data-automation') || '';
        const stableConfirmControl = automation === 'sdk-confirmation-modal-confirm';
        if ((!stableConfirmControl && !/(?:^|\s)submit(?:\s|$)/u.test(buttonSummary)) || NON_FINAL_SUBMIT_SIGNALS.some((signal) => buttonSummary.includes(signal))) {
            return false;
        }

        const dialog = submitButton.closest('[data-automation="sdk-confirmation-modal"], [role="dialog"], [aria-modal="true"], dialog');
        if (!dialog || !isVisibleElement(dialog)) {
            return false;
        }

        const dialogSummary = normalizeElementText(dialog);
        return dialogSummary.includes('confirm submission')
            || dialogSummary.includes('are you ready to submit')
            || dialogSummary.includes('upon submission you will not be able to change your answers');
    }

    function isVisibleElement(element) {
        if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') {
            return false;
        }
        const style = element.style || {};
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function isAccessCodeForm(form) {
        if (!form) {
            return false;
        }

        const contextualField = findContextualAccessCodeField(form);
        if (contextualField) {
            return true;
        }

        const fields = form.querySelectorAll(ACCESS_CODE_FIELD_SELECTORS.join(','));
        for (const field of fields) {
            if (isAccessCodeField(field)) {
                return true;
            }
        }

        if (fields.length > 0) {
            debugLog('Ignoring hidden/non-challenge access-code field while classifying form');
        }

        if (isLikelyFinalQuizSubmit(null, form)) {
            return false;
        }

        if (form.querySelector('#access_code_form, .access_code')) {
            return true;
        }

        const formSummary = normalizeElementText(form) + ' ' + (form.action || '').toLowerCase();
        return formSummary.includes('access code')
            || formSummary.includes('access_code')
            || formSummary.includes('access-code')
            || formSummary.includes('quiz_access_code');
    }

    function isLikelyFinalQuizSubmit(submitButton, form) {
        const buttonSummary = normalizeElementText(submitButton);
        if (buttonSummary && NON_FINAL_SUBMIT_SIGNALS.some((signal) => buttonSummary.includes(signal))) {
            return false;
        }

        if (buttonSummary && FINAL_SUBMIT_SIGNALS.some((signal) => buttonSummary.includes(signal))) {
            return true;
        }

        const formIdentity = normalizeFormIdentity(form);
        return FINAL_SUBMIT_SIGNALS.some((signal) => formIdentity.includes(signal));
    }

    function isLikelyQuizSubmissionForm(form) {
        if (!form || !isCanvasQuizPage()) {
            return false;
        }

        const formIdentity = normalizeFormIdentity(form);
        if (formIdentity.includes('quiz') || formIdentity.includes('/quizzes/')) {
            return true;
        }

        return Boolean(form.querySelector('#submit_quiz_button, .submit_quiz_button, [name="quiz_submission"], [name*="question_"], [id*="question_"], [class*="question"]'));
    }

    function normalizeFormIdentity(form) {
        if (!form) {
            return '';
        }

        const className = typeof form.className === 'string' ? form.className : '';
        const parts = [
            form.id,
            form.name,
            form.action,
            className,
            typeof form.getAttribute === 'function' ? form.getAttribute('aria-label') : null,
            typeof form.getAttribute === 'function' ? form.getAttribute('data-testid') : null,
            typeof form.getAttribute === 'function' ? form.getAttribute('title') : null
        ];

        return normalizeTextParts(parts);
    }

    function normalizeElementText(element) {
        if (!element) {
            return '';
        }

        const className = typeof element.className === 'string' ? element.className : '';
        const parts = [
            element.textContent,
            element.value,
            element.id,
            element.name,
            className,
            typeof element.getAttribute === 'function' ? element.getAttribute('aria-label') : null,
            typeof element.getAttribute === 'function' ? element.getAttribute('data-testid') : null,
            typeof element.getAttribute === 'function' ? element.getAttribute('data-automation') : null,
            typeof element.getAttribute === 'function' ? element.getAttribute('title') : null
        ];

        return normalizeTextParts(parts);
    }

    function normalizeTextParts(parts) {
        return parts
            .filter((part) => typeof part === 'string' && part.trim().length > 0)
            .join(' ')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function describeElement(element) {
        if (!element) {
            return 'none';
        }

        const text = normalizeElementText(element);
        const tagName = element.tagName || 'element';
        const type = element.type ? ', type=' + element.type : '';
        return tagName.toLowerCase() + type + ', text="' + text + '"';
    }

    function collectDetectorTraceSnapshot() {
        const quizInfo = extractQuizInfo();
        return {
            quizInfo,
            location: debugSafeUrl(window.location.href),
            pathname: window.location.pathname,
            readyState: document.readyState,
            bodyTextSample: traceSafeString(pageText().slice(0, 300)),
            isCanvasQuizPage: isCanvasQuizPage(),
            isOnTakePage: isOnTakePage(quizInfo),
            looksLikePostSubmitPage: looksLikePostSubmitPage(),
            accessCodeRequirement: checkForAccessCodeRequirement(),
            accessCodeChallenge: isAccessCodeChallengePage(),
            formCount: document.querySelectorAll('form').length,
            buttonCount: document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').length,
            forms: Array.from(document.querySelectorAll('form')).slice(0, 8).map(summarizeTraceForm),
            controls: Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')).slice(0, 12).map(summarizeTraceElement)
        };
    }

    function summarizeTraceForm(form) {
        if (!form) {
            return null;
        }

        const inputs = Array.from(form.querySelectorAll('input, textarea, select')).slice(0, 12);
        const controls = Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')).slice(0, 8);
        return {
            tag: form.tagName ? form.tagName.toLowerCase() : 'form',
            id: traceSafeString(form.id || ''),
            name: traceSafeString(form.name || ''),
            method: traceSafeString(form.method || ''),
            action: debugSafeUrlOrFallback(form.action, ''),
            className: traceSafeString(typeof form.className === 'string' ? form.className : ''),
            normalizedText: traceSafeString(normalizeElementText(form)),
            inputCount: form.querySelectorAll('input, textarea, select').length,
            accessCodeSelectorMatches: form.querySelectorAll(ACCESS_CODE_FIELD_SELECTORS.join(',')).length,
            inputs: inputs.map(summarizeTraceInput),
            controls: controls.map(summarizeTraceElement)
        };
    }

    function summarizeTraceInput(input) {
        if (!input) {
            return null;
        }

        return {
            tag: input.tagName ? input.tagName.toLowerCase() : 'input',
            type: traceSafeString(input.type || ''),
            id: traceSafeString(input.id || ''),
            name: traceSafeString(input.name || ''),
            placeholder: traceSafeString(input.placeholder || ''),
            ariaLabel: traceSafeString(typeof input.getAttribute === 'function' ? input.getAttribute('aria-label') || '' : ''),
            valueLength: typeof input.value === 'string' ? input.value.length : 0,
            checked: input.checked === true
        };
    }

    function summarizeTraceElement(element) {
        if (!element) {
            return null;
        }

        return {
            tag: element.tagName ? element.tagName.toLowerCase() : 'element',
            type: traceSafeString(element.type || ''),
            id: traceSafeString(element.id || ''),
            name: traceSafeString(element.name || ''),
            className: traceSafeString(typeof element.className === 'string' ? element.className : ''),
            role: traceSafeString(typeof element.getAttribute === 'function' ? element.getAttribute('role') || '' : ''),
            automation: traceSafeString(typeof element.getAttribute === 'function' ? element.getAttribute('data-automation') || '' : ''),
            text: traceSafeString(normalizeElementText(element)),
            disabled: element.disabled === true
        };
    }

    function watchForCompletionIndicators(quizInfo) {
        void quizInfo;
        debugLog('Setting up completion indicator watcher');
        const observer = new MutationObserver(() => {
            if (looksLikePostSubmitPage()) {
                debugLog('Canvas assessment results page detected', 'success');
                setTimeout(maybeRedirectAfterSubmission, 300);
                return;
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        state.completionObserver = observer;

        setTimeout(() => {
            if (state.completionObserver === observer) {
                observer.disconnect();
                state.completionObserver = null;
            }
        }, 600000);
    }

    function hasCompletionPageIndicator() {
        return COMPLETION_PAGE_SELECTORS.some((selector) => document.querySelector(selector));
    }

    function monitorUrlForCompletion(quizInfo) {
        void quizInfo;
        debugLog('Setting up URL completion monitor');

        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl === lastUrl) {
                return;
            }

            debugLog('URL changed from ' + lastUrl + ' to ' + currentUrl);
            lastUrl = currentUrl;

            // maybeRedirectAfterSubmission carries all of the completion
            // gating, including the unflagged New Quiz route check that has
            // no pending flag for looksLikePostSubmitPage to key off.
            setTimeout(maybeRedirectAfterSubmission, 300);
        });

        urlObserver.observe(document, { subtree: true, childList: true });
        state.urlCompletionObserver = urlObserver;
    }

    function disconnectCompletionObservers() {
        if (state.completionObserver) {
            state.completionObserver.disconnect();
            state.completionObserver = null;
        }
        if (state.urlCompletionObserver) {
            state.urlCompletionObserver.disconnect();
            state.urlCompletionObserver = null;
        }
    }

    async function enforceSebRequirement() {
        debugLog('=== SEB DETECTOR STARTED ===');
        debugLog('Page URL: ' + debugSafeUrl(window.location.href));
        debugLog('User Agent: ' + navigator.userAgent.substring(0, 100) + '...');

        if (!isCanvasQuizPage()) {
            debugLog('Not a quiz page, skipping');
            return;
        }

        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            debugLog('Could not extract quiz info', 'warn');
            return;
        }

        if (!isStudentAssessmentAccessPage(quizInfo)) {
            debugLog('Not a student assessment access route, skipping detector behavior');
            return;
        }

        trackQuizContext(quizInfo);
        debugLog('Quiz info: Course ' + quizInfo.courseId + ', Quiz ' + quizInfo.quizId, 'success');

        const hasAccessCodeRequirement = checkForAccessCodeRequirement();
        const hasAccessCodeChallenge = isAccessCodeChallengePage();
        const sebDetected = isSafeBrowser();
        const debugOverrideAllowed = isNonSebDebugBehaviorAllowed();

        if (hasAccessCodeChallenge || (!sebDetected && hasAccessCodeRequirement)) {
            state.accessCodeChallengeHandledKey = quizKey(quizInfo);
        }

        if (sebDetected) {
            debugLog('SEB DETECTED! Proceeding with auto-fill and completion handler', 'success');

            if (hasAccessCodeChallenge) {
                debugLog('Access code screen detected, delaying exam tools sidebar');
                removeExamToolsSidebar();
                showAccessCodeProgressOverlay();
                autoFillAccessCode();
            } else if (quizInfo.contentType === 'NEW_QUIZ' && !isOnTakePage(quizInfo) && !looksLikePostSubmitPage()) {
                scheduleNewQuizAccessCodePrime(quizInfo);
            } else if (isOnTakePage(quizInfo)) {
                setupExamToolsSidebar(quizInfo);
                primeExamSessionCapabilities(quizInfo);
            } else {
                debugLog('Not on an active quiz-taking page; hiding exam tools and skipping access-code redemption');
                removeExamToolsSidebar();
            }

            setTimeout(() => {
                setupQuizCompletionHandler();
            }, 3000);
            return;
        }

        debugLog('Non-SEB browser detected, checking for access code requirement');
        if (hasAccessCodeRequirement) {
            debugLog('Access code requirement detected, verifying stored Safe Online Exam requirement');
            if (await shouldShowSebLaunchPrompt(quizInfo)) {
                debugLog('Stored Safe Online Exam requirement confirmed, showing browser launch prompt');
                redirectToSebDownload(quizInfo.courseId, quizInfo.quizId);
            } else {
                debugLog('No stored Safe Online Exam requirement confirmed, allowing normal Canvas access');
            }
        } else if (debugOverrideAllowed) {
            debugLog('Debug URL override active; running non-SEB completion handlers for diagnostics', 'warn');
            setupExamToolsSidebar(quizInfo);
            setTimeout(() => {
                setupQuizCompletionHandler();
            }, 3000);
        } else {
            debugLog('No access code requirement detected, allowing normal access');
        }
    }

    function trackQuizContext(quizInfo) {
        const key = quizKey(quizInfo);
        if (state.currentQuizKey === key) {
            return;
        }

        resetAccessCodeAutomation();
        state.dismissedLaunchPromptKey = null;
        state.currentQuizKey = key;
        disconnectAccessCodeObserver();
        state.accessCodeRequestKey = null;
        state.accessCodeRequestPromise = null;
        state.accessCodeChallengeHandledKey = null;
    }

    function scheduleLateAccessCodeCheck() {
        if (state.lateAccessCodeCheckTimer) {
            return;
        }

        state.lateAccessCodeCheckTimer = setTimeout(() => {
            state.lateAccessCodeCheckTimer = null;
            void handleLateAccessCodeChallenge();
        }, LATE_ACCESS_CODE_CHECK_DELAY_MS);
    }

    async function handleLateAccessCodeChallenge() {
        if (!isCanvasQuizPage()) {
            return;
        }

        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            return;
        }

        if (!isStudentAssessmentAccessPage(quizInfo)) {
            return;
        }

        trackQuizContext(quizInfo);
        const hasAccessCodeRequirement = checkForAccessCodeRequirement();
        const hasAccessCodeChallenge = isAccessCodeChallengePage();
        const sebDetected = isSafeBrowser();

        if (sebDetected && !hasAccessCodeChallenge) {
            if (quizInfo.contentType === 'NEW_QUIZ' && !isOnTakePage(quizInfo) && !looksLikePostSubmitPage()) {
                scheduleNewQuizAccessCodePrime(quizInfo);
                return;
            }
            if (isOnTakePage(quizInfo)) {
                setupExamToolsSidebar(quizInfo);
                primeExamSessionCapabilities(quizInfo);
            } else {
                removeExamToolsSidebar();
            }
            return;
        }

        if (!hasAccessCodeChallenge && !hasAccessCodeRequirement) {
            return;
        }

        const key = quizKey(quizInfo);
        if (state.accessCodeChallengeHandledKey === key) {
            return;
        }

        state.accessCodeChallengeHandledKey = key;
        debugLog('Late-rendered access code requirement detected', 'success');
        detectorTrace('late-access-code-requirement-detected', { quizInfo }, 'success');

        if (!sebDetected) {
            debugLog('Verifying stored Safe Online Exam requirement for late-rendered access code challenge');
            if (await shouldShowSebLaunchPrompt(quizInfo)) {
                debugLog('Stored Safe Online Exam requirement confirmed, showing browser launch prompt');
                redirectToSebDownload(quizInfo.courseId, quizInfo.quizId);
            } else {
                debugLog('No stored Safe Online Exam requirement confirmed, allowing normal Canvas access');
            }
            return;
        }

        debugLog('Late-rendered access code challenge detected in SEB; starting auto-fill');
        removeExamToolsSidebar();
        autoFillAccessCode();
    }

    function setupAccessCodeObserver(accessCode, shouldShowMissingFieldError) {
        debugLog('Setting up mutation observer for access code field');
        disconnectAccessCodeObserver();
        let completed = false;

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type !== 'childList') {
                    continue;
                }
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) {
                        continue;
                    }

                    const selectorList = ACCESS_CODE_FIELD_SELECTORS
                        .concat(['input[type="password"]', 'input[type="text"]'])
                        .join(', ');
                    const nodeMatches = typeof node.matches === 'function' && node.matches(selectorList);
                    const hasCandidate = nodeMatches || (node.querySelector ? node.querySelector(selectorList) : null);
                    const accessCodeField = hasCandidate ? findAccessCodeField() : null;

                    if (accessCodeField && isAccessCodeField(accessCodeField)) {
                        debugLog('Access code field detected via mutation observer', 'success');
                        completed = true;
                        fillAccessCodeField(accessCode);
                        disconnectAccessCodeObserver();
                        return;
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        state.accessCodeObserver = observer;
        state.accessCodeObserverTimer = setTimeout(() => {
            if (state.accessCodeObserver === observer) {
                disconnectAccessCodeObserver();
            }
            if (!completed && (shouldShowMissingFieldError || shouldAttemptAccessCodeAutofill())) {
                releaseAccessCodeAutomation();
                showAccessCodeErrorOverlay('The Canvas access-code field could not be found. Reload the quiz in SEB, or ask your instructor for help.');
            } else {
                releaseAccessCodeAutomation();
                hideAccessCodeProgressOverlay();
            }
            debugLog('Mutation observer stopped after timeout');
        }, 30000);
    }

    function disconnectAccessCodeObserver() {
        if (state.accessCodeObserver) {
            state.accessCodeObserver.disconnect();
            state.accessCodeObserver = null;
        }
        if (state.accessCodeObserverTimer) {
            clearTimeout(state.accessCodeObserverTimer);
            state.accessCodeObserverTimer = null;
        }
    }

    function continueInitialization() {
        debugLog('=== REDIRECT DEBUG INFO ===');
        debugLog('Is on take page: ' + isOnTakePage());
        debugLog('Looks like post-submit: ' + looksLikePostSubmitPage());
        debugLog('Pending redirect: ' + JSON.stringify(getPendingRedirect()));
        debugLog('Session storage available: ' + (typeof sessionStorage !== 'undefined'));

        setTimeout(() => {
            if (!state.debugMode) {
                return;
            }
            const forms = document.querySelectorAll('form');
            debugLog('=== FORMS ON PAGE ===');
            forms.forEach((form, index) => {
                debugLog('Form ' + index + ': action=' + debugSafeUrlOrFallback(form.action, 'none') + ', method=' + (form.method || 'none'));
            });

            const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
            debugLog('=== BUTTONS ON PAGE ===');
            buttons.forEach((button, index) => {
                const text = button.textContent || button.value || button.id || 'no text';
                debugLog('Button ' + index + ': "' + text + '" (type: ' + button.type + ')');
            });
        }, 2000);

        SEB_WINDOW_PROPERTIES.forEach((prop) => {
            if (window[prop]) {
                debugLog('Found SEB property: ' + prop + ' = ' + typeof window[prop]);
            }
        });

        if (document.readyState === 'loading') {
            debugLog('DOM still loading, waiting for DOMContentLoaded');
            document.addEventListener('DOMContentLoaded', () => {
                void enforceSebRequirement();
                setTimeout(maybeRedirectAfterSubmission, 300);
            }, { once: true });
        } else {
            debugLog('DOM already loaded, running immediately');
            void enforceSebRequirement();
            setTimeout(maybeRedirectAfterSubmission, 300);
        }

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && shouldAttemptAccessCodeAutofill()) {
                debugLog('Page became visible, checking for auto-fill');
                autoFillAccessCode();
            }
            if (!document.hidden) {
                const quizInfo = extractQuizInfo();
                if (quizInfo && isSafeBrowser()) {
                    scheduleNewQuizAccessCodePrime(quizInfo, 0);
                }
                setTimeout(maybeRedirectAfterSubmission, 200);
            }
        });

        window.addEventListener('pagehide', flushDetectorTrace);
        window.addEventListener('beforeunload', flushDetectorTrace);
        installSpaObserver();
        installDiagnosticTracing();
    }

    function installDiagnosticTracing() {
        if (!DIAGNOSTIC_TRACING) {
            return;
        }

        // Capture-phase click tracer: records every button-like activation the
        // top document can see, so a missed final-submit click is diagnosable.
        document.addEventListener('click', (event) => {
            try {
                const target = event.target;
                // Only button-like controls are traced: summarizing arbitrary
                // click targets could capture student-typed answer text.
                const control = target && typeof target.closest === 'function'
                    ? target.closest('button, input[type="submit"], input[type="button"], [role="button"], a')
                    : null;
                if (!control) {
                    return;
                }
                const dialog = typeof control.closest === 'function'
                    ? control.closest('[role="dialog"], [aria-modal="true"], dialog, [data-automation*="modal"]')
                    : null;
                detectorTrace('diagnostic-click', () => ({
                    pathname: location.pathname,
                    control: summarizeTraceElement(control),
                    dialog: dialog ? summarizeTraceElement(dialog) : null
                }));
            } catch (error) {
                // Diagnostics must never affect quiz behavior.
            }
        }, true);

        // DOM heartbeat: emits a compact top-document snapshot whenever the
        // observable page state changes, for up to 30 minutes.
        let lastSignature = '';
        const heartbeat = setInterval(() => {
            try {
                const snapshot = collectDiagnosticSnapshot();
                const signature = JSON.stringify([
                    snapshot.pathname,
                    snapshot.iframes,
                    snapshot.markers,
                    snapshot.gates
                ]);
                if (signature !== lastSignature) {
                    lastSignature = signature;
                    detectorTrace('diagnostic-dom-snapshot', snapshot);
                    flushDetectorTrace();
                }
            } catch (error) {
                // Diagnostics must never affect quiz behavior.
            }
        }, 2000);
        setTimeout(() => clearInterval(heartbeat), 30 * 60 * 1000);
    }

    function collectDiagnosticSnapshot() {
        const quizInfo = extractQuizInfo();
        return {
            pathname: location.pathname,
            quizInfo,
            iframes: Array.from(document.querySelectorAll('iframe')).slice(0, 10).map((frame) => ({
                src: debugSafeUrlOrFallback(frame.src, '[no-src]'),
                id: frame.id || '',
                title: frame.title || '',
                className: typeof frame.className === 'string' ? frame.className.slice(0, 120) : '',
                width: frame.clientWidth,
                height: frame.clientHeight
            })),
            markers: COMPLETION_PAGE_SELECTORS.map((selector) => Boolean(document.querySelector(selector))),
            gates: {
                sebDetected: isSafeBrowser(),
                pendingRedirect: Boolean(getPendingRedirect()),
                exitGrantPrimed: quizInfo
                    ? Boolean(readExamSessionCapabilities(quizInfo.courseId, quizInfo.quizId).exitGrant)
                    : false,
                postAttemptRoute: quizInfo ? isNewQuizPostAttemptRoute(quizInfo) : false,
                onTakePage: isOnTakePage(quizInfo)
            },
            buttons: Array.from(
                document.querySelectorAll('button, input[type="submit"], [role="button"]')
            ).slice(0, 12).map(summarizeTraceElement)
        };
    }

    function installSpaObserver() {
        if (state.spaObserver) {
            return;
        }

        let lastUrl = location.href;
        state.spaObserver = new MutationObserver(() => {
            const url = location.href;
            scheduleLateAccessCodeCheck();

            if (url !== lastUrl) {
                lastUrl = url;
                if (state.spaRerunTimer) {
                    clearTimeout(state.spaRerunTimer);
                }
                state.spaRerunTimer = setTimeout(() => {
                    void enforceSebRequirement();
                    setTimeout(maybeRedirectAfterSubmission, 200);
                }, 1000);
            }
        });
        state.spaObserver.observe(document, { subtree: true, childList: true });
    }

    function pageText() {
        return (document.body && document.body.textContent || '').toLowerCase();
    }

    function quizKey(quizInfo) {
        return quizInfo.courseId + ':' + quizInfo.quizId + ':' + (quizInfo.attemptId || 'no-attempt');
    }

    function pendingMatchesQuizContext(pending, quizInfo) {
        if (pending.courseId !== quizInfo.courseId || pending.quizId !== quizInfo.quizId) {
            return false;
        }
        return !pending.attemptId || !quizInfo.attemptId || pending.attemptId === quizInfo.attemptId;
    }

    function quizInfoFromPending(pending) {
        const parsedNewQuiz = /^newquiz:([^:]+):([^:]+)$/u.exec(pending.quizId);
        if (pending.contentType === 'NEW_QUIZ' || parsedNewQuiz) {
            return {
                courseId: pending.courseId,
                assignmentId: parsedNewQuiz ? parsedNewQuiz[2] : null,
                attemptId: pending.attemptId || null,
                quizId: pending.quizId,
                contentType: 'NEW_QUIZ'
            };
        }
        return {
            courseId: pending.courseId,
            quizId: pending.quizId,
            contentType: 'CLASSIC_QUIZ'
        };
    }

    function escapeRegexValue(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function errorMessage(error) {
        return error && error.message ? error.message : String(error);
    }

    function debugSafeUrl(value) {
        try {
            const url = new URL(value);
            url.search = '';
            url.hash = '';
            if (url.pathname.startsWith('/seb/exit/session/')) {
                const segments = url.pathname.split('/');
                segments[segments.length - 1] = '[redacted]';
                url.pathname = segments.join('/');
            }
            return url.toString();
        } catch (error) {
            return '[unparseable-url]';
        }
    }

    function debugSafeUrlOrFallback(value, fallback) {
        return value ? debugSafeUrl(value) : fallback;
    }

    initializeScript();
})();
