/**
 * Canvas SEB Browser Detection and Redirection Script
 *
 * Injected by a Canvas theme loader. Keep this file dependency-free because it
 * runs inside Canvas and Safe Exam Browser.
 */
(function () {
    'use strict';

    const SEB_DOWNLOAD_BASE_URL = "__SEB_BASE_URL__";
    const SERVER_DEBUG_ENABLED = "__SEB_DEBUG_ENABLED__";
    const DETECTOR_TRACE_ENDPOINT = `${SEB_DOWNLOAD_BASE_URL}/api/debug/canvas-detector-trace`;
    const DETECTOR_TRACE_BATCH_SIZE = 15;
    const FINAL_SUBMIT_DIRECT_REDIRECT_DELAY_MS = 1000;
    const REDIRECT_FLAG_KEY = 'seb_pending_redirect';
    const SENSITIVE_TRACE_KEY_PATTERN = /(?:access.?code|authorization|config.?key|cookie|encryption.?key|id.?token|password|private.?key|proof(?:.?token)?|secret|token|(?:^|[_-])state(?:$|[_-]))/iu;
    const ACCESS_CODE_PROGRESS_OVERLAY_ID = 'seb-access-code-progress-overlay';
    const ACCESS_CODE_PROGRESS_CARD_ID = 'seb-access-code-progress-card';
    const ACCESS_CODE_PROGRESS_STYLE_ID = 'seb-access-code-progress-style';
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
    const ACCESS_CODE_EXCLUDE_SIGNALS = [
        'email',
        'username',
        'login',
        'signin',
        'google',
        'oauth',
        'sso'
    ];
    const ACCESS_CODE_SUBMIT_SELECTORS = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button[name*="submit"]',
        '.btn-primary',
        '.submit-button',
        '[data-testid*="submit"]'
    ];
    const ACCESS_CODE_CONTAINER_SELECTOR = '.quiz-access, .access-code-container, .modal-body, .form-container';

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
    const POST_SUBMIT_URL_PATTERNS = [
        /\/quizzes\/\d+\/submissions\b/,
        /\/quizzes\/\d+\/results\b/,
        /\/quizzes\/\d+\/history\b/,
        /\/assignments\/\d+\/submissions\b/,
        /\/assignments\/\d+\/results\b/,
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
        pendingRedirectKey: null,
        pendingRedirectMarkedAt: 0,
        finalSubmitDirectRedirectTimer: null,
        postSubmitTimers: [],
        spaObserver: null,
        spaRerunTimer: null,
        detectorTraceId: null,
        detectorTraceSequence: 0,
        detectorTraceQueue: [],
        detectorTraceTimer: null,
        examToolWindows: new Map()
    };

    function initializeScript() {
        loadDebugStatus();

        debugLog('Canvas SEB Detector Script Loaded!', 'success');
        debugLog('Version: 3.0 hardened detector');
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
        state.debugMode = SERVER_DEBUG_ENABLED === true || SERVER_DEBUG_ENABLED === 'true';
        if (urlRequestedDebug && state.debugMode) {
            debugLog('Debug mode requested by URL parameter and allowed by server flag');
        }
        return state.debugMode;
    }

    function debugLog(message, type = 'info') {
        if (!state.debugMode && type !== 'warn' && type !== 'error') {
            return;
        }

        detectorTrace('debug-log', { message }, type);
        const logger = type === 'warn' ? console.warn : type === 'error' ? console.error : console.log;
        logger('Canvas SEB Detector:', message);
    }

    function detectorTrace(event, details = {}, type = 'info') {
        if (!state.debugMode) {
            return;
        }

        try {
            const resolvedDetails = typeof details === 'function' ? details() : details;
            state.detectorTraceQueue.push({
                seq: ++state.detectorTraceSequence,
                at: new Date().toISOString(),
                event,
                type,
                url: debugSafeUrl(window.location.href),
                readyState: document.readyState,
                hidden: document.hidden === true,
                currentQuizKey: state.currentQuizKey,
                pendingRedirectKey: state.pendingRedirectKey,
                sebDetected: state.sebDetected,
                details: sanitizeTraceValue(resolvedDetails)
            });

            if (state.detectorTraceQueue.length >= DETECTOR_TRACE_BATCH_SIZE) {
                flushDetectorTrace();
            } else {
                scheduleDetectorTraceFlush();
            }
        } catch (error) {
            // Tracing is diagnostic only; it must never affect quiz behavior.
        }
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

        const events = state.detectorTraceQueue.splice(0, DETECTOR_TRACE_BATCH_SIZE);
        const payload = {
            traceId: getDetectorTraceId(),
            source: 'canvas-seb-detector',
            version: '3.0 hardened detector',
            pageUrl: debugSafeUrl(window.location.href),
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
        clearFinalSubmitDirectRedirectTimer();
    }

    function getPendingRedirect() {
        try {
            const raw = sessionStorage.getItem(REDIRECT_FLAG_KEY);
            if (!raw) {
                return null;
            }
            const data = JSON.parse(raw);
            if (!data || !data.courseId || !data.quizId || !data.ts || Date.now() - data.ts > 10 * 60 * 1000) {
                clearPendingRedirect();
                return null;
            }
            return data;
        } catch (error) {
            debugLog('Failed to get pending redirect: ' + errorMessage(error), 'warn');
            return null;
        }
    }

    function isOnTakePage() {
        return /\/courses\/\d+\/quizzes\/\d+\/take\b/.test(location.pathname);
    }

    function looksLikePostSubmitPage() {
        const url = location.href;
        if (POST_SUBMIT_URL_PATTERNS.some((pattern) => pattern.test(url))) {
            debugLog('Post-submit page detected via URL pattern', 'success');
            return true;
        }

        const text = pageText();
        for (const indicator of COMPLETION_TEXT_INDICATORS) {
            if (text.includes(indicator)) {
                debugLog('Post-submit page detected via text: ' + indicator, 'success');
                return true;
            }
        }

        return false;
    }

    function maybeRedirectAfterSubmission() {
        const pending = getPendingRedirect();
        const postSubmit = looksLikePostSubmitPage();
        const leftTakePage = !isOnTakePage();

        detectorTrace('redirect-check', () => ({
            pending: pending ? { courseId: pending.courseId, quizId: pending.quizId, ageMs: Date.now() - pending.ts } : null,
            postSubmit,
            leftTakePage,
            snapshot: collectDetectorTraceSnapshot()
        }));

        if (!pending) {
            if (postSubmit && isSafeBrowser()) {
                const quizInfo = extractQuizInfo();
                if (quizInfo) {
                    debugLog('Post-submit page detected in SEB without pending flag; redirecting to exit page', 'warn');
                    redirectToSebExitPage(quizInfo.courseId, quizInfo.quizId);
                }
            }
            return;
        }

        debugLog('Checking for post-submission redirect...');
        debugLog('On take page: ' + isOnTakePage() + ', Looks like post-submit: ' + postSubmit);

        if (!postSubmit && !leftTakePage) {
            debugLog('Post-submission conditions not yet met, waiting...');
            return;
        }

        debugLog('Post-submission detected. Redirecting to SEB exit page.', 'success');
        clearPendingRedirect();
        redirectToSebExitPage(pending.courseId, pending.quizId);
    }

    function redirectToSebExitPage(courseId, quizId, delayMs = 500) {
        const exitUrl = `${SEB_DOWNLOAD_BASE_URL}/seb/exit/${courseId}/${quizId}`;
        detectorTrace('exit-redirect-scheduled', { courseId, quizId, exitUrl, delayMs }, 'success');
        flushDetectorTrace();
        setTimeout(() => {
            debugLog('Executing redirect to SEB exit page...', 'success');
            window.location.assign(exitUrl);
        }, delayMs);
    }

    function scheduleFinalSubmitDirectRedirect(quizInfo, source) {
        if (!isSafeBrowser() || !isVerifiedSubmitEventSource(source)) {
            return;
        }

        clearFinalSubmitDirectRedirectTimer();
        detectorTrace('final-submit-direct-redirect-armed', {
            quizInfo,
            source,
            delayMs: FINAL_SUBMIT_DIRECT_REDIRECT_DELAY_MS
        }, 'success');

        state.finalSubmitDirectRedirectTimer = setTimeout(() => {
            state.finalSubmitDirectRedirectTimer = null;
            const pending = getPendingRedirect();
            const pendingMatches = Boolean(pending && pending.courseId === quizInfo.courseId && pending.quizId === quizInfo.quizId);
            const currentQuizInfo = extractQuizInfo();
            const stillSameQuiz = state.currentQuizKey === quizKey(quizInfo) || (currentQuizInfo && quizKey(currentQuizInfo) === quizKey(quizInfo));
            const accessCodeChallenge = isAccessCodeChallengePage();
            const sebDetected = isSafeBrowser();

            detectorTrace('final-submit-direct-redirect-check', () => ({
                pending: pending ? { courseId: pending.courseId, quizId: pending.quizId, ageMs: Date.now() - pending.ts } : null,
                pendingMatches,
                stillSameQuiz,
                accessCodeChallenge,
                sebDetected,
                snapshot: collectDetectorTraceSnapshot()
            }));

            if (!pendingMatches || !stillSameQuiz || accessCodeChallenge || !sebDetected) {
                detectorTrace('final-submit-direct-redirect-skipped', {
                    pendingMatches,
                    stillSameQuiz,
                    accessCodeChallenge,
                    sebDetected
                }, 'warn');
                return;
            }

            debugLog('Verified final submit sent; redirecting directly to SEB exit page.', 'success');
            detectorTrace('final-submit-direct-redirect', { quizInfo }, 'success');
            clearPendingRedirect();
            redirectToSebExitPage(quizInfo.courseId, quizInfo.quizId, 0);
        }, FINAL_SUBMIT_DIRECT_REDIRECT_DELAY_MS);
    }

    function clearFinalSubmitDirectRedirectTimer() {
        if (state.finalSubmitDirectRedirectTimer) {
            clearTimeout(state.finalSubmitDirectRedirectTimer);
            state.finalSubmitDirectRedirectTimer = null;
        }
    }

    function isVerifiedSubmitEventSource(source) {
        return source === 'document submit listener' || source === 'form listener';
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
            style.textContent = '@keyframes sebProgressSpin { to { transform: rotate(360deg); } }';
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
            ? escapeHtml(message || 'The access code could not be entered automatically. Reload the quiz in Safe Exam Browser, or ask your instructor for help.')
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
                            : '<div style="width: 18px; height: 18px; border: 2px solid #bae6fd; border-top-color: #075985; border-radius: 999px; animation: sebProgressSpin 0.8s linear infinite;"></div>'
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
                hideAccessCodeProgressOverlay();
                autoFillAccessCode();
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

        const assignmentMatch = url.match(/\/courses\/(\d+)\/assignments\/(\d+)/u);
        if (assignmentMatch) {
            return {
                courseId: assignmentMatch[1],
                assignmentId: assignmentMatch[2],
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

    function findAccessCodeField() {
        for (const selector of ACCESS_CODE_FIELD_SELECTORS) {
            const field = document.querySelector(selector);
            debugLog('Trying selector: ' + selector + ' - Found: ' + (field ? 'YES' : 'NO'));

            if (field && isAccessCodeField(field)) {
                debugLog('Found valid access code field with selector: ' + selector, 'success');
                return field;
            }
        }

        return null;
    }

    function isAccessCodeChallengePage() {
        if (findAccessCodeField()) {
            return true;
        }

        if (document.querySelector('#access_code_form, form[action*="access_code"], form[action*="access-code"], .access_code')) {
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

        if (looksLikePostSubmitPage()) {
            return false;
        }

        return isAccessCodeChallengePage();
    }

    function redirectToSebDownload(courseId, quizId) {
        const currentUrl = encodeURIComponent(window.location.href);
        const appBaseUrl = SEB_DOWNLOAD_BASE_URL.replace(/\/+$/, '');
        const configFileUrl = `${appBaseUrl}/seb/config/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}.seb?canvas_url=${currentUrl}`;
        const sebLaunchUrl = configFileUrl
            .replace(/^https:\/\//i, 'sebs://')
            .replace(/^http:\/\//i, 'seb://');
        const countdownSeconds = 2;

        const message = document.createElement('div');
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
                <div style="width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 18px; color: #075985; background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 8px; font-weight: 800;">
                    SEB
                </div>
                <p style="margin: 0 0 6px; color: #0b63ce; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0;">
                    Secure assessment
                </p>
                <h2 style="color: #182230; margin: 0 0 12px; font-size: 24px; line-height: 1.15; font-weight: 800;">
                    Safe Exam Browser Required
                </h2>
                <p style="margin: 0 0 18px; font-size: 15px; line-height: 1.45; color: #667085;">
                    Opening SEB now. If prompted, allow your browser to open Safe Exam Browser.
                </p>
                </div>
                <div style="display: grid; gap: 12px; padding: 14px 32px 18px; background: #f8fafc; border-top: 1px solid #dbe2ea;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
                        <div style="min-width: 180px;">
                            <strong style="display: block; color: #182230; font-size: 13px;">Opening automatically</strong>
                            <span id="seb-launch-countdown-text" style="display: block; margin-top: 2px; color: #667085; font-size: 12px; font-weight: 700;">${countdownSeconds}s remaining</span>
                        </div>
                        <a href="${escapeHtml(sebLaunchUrl)}" style="min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; border-radius: 8px; background: #0b63ce; color: #ffffff; text-decoration: none; font-weight: 800;">
                        Open SEB
                        </a>
                    </div>
                    <div style="height: 7px; overflow: hidden; background: #e7ecf2; border-radius: 999px;">
                        <span id="seb-launch-countdown-bar" style="width: 0%; height: 100%; display: block; background: #0b63ce; border-radius: inherit; transition: width 220ms ease;"></span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(message);

        let remaining = countdownSeconds;
        const countdownText = document.getElementById('seb-launch-countdown-text');
        const countdownBar = document.getElementById('seb-launch-countdown-bar');
        const updateCountdown = () => {
            const elapsed = countdownSeconds - remaining;
            if (countdownBar) {
                countdownBar.style.width = `${Math.min(100, (elapsed / countdownSeconds) * 100)}%`;
            }
            if (countdownText) {
                countdownText.textContent = remaining > 0 ? `${remaining}s remaining` : 'Opening now';
            }
        };
        updateCountdown();
        const interval = setInterval(() => {
            remaining = Math.max(0, remaining - 1);
            updateCountdown();
            if (remaining === 0) {
                clearInterval(interval);
            }
        }, 1000);
        setTimeout(() => {
            if (countdownBar) {
                countdownBar.style.width = '100%';
            }
            window.location.assign(sebLaunchUrl);
        }, countdownSeconds * 1000);
    }

    async function setupExamToolsSidebar(quizInfo) {
        if (!quizInfo || document.getElementById(EXAM_TOOLS_SIDEBAR_ID)) {
            return;
        }

        const tools = await fetchExamTools(quizInfo.courseId, quizInfo.quizId);
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

    async function fetchExamTools(courseId, quizId) {
        try {
            const url = `${SEB_DOWNLOAD_BASE_URL}/api/seb/tools/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}`;
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) {
                debugLog('Failed to fetch exam tools: ' + response.status, 'warn');
                return [];
            }
            const data = await response.json();
            return Array.isArray(data.tools) ? data.tools.filter(isUsableExamTool) : [];
        } catch (error) {
            debugLog('Error fetching exam tools: ' + errorMessage(error), 'warn');
            return [];
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

        const title = document.createElement('div');
        title.className = 'seb-tools-title';
        const titleStrong = document.createElement('strong');
        titleStrong.textContent = 'Exam tools';
        const titleSmall = document.createElement('small');
        titleSmall.textContent = `${tools.length} available`;
        title.append(titleStrong, titleSmall);

        const controls = document.createElement('div');
        controls.className = 'seb-tools-controls';
        const collapseButton = document.createElement('button');
        collapseButton.type = 'button';
        collapseButton.className = 'seb-tools-icon-button';
        collapseButton.title = 'Collapse tools';
        collapseButton.setAttribute('aria-label', 'Collapse exam tools');
        collapseButton.textContent = '-';
        collapseButton.addEventListener('click', () => {
            sidebar.classList.toggle('is-collapsed');
            collapseButton.textContent = sidebar.classList.contains('is-collapsed') ? '+' : '-';
            persistExamToolsState(storageKey, sidebar);
        });
        controls.append(collapseButton);
        header.append(title, controls);

        const body = document.createElement('div');
        body.className = 'seb-tools-body';
        tools.forEach((tool) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'seb-tool-button';
            button.title = `Open ${tool.label}`;
            button.addEventListener('click', (event) => openExamTool(event, tool), true);

            const mark = document.createElement('span');
            mark.className = 'seb-tool-mark';
            mark.textContent = tool.label.trim().slice(0, 1).toUpperCase();
            const text = document.createElement('span');
            text.className = 'seb-tool-text';
            const name = document.createElement('strong');
            name.textContent = tool.label;
            const host = document.createElement('small');
            host.textContent = new URL(tool.url).hostname;
            text.append(name, host);
            button.append(mark, text);
            body.append(button);
        });

        sidebar.append(header, body);
        document.body.appendChild(sidebar);
        collapseButton.textContent = sidebar.classList.contains('is-collapsed') ? '+' : '-';
        makeExamToolsDraggable(sidebar, header, storageKey);
    }

    function openExamTool(event, tool) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
        }

        const windowName = getExamToolWindowName(tool);
        const existingWindow = state.examToolWindows.get(windowName);
        if (focusExamToolWindow(existingWindow)) {
            debugLog('Focused existing exam tool window: ' + tool.label, 'success');
            return;
        }

        const openedWindow = window.open(tool.url, windowName);
        if (!openedWindow) {
            debugLog('Exam tool window could not be opened: ' + tool.label, 'warn');
            return;
        }

        state.examToolWindows.set(windowName, openedWindow);
        try {
            openedWindow.opener = null;
        } catch (error) {
            // Some embedded browser engines do not allow mutating opener across windows.
        }
        focusExamToolWindow(openedWindow);
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
        const source = tool.url || tool.label || 'tool';
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
                top: 112px;
                right: 18px;
                z-index: 2147483000;
                width: min(260px, calc(100vw - 32px));
                color: #172033;
                background: #ffffff;
                border: 1px solid #d0d5dd;
                border-radius: 8px;
                box-shadow: 0 18px 44px rgba(24, 36, 56, 0.22);
                font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                overflow: hidden;
            }
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed {
                width: 148px;
            }
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed .seb-tools-body,
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed .seb-tools-title small {
                display: none;
            }
            .seb-tools-header {
                min-height: 48px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 10px 10px 10px 12px;
                background: #f8fafc;
                border-bottom: 1px solid #eaecf0;
                cursor: move;
                user-select: none;
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
            .seb-tools-body {
                display: grid;
                gap: 8px;
                padding: 10px;
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
            }
            .seb-tool-button:hover {
                border-color: #0f766e;
                background: #f0fdfa;
            }
            .seb-tool-mark {
                width: 30px;
                height: 30px;
                display: grid;
                place-items: center;
                flex: 0 0 auto;
                color: #0f766e;
                background: #e6f4f1;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 900;
            }
            @media (max-width: 640px) {
                #${EXAM_TOOLS_SIDEBAR_ID} {
                    top: auto;
                    right: 12px;
                    bottom: 12px;
                    width: min(240px, calc(100vw - 24px));
                }
            }
        `;
        document.head.appendChild(style);
    }

    function makeExamToolsDraggable(sidebar, handle, storageKey) {
        let drag = null;
        handle.addEventListener('pointerdown', (event) => {
            if (event.target.closest('button')) {
                return;
            }
            const rect = sidebar.getBoundingClientRect();
            drag = {
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top
            };
            sidebar.style.left = rect.left + 'px';
            sidebar.style.top = rect.top + 'px';
            sidebar.style.right = 'auto';
            sidebar.style.bottom = 'auto';
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener('pointermove', (event) => {
            if (!drag) {
                return;
            }
            const maxLeft = Math.max(8, window.innerWidth - sidebar.offsetWidth - 8);
            const maxTop = Math.max(8, window.innerHeight - sidebar.offsetHeight - 8);
            const left = Math.min(Math.max(8, event.clientX - drag.offsetX), maxLeft);
            const top = Math.min(Math.max(8, event.clientY - drag.offsetY), maxTop);
            sidebar.style.left = left + 'px';
            sidebar.style.top = top + 'px';
        });
        const finish = (event) => {
            if (!drag) {
                return;
            }
            drag = null;
            try {
                handle.releasePointerCapture(event.pointerId);
            } catch (error) {
                // Pointer capture may already be released.
            }
            persistExamToolsState(storageKey, sidebar);
        };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
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

    function autoFillAccessCode() {
        debugLog('Checking for access code auto-fill');

        if (!isSafeBrowser()) {
            debugLog('Not in SEB, skipping auto-fill');
            return;
        }

        if (looksLikePostSubmitPage()) {
            debugLog('Post-submit page detected, skipping auto-fill');
            return;
        }

        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            debugLog('Could not extract quiz info for auto-fill', 'warn');
            showAccessCodeErrorOverlay('The quiz page could not be identified. Reload the quiz in Safe Exam Browser, or ask your instructor for help.');
            return;
        }

        const key = quizKey(quizInfo);
        const shouldShowAccessCodeErrors = checkForAccessCodeRequirement() || isAccessCodeChallengePage();
        if (shouldShowAccessCodeErrors) {
            showAccessCodeProgressOverlay();
        }

        if (state.accessCodeRequestKey === key && state.accessCodeRequestPromise) {
            debugLog('Access-code request already in flight for this quiz');
            return;
        }

        state.accessCodeRequestKey = key;
        state.accessCodeRequestPromise = requestAndFillAccessCode(quizInfo, shouldShowAccessCodeErrors)
            .finally(() => {
                state.accessCodeRequestKey = null;
                state.accessCodeRequestPromise = null;
            });
    }

    async function requestAndFillAccessCode(quizInfo, shouldShowAccessCodeErrors) {
        try {
            debugLog('Requesting SEB access proof...');
            const proofResult = await requestAccessProofToken(quizInfo.courseId, quizInfo.quizId);
            if (!proofResult.proofToken) {
                debugLog('No SEB access proof available', 'warn');
                showAutoFillError(
                    proofResult.errorMessage ||
                        'Safe Exam Browser could not verify this quiz configuration. Reload the quiz in SEB, or ask your instructor for help.',
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
                showAutoFillError(
                    'The quiz access code could not be retrieved. Reload the quiz in SEB, or ask your instructor for help.',
                    shouldShowAccessCodeErrors
                );
            }
        } catch (error) {
            debugLog('Error fetching access code: ' + errorMessage(error), 'warn');
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
                errorMessage:
                    'Safe Exam Browser could not read the Config Key for this quiz. Reopen the quiz from Canvas using the Safe Exam Browser link.'
            };
        }

        try {
            const url = `${SEB_DOWNLOAD_BASE_URL}/api/seb/access-proof/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}`;
            const proofPageUrl = window.location.href.split('#')[0];
            debugLog('Sending access proof for page URL: ' + debugSafeUrl(proofPageUrl));
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
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
                      errorMessage:
                          data.message ||
                          'Safe Exam Browser could not verify this quiz configuration. Reopen the quiz from Canvas using the Safe Exam Browser link.'
                  };
        } catch (error) {
            debugLog('Error creating access proof: ' + errorMessage(error), 'warn');
            return {
                proofToken: null,
                errorMessage:
                    'Safe Exam Browser could not verify this quiz configuration because the verification request failed. Check your connection, then reload the quiz in SEB.'
            };
        }
    }

    function accessProofErrorMessage(status, responseText) {
        const fallback =
            status === 403 || status === 409
                ? 'This SEB configuration could not be verified. It may be stale, incorrect, or modified. Reopen the quiz from Canvas using the Safe Exam Browser link.'
                : 'Safe Exam Browser could not verify this quiz configuration. Reload the quiz in SEB, or ask your instructor for help.';

        if (!responseText) {
            return fallback;
        }

        try {
            const payload = JSON.parse(responseText);
            if (payload && payload.error_code === 'INVALID_SEB_CONFIG_PROOF') {
                return fallback;
            }
            return typeof payload.message === 'string' && payload.message.trim() ? payload.message : fallback;
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
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'X-SEB-Proof-Token': proofToken
                }
            });

            debugLog('Response status: ' + response.status);

            if (response.ok) {
                const data = await response.json();
                debugLog('Response data: ' + JSON.stringify({ success: data.success, hasAccessCode: !!data.accessCode }));
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
        field.value = accessCode;
        debugLog('Access code field value set');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));

        debugLog('Access code auto-filled successfully!', 'success');
        if (autoSubmitAccessCode(field)) {
            hideAccessCodeProgressOverlay(8000);
        } else {
            hideAccessCodeProgressOverlay(700);
        }
        return true;
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

    function autoSubmitAccessCode(accessCodeField) {
        const form = accessCodeField.closest('form');
        if (form) {
            for (const selector of ACCESS_CODE_SUBMIT_SELECTORS) {
                const submitButton = form.querySelector(selector);
                if (submitButton) {
                    debugLog('Auto-submitting access code form', 'success');
                    setTimeout(() => {
                        renderAccessCodeOverlayContent('success');
                        submitButton.click();
                    }, 500);
                    return true;
                }
            }
        }

        const container = accessCodeField.closest(ACCESS_CODE_CONTAINER_SELECTOR) || document;
        for (const selector of ACCESS_CODE_SUBMIT_SELECTORS) {
            const submitButton = container.querySelector(selector);
            if (submitButton) {
                debugLog('Auto-submitting access code using nearby button', 'success');
                setTimeout(() => {
                    renderAccessCodeOverlayContent('success');
                    submitButton.click();
                }, 500);
                return true;
            }
        }

        debugLog('No submit button found for auto-submission');
        return false;
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

        markPendingRedirectForFinalSubmit(submitButton, form, quizInfo, 'document submit listener');
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
        const likelyFinalSubmit = isLikelyFinalQuizSubmit(submitButton, form);
        const likelyQuizSubmissionForm = isLikelyQuizSubmissionForm(form);
        detectorTrace('final-submit-evaluation', () => ({
            source,
            likelyFinalSubmit,
            likelyQuizSubmissionForm,
            form: summarizeTraceForm(form),
            submitButton: summarizeTraceElement(submitButton),
            quizInfo
        }));

        if (!likelyFinalSubmit && !likelyQuizSubmissionForm) {
            return false;
        }

        debugLog('FINAL QUIZ SUBMISSION DETECTED by ' + source + '. Marking pending redirect...', 'success');
        debugLog('Submit control details: ' + describeElement(submitButton));
        markPendingRedirect(quizInfo);
        schedulePostSubmitChecks();
        scheduleFinalSubmitDirectRedirect(quizInfo, source);
        return true;
    }

    function isAccessCodeForm(form) {
        if (!form) {
            return false;
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
            text: traceSafeString(normalizeElementText(element)),
            disabled: element.disabled === true
        };
    }

    function watchForCompletionIndicators(quizInfo) {
        debugLog('Setting up completion indicator watcher');
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
                        continue;
                    }
                    const text = (node.textContent || '').toLowerCase();
                    for (const indicator of COMPLETION_TEXT_INDICATORS) {
                        if (text.includes(indicator)) {
                            debugLog('Quiz completion indicator detected: ' + indicator, 'success');
                            markPendingRedirect(quizInfo);
                            setTimeout(maybeRedirectAfterSubmission, 300);
                            return;
                        }
                    }
                }
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

    function monitorUrlForCompletion(quizInfo) {
        debugLog('Setting up URL completion monitor');

        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl === lastUrl) {
                return;
            }

            debugLog('URL changed from ' + lastUrl + ' to ' + currentUrl);
            lastUrl = currentUrl;

            if (COMPLETION_URL_PATTERNS.some((pattern) => pattern.test(currentUrl))) {
                debugLog('Completion URL pattern detected', 'success');
                markPendingRedirect(quizInfo);
                setTimeout(maybeRedirectAfterSubmission, 300);
            }
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

    function enforceSebRequirement() {
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

        trackQuizContext(quizInfo);
        debugLog('Quiz info: Course ' + quizInfo.courseId + ', Quiz ' + quizInfo.quizId, 'success');

        const hasAccessCodeRequirement = checkForAccessCodeRequirement();
        const hasAccessCodeChallenge = isAccessCodeChallengePage();
        const sebDetected = isSafeBrowser();
        const debugOverrideAllowed = isNonSebDebugBehaviorAllowed();

        if (sebDetected) {
            debugLog('SEB DETECTED! Proceeding with auto-fill and completion handler', 'success');

            if (hasAccessCodeChallenge) {
                debugLog('Access code screen detected, delaying exam tools sidebar');
                removeExamToolsSidebar();
            } else {
                setupExamToolsSidebar(quizInfo);
            }

            if (hasAccessCodeChallenge) {
                showAccessCodeProgressOverlay();
            } else {
                debugLog('Access code challenge not visible yet, scheduling delayed auto-fill check');
            }

            setTimeout(() => {
                autoFillAccessCode();
            }, 2000);

            setTimeout(() => {
                setupQuizCompletionHandler();
            }, 3000);
            return;
        }

        debugLog('Non-SEB browser detected, checking for access code requirement');
        if (hasAccessCodeRequirement) {
            debugLog('Access code requirement detected, redirecting to SEB download');
            redirectToSebDownload(quizInfo.courseId, quizInfo.quizId);
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

        state.currentQuizKey = key;
        disconnectAccessCodeObserver();
        state.accessCodeRequestKey = null;
        state.accessCodeRequestPromise = null;
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

                    const selectorList = ACCESS_CODE_FIELD_SELECTORS.join(', ');
                    const nodeMatches = typeof node.matches === 'function' && node.matches(selectorList);
                    const accessCodeField = nodeMatches
                        ? node
                        : (node.querySelector ? node.querySelector(selectorList) : null);

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
                showAccessCodeErrorOverlay('The Canvas access-code field could not be found. Reload the quiz in SEB, or ask your instructor for help.');
            } else {
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
                enforceSebRequirement();
                setTimeout(maybeRedirectAfterSubmission, 300);
            }, { once: true });
        } else {
            debugLog('DOM already loaded, running immediately');
            enforceSebRequirement();
            setTimeout(maybeRedirectAfterSubmission, 300);
        }

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && shouldAttemptAccessCodeAutofill()) {
                debugLog('Page became visible, checking for auto-fill');
                autoFillAccessCode();
            }
            if (!document.hidden) {
                setTimeout(maybeRedirectAfterSubmission, 200);
            }
        });

        window.addEventListener('pagehide', flushDetectorTrace);
        window.addEventListener('beforeunload', flushDetectorTrace);
        installSpaObserver();
    }

    function installSpaObserver() {
        if (state.spaObserver) {
            return;
        }

        let lastUrl = location.href;
        state.spaObserver = new MutationObserver(() => {
            const url = location.href;
            if (url === lastUrl) {
                return;
            }

            lastUrl = url;
            if (state.spaRerunTimer) {
                clearTimeout(state.spaRerunTimer);
            }
            state.spaRerunTimer = setTimeout(() => {
                enforceSebRequirement();
                setTimeout(maybeRedirectAfterSubmission, 200);
            }, 1000);
        });
        state.spaObserver.observe(document, { subtree: true, childList: true });
    }

    function pageText() {
        return (document.body && document.body.textContent || '').toLowerCase();
    }

    function quizKey(quizInfo) {
        return quizInfo.courseId + ':' + quizInfo.quizId;
    }

    function errorMessage(error) {
        return error && error.message ? error.message : String(error);
    }

    function debugSafeUrl(value) {
        try {
            const url = new URL(value);
            const sensitiveParams = [
                'access_token',
                'canvas_url',
                'code',
                'id_token',
                'login_hint',
                'state',
                'user_id'
            ];
            sensitiveParams.forEach((param) => {
                if (url.searchParams.has(param)) {
                    url.searchParams.set(param, '[redacted]');
                }
            });
            url.hash = '';
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
