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
                await redirectToSebDownload(quizInfo.courseId, quizInfo.quizId);
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
        state.launchPromptRequestKey = null;
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
                await redirectToSebDownload(quizInfo.courseId, quizInfo.quizId);
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
