/**
 * Safe Online Exam browser detection and redirection script
 *
 * Injected by a Canvas theme loader. Keep this file dependency-free because it
 * runs inside Canvas and Safe Exam Browser.
 */
(function () {
    'use strict';

    const SEB_DOWNLOAD_BASE_URL = "__SEB_BASE_URL__";
    const LTI_CLIENT_ID = "__LTI_CLIENT_ID__";
    const LTI_DEPLOYMENT_ID_CHECKING_ENABLED = "__LTI_DEPLOYMENT_ID_CHECKING_ENABLED__";
    const LTI_DEPLOYMENT_IDS = "__LTI_DEPLOYMENT_IDS__";
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
    const CANVAS_EXTERNAL_TOOLS_MAX_PAGES = 20;
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

    const COMPLETION_PAGE_SELECTORS = [
        '[aria-label="Assessment results page" i]',
        '[data-automation="sdk-result-list-title"]'
    ];
    const CLASSIC_COMPLETION_PAGE_SELECTORS = [
        '.quiz-submission',
        '.muted-notice'
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
        launchPromptRequestKey: null,
        courseNavigationUrlRequests: new Map(),
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

    // Console output is deliberately structural only. Call-site descriptions make
    // the control flow readable, but are not emitted because they can contain
    // Canvas URLs, element metadata, user agents, or upstream error text. Use the
    // separately sanitized detectorTrace channel for diagnostic detail.
    function debugLog(_message, type = 'info') {
        if (!state.debugMode && type !== 'warn' && type !== 'error') {
            return;
        }

        void _message;
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
