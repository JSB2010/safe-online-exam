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

