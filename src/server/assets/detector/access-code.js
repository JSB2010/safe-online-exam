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

