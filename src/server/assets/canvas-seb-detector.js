/**
 * Canvas SEB Browser Detection and Redirection Script
 * Version: 2.5 - Fixed JavaScript Scoping Issue
 *
 * This script should be injected into Canvas quiz pages to:
 * 1. Detect if the browser is Safe Exam Browser (SEB)
 * 2. If not SEB, redirect to SEB download page
 * 3. If SEB, allow normal quiz access
 */

(function() {
    'use strict';

    // Configuration
    const SEB_DOWNLOAD_BASE_URL = '${SEB_BASE_URL}';

    // Debug mode - will be set by fetching from server
    let debugMode = false;

    function isSebDebugOverrideEnabled() {
        const href = window.location.href;
        return href.includes('seb_debug=1')
            || href.includes('debug=true');
    }

    /**
     * Fetches debug status from server to determine if debug UI should be shown
     */
    async function fetchDebugStatus() {
        if (isSebDebugOverrideEnabled()) {
            debugMode = true;
            console.log('Canvas SEB Detector: Debug mode forced on by URL parameter');
            return true;
        }

        try {
            const response = await fetch(`${SEB_DOWNLOAD_BASE_URL}/api/debug/debug-status`);
            if (response.ok) {
                const data = await response.json();
                debugMode = data.debugEnabled || false;
                console.log('Canvas SEB Detector: Debug mode set to', debugMode);
                return debugMode;
            } else {
                console.log('Canvas SEB Detector: Failed to fetch debug status, defaulting to false');
                debugMode = false;
                return false;
            }
        } catch (error) {
            console.log('Canvas SEB Detector: Error fetching debug status, defaulting to false:', error);
            debugMode = false;
            return false;
        }
    }

    // Initialize script - fetch debug status first, then show debug info
    async function initializeScript() {
        // Fetch debug status from server
        await fetchDebugStatus();

        // Show that script is loaded (only if debug mode is enabled)
        debugLog('Canvas SEB Detector Script Loaded!', 'success');
        debugLog('Version: 2.4 with Configurable Debug Mode');
        debugLog('Debug Mode: ' + (debugMode ? 'ENABLED' : 'DISABLED'));
        debugLog('User Agent: ' + navigator.userAgent);
        debugLog('Current URL: ' + window.location.href);
        debugLog('SEB Detection Result: ' + (isSafeBrowser() ? 'SEB DETECTED' : 'NOT SEB'));

        // Continue with the rest of the initialization
        continueInitialization();
    }

    // Redirect management
    const REDIRECT_FLAG_KEY = 'seb_pending_redirect';
    let finalSubmitClickHandlerInstalled = false;
    let finalSubmitClickQuizInfo = null;

    function markPendingRedirect(quizInfo) {
        const payload = {
            courseId: quizInfo.courseId,
            quizId: quizInfo.quizId,
            ts: Date.now()
        };
        try {
            sessionStorage.setItem(REDIRECT_FLAG_KEY, JSON.stringify(payload));
            debugLog('Marked pending redirect for Course ' + quizInfo.courseId + ', Quiz ' + quizInfo.quizId, 'success');
        } catch (e) {
            debugLog('Failed to mark pending redirect: ' + e.message, 'error');
        }
    }

    function clearPendingRedirect() {
        try {
            sessionStorage.removeItem(REDIRECT_FLAG_KEY);
            debugLog('Cleared pending redirect flag');
        } catch (e) {
            debugLog('Failed to clear pending redirect: ' + e.message, 'error');
        }
    }

    function getPendingRedirect() {
        try {
            const raw = sessionStorage.getItem(REDIRECT_FLAG_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            // Expire after 10 minutes to avoid stale redirects
            if (!data.ts || (Date.now() - data.ts) > 10 * 60 * 1000) {
                clearPendingRedirect();
                return null;
            }
            return data;
        } catch (e) {
            debugLog('Failed to get pending redirect: ' + e.message, 'error');
            return null;
        }
    }

    function isOnTakePage() {
        return /\/courses\/\d+\/quizzes\/\d+\/take\b/.test(location.pathname);
    }

    function looksLikePostSubmitPage() {
        // Check URL patterns for post-submission pages
        const url = location.href;
        const patterns = [
            /\/quizzes\/\d+\/submissions\b/,
            /\/quizzes\/\d+\/results\b/,
            /\/courses\/\d+\/quizzes\b/,
            /submitted=true\b/,
            /submission_id=\d+/,
            /quiz_submission_id=\d+/
        ];
        if (patterns.some(rx => rx.test(url))) {
            debugLog('Post-submit page detected via URL pattern', 'success');
            return true;
        }

        // Heuristic DOM checks (works for Classic + many New Quizzes UIs)
        const text = (document.body && document.body.textContent || '').toLowerCase();
        const completionIndicators = [
            'your quiz has been submitted',
            'quiz submitted',
            'submission complete',
            'successfully submitted',
            'submission received',
            'turned in successfully',
            'assignment submitted',
            'assignment turned in',
            'thank you for your submission'
        ];

        for (const indicator of completionIndicators) {
            if (text.includes(indicator)) {
                debugLog('Post-submit page detected via text: ' + indicator, 'success');
                return true;
            }
        }

        return false;
    }

    // Call this on load and whenever URL content changes
    function maybeRedirectAfterSubmission() {
        const pending = getPendingRedirect();
        if (!pending) return;

        debugLog('Checking for post-submission redirect...');
        debugLog('On take page: ' + isOnTakePage() + ', Looks like post-submit: ' + looksLikePostSubmitPage());

        // FIXED: If we detect post-submit indicators, redirect regardless of take page status
        // This handles cases where Canvas shows completion messages on the same page
        if (looksLikePostSubmitPage()) {
            const exitUrl = `${SEB_DOWNLOAD_BASE_URL}/seb/exit/${pending.courseId}/${pending.quizId}`;
            debugLog('🎯 Post-submission detected! Redirecting to: ' + exitUrl, 'success');
            clearPendingRedirect();
            // Small delay to let Canvas render any receipt UI (UX nicety)
            setTimeout(() => {
                debugLog('✅ Executing redirect to SEB exit page...', 'success');
                window.location.assign(exitUrl);
            }, 500);
        } else {
            debugLog('Post-submission conditions not yet met, waiting...');
        }
    }

    function schedulePostSubmitChecks() {
        [300, 1000, 2000, 4000, 8000, 12000].forEach(delay => {
            setTimeout(maybeRedirectAfterSubmission, delay);
        });
    }

    function debugLog(message, type = 'info') {
        console.log('Canvas SEB Detector:', message);
    }

    function fingerprintValue(value) {
        if (typeof value !== 'string' || value.length === 0) {
            return 'missing';
        }
        if (value.length <= 16) {
            return 'len=' + value.length + ', fp=' + value;
        }
        return 'len=' + value.length + ', fp=' + value.substring(0, 8) + '...' + value.substring(value.length - 8);
    }

    const ACCESS_CODE_PROGRESS_OVERLAY_ID = 'seb-access-code-progress-overlay';
    let accessCodeProgressHideTimer = null;

    function showAccessCodeProgressOverlay() {
        if (!document.body) return;

        if (accessCodeProgressHideTimer) {
            clearTimeout(accessCodeProgressHideTimer);
            accessCodeProgressHideTimer = null;
        }

        if (document.getElementById(ACCESS_CODE_PROGRESS_OVERLAY_ID)) {
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
        overlay.innerHTML = `
            <div style="width: min(420px, 100%); background: #ffffff; border: 1px solid #dfe3ea; border-radius: 8px; box-shadow: 0 18px 48px rgba(24,36,56,0.22); padding: 28px; text-align: left;">
                <div style="width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 18px; color: #0f766e; background: #e6f4f1; border-radius: 8px;">
                    <div style="width: 18px; height: 18px; border: 2px solid #98d2c9; border-top-color: #0f766e; border-radius: 999px; animation: sebProgressSpin 0.8s linear infinite;"></div>
                </div>
                <h2 style="margin: 0 0 10px; color: #172033; font-size: 28px; line-height: 1.15; font-weight: 800;">
                    Getting your quiz ready
                </h2>
                <p style="margin: 0; color: #475467; font-size: 16px; line-height: 1.45;">
                    This should only take a moment.
                </p>
            </div>
        `;

        if (!document.getElementById('seb-access-code-progress-style')) {
            const style = document.createElement('style');
            style.id = 'seb-access-code-progress-style';
            style.textContent = '@keyframes sebProgressSpin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);
    }

    function hideAccessCodeProgressOverlay(delay = 0) {
        if (accessCodeProgressHideTimer) {
            clearTimeout(accessCodeProgressHideTimer);
            accessCodeProgressHideTimer = null;
        }

        const removeOverlay = () => {
            const overlay = document.getElementById(ACCESS_CODE_PROGRESS_OVERLAY_ID);
            if (overlay) {
                overlay.remove();
            }
        };

        if (delay > 0) {
            accessCodeProgressHideTimer = setTimeout(removeOverlay, delay);
        } else {
            removeOverlay();
        }
    }
    
    /**
     * Detects if the current browser is Safe Exam Browser
     */
    function isSafeBrowser() {
        const userAgent = navigator.userAgent;
        
        // Check for SEB user agent patterns (enhanced detection)
        const sebPatterns = [
            'SEB/',
            'SafeExamBrowser',
            'Safe Exam Browser',
            'SEB_',
            'SEB ',
            'seb/',
            'safeexambrowser',
            'safe exam browser',
            'SEB-',
            'SEB-macOS',
            'SEB-Windows',
            'SEB-Linux',
            'SEB 3.',
            'SEB 2.',
            'SEB/3.',
            'SEB/2.'
        ];
        
        for (const pattern of sebPatterns) {
            if (userAgent.includes(pattern)) {
                debugLog('SEB detected via user agent: ' + userAgent, 'success');
                return true;
            }
        }
        
        // Check for SEB-specific properties
        if (window.SafeExamBrowser || window.SEB) {
            debugLog('SEB detected via window properties', 'success');
            return true;
        }
        
        // Check for SEB-specific headers (if available via JavaScript)
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('HEAD', window.location.href, false);
            xhr.send();
            
            const sebHeaders = [
                'X-SafeExamBrowser-ConfigKeyHash',
                'X-SafeExamBrowser-RequestHash',
                'X-SEB-ConfigKey'
            ];
            
            for (const header of sebHeaders) {
                if (xhr.getResponseHeader(header)) {
                    debugLog('SEB detected via header: ' + header, 'success');
                    return true;
                }
            }
        } catch (e) {
            // Headers check failed, continue with other methods
        }
        
        debugLog('SEB not detected - User Agent: ' + userAgent, 'error');
        return false;
    }
    
    /**
     * Checks if this is a Canvas quiz page that requires SEB
     */
    function isCanvasQuizPage() {
        // Check URL patterns for Canvas quizzes and assignment-backed New Quizzes.
        const url = window.location.href;
        const quizPatterns = [
            '/courses/\\d+/quizzes/\\d+',
            '/courses/\\d+/assignments/\\d+',
            '/courses/\\d+/quizzes/\\d+/take'
        ];

        for (const pattern of quizPatterns) {
            if (new RegExp(pattern).test(url)) {
                return true;
            }
        }

        const env = window.ENV || {};
        if ((env.COURSE_ID || env.course_id) && (env.ASSIGNMENT_ID || env.assignment_id)) {
            const pageText = (document.body && document.body.textContent || '').toLowerCase();
            if (pageText.includes('quiz') || pageText.includes('access code')) {
                return true;
            }
        }

        // Check for quiz-specific DOM elements
        const quizElements = [
            '#quiz_title',
            '.quiz-header',
            '#quiz-instructions',
            '.take_quiz_button',
            '#submit_quiz_button',
            '[data-testid*="quiz"]',
            '[class*="quiz"]'
        ];
        
        for (const selector of quizElements) {
            if (document.querySelector(selector)) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Extracts course and quiz IDs from the current URL
     */
    function extractQuizInfo() {
        const url = window.location.href;
        const classicMatch = url.match(/\/courses\/(\d+)\/quizzes\/(\d+)/);

        if (classicMatch) {
            return {
                courseId: classicMatch[1],
                quizId: classicMatch[2],
                contentType: 'CLASSIC_QUIZ'
            };
        }

        const assignmentMatch = url.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
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
    
    /**
     * Checks if this quiz has an access code requirement (indicating SEB enforcement)
     * This is a client-side check that doesn't require API calls
     */
    function checkForAccessCodeRequirement() {
        // Look for Canvas access code input fields or prompts
        const accessCodeElements = [
            'input[name="access_code"]',
            'input[id*="access_code"]',
            'input[placeholder*="access code"]',
            'input[placeholder*="Access Code"]',
            '.access_code',
            '#access_code_form',
            'form[action*="access_code"]'
        ];

        for (const selector of accessCodeElements) {
            if (document.querySelector(selector)) {
                console.log('Canvas SEB Detector: Access code requirement detected via selector:', selector);
                return true;
            }
        }

        // Check for text content indicating access code requirement
        const bodyText = document.body.textContent || '';
        const accessCodeIndicators = [
            'access code',
            'Access Code',
            'enter the access code',
            'quiz access code',
            'This quiz requires an access code'
        ];

        for (const indicator of accessCodeIndicators) {
            if (bodyText.includes(indicator)) {
                console.log('Canvas SEB Detector: Access code requirement detected via text:', indicator);
                return true;
            }
        }

        return false;
    }
    
    /**
     * Shows the SEB launch prompt with the current Canvas URL for return navigation
     */
    function redirectToSebDownload(courseId, quizId) {
        const currentUrl = encodeURIComponent(window.location.href);
        const appBaseUrl = SEB_DOWNLOAD_BASE_URL.replace(/\/+$/, '');
        const configFileUrl = `${appBaseUrl}/seb/config/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}.seb?canvas_url=${currentUrl}`;
        const sebLaunchUrl = configFileUrl
            .replace(/^https:\/\//i, 'sebs://')
            .replace(/^http:\/\//i, 'seb://');

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
            <div style="width: min(560px, 100%); background: #ffffff; color: #172033; padding: 32px; border: 1px solid #dfe3ea; border-radius: 8px; box-shadow: 0 18px 48px rgba(24,36,56,0.22); text-align: left;">
                <div style="width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 18px; color: #0f766e; background: #e6f4f1; border-radius: 8px; font-weight: 800;">
                    SEB
                </div>
                <p style="margin: 0 0 6px; color: #0f766e; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0;">
                    Secure assessment
                </p>
                <h2 style="color: #172033; margin: 0 0 12px; font-size: 30px; line-height: 1.15; font-weight: 800;">
                    Safe Exam Browser Required
                </h2>
                <p style="margin: 0 0 22px; font-size: 16px; line-height: 1.45; color: #344054;">
                    This quiz requires Safe Exam Browser. Open SEB to continue.
                </p>
                <div style="display: grid; justify-items: start; gap: 12px;">
                    <a href="${sebLaunchUrl}" style="min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border-radius: 8px; background: #0f766e; color: #ffffff; text-decoration: none; font-weight: 800;">
                        Open SEB
                    </a>
                    <a href="${configFileUrl}" style="display: inline-flex; align-items: center; gap: 7px; color: #475467; font-size: 14px; font-weight: 700; text-decoration: none;">
                        If that does not work, try the file
                    </a>
                </div>
            </div>
        `;

        document.body.appendChild(message);
    }
    
    /**
     * Automatically fills the quiz access code when using SEB
     */
    function autoFillAccessCode() {
        debugLog('Checking for access code auto-fill');

        // Only auto-fill if we're in SEB
        if (!isSafeBrowser()) {
            debugLog('Not in SEB, skipping auto-fill', 'error');
            return;
        }

        debugLog('SEB detected, proceeding with auto-fill', 'success');

        // Extract quiz information to get access code
        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            debugLog('Could not extract quiz info for auto-fill', 'error');
            return;
        }

        debugLog('Quiz info extracted: Course ' + quizInfo.courseId + ', Quiz ' + quizInfo.quizId);

        if (checkForAccessCodeRequirement()) {
            showAccessCodeProgressOverlay();
        }

        debugLog('Requesting SEB access proof...');
        requestAccessProofToken(quizInfo.courseId, quizInfo.quizId)
            .then(proofToken => {
                if (!proofToken) {
                    debugLog('No SEB access proof available', 'error');
                    hideAccessCodeProgressOverlay(600);
                    return null;
                }
                debugLog('Fetching access code from backend...');
                return fetchAccessCodeForQuiz(quizInfo.courseId, quizInfo.quizId, proofToken);
            })
            .then(accessCode => {
                if (accessCode) {
                    debugLog('Access code retrieved: ' + accessCode.substring(0, 3) + '***', 'success');
                    attemptAutoFillWithRetry(accessCode, 0);
                } else {
                    debugLog('No access code available for auto-fill', 'error');
                    hideAccessCodeProgressOverlay(600);
                }
            })
            .catch(error => {
                debugLog('Error fetching access code: ' + error.message, 'error');
                hideAccessCodeProgressOverlay(600);
            });
    }

    async function getSebConfigKeyHash() {
        const seb = window.SafeExamBrowser;
        if (!seb || !seb.security) {
            debugLog('SEB JavaScript security API not available', 'error');
            return null;
        }

        if (typeof window.SafeExamBrowser.security.updateKeys === 'function') {
            await new Promise(resolve => {
                let resolved = false;
                const finish = () => {
                    if (!resolved) {
                        resolved = true;
                        resolve();
                    }
                };

                try {
                    window.SafeExamBrowser.security.updateKeys(finish);
                    setTimeout(finish, 1500);
                } catch (error) {
                    debugLog('Could not refresh SEB security keys: ' + error.message, 'error');
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
                debugLog('Could not read SEB config key: ' + error.message, 'error');
            }
        }

        return null;
    }

    async function requestAccessProofToken(courseId, quizId) {
        const configKeyHash = await getSebConfigKeyHash();
        if (!configKeyHash) {
            debugLog('No SEB Config Key hash available from SEB security API', 'error');
            return null;
        }

        try {
            const url = `${SEB_DOWNLOAD_BASE_URL}/api/seb/access-proof/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}`;
            const proofPageUrl = window.location.href.split('#')[0];
            debugLog('SEB Config Key hash available: ' + fingerprintValue(configKeyHash), 'success');
            debugLog('Sending access proof for page URL: ' + proofPageUrl);
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
                debugLog('Failed to create access proof: ' + await response.text(), 'error');
                return null;
            }

            const data = await response.json();
            return data.success ? data.proofToken : null;
        } catch (error) {
            debugLog('Error creating access proof: ' + error.message, 'error');
            return null;
        }
    }

    /**
     * Attempts to auto-fill the access code with retry logic
     */
    function attemptAutoFillWithRetry(accessCode, attempt) {
        const maxAttempts = 10;
        const retryDelay = 1000; // 1 second

        console.log(`Canvas SEB Detector: Auto-fill attempt ${attempt + 1}/${maxAttempts}`);

        if (fillAccessCodeField(accessCode)) {
            console.log('Canvas SEB Detector: Access code auto-filled successfully');
            return;
        }

        if (attempt < maxAttempts - 1) {
            console.log(`Canvas SEB Detector: Access code field not found, retrying in ${retryDelay}ms`);
            setTimeout(() => {
                attemptAutoFillWithRetry(accessCode, attempt + 1);
            }, retryDelay);
        } else {
            console.warn('Canvas SEB Detector: Failed to auto-fill access code after all attempts, setting up mutation observer');
            setupAccessCodeObserver(accessCode);
        }
    }

    /**
     * Fetches the access code for a specific quiz from our backend
     */
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
                debugLog('Response data: ' + JSON.stringify(data));
                return data.accessCode;
            } else {
                debugLog('Failed to fetch access code: ' + response.status, 'error');
                const errorText = await response.text();
                debugLog('Error response: ' + errorText, 'error');
                return null;
            }
        } catch (error) {
            debugLog('Error fetching access code: ' + error.message, 'error');
            return null;
        }
    }

    /**
     * Fills the quiz access code field with the provided code
     */
    function fillAccessCodeField(accessCode) {
        debugLog('Attempting to fill access code field');

        // Common selectors for Canvas quiz access code fields
        const accessCodeSelectors = [
            'input[name="access_code"]',
            'input[id*="access_code"]',
            'input[placeholder*="access code"]',
            'input[placeholder*="Access Code"]',
            'input[aria-label*="access code"]',
            'input[aria-label*="Access Code"]',
            '.quiz-access-code input',
            '#quiz_access_code',
            'input[type="password"][name*="access"]',
            'input[type="text"][name*="access"]'
        ];

        debugLog('Searching for access code field with ' + accessCodeSelectors.length + ' selectors');

        // Try each selector to find the access code field
        for (const selector of accessCodeSelectors) {
            const field = document.querySelector(selector);
            debugLog('Trying selector: ' + selector + ' - Found: ' + (field ? 'YES' : 'NO'));

            if (field && isAccessCodeField(field)) {
                debugLog('Found valid access code field with selector: ' + selector, 'success');
                showAccessCodeProgressOverlay();

                // Fill the field
                field.value = accessCode;
                debugLog('Field value set to: ' + accessCode.substring(0, 3) + '***');

                // Trigger events to ensure Canvas recognizes the input
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
                field.dispatchEvent(new Event('blur', { bubbles: true }));

                debugLog('Access code auto-filled successfully!', 'success');

                // Optionally auto-submit if there's a submit button nearby
                if (autoSubmitAccessCode(field)) {
                    hideAccessCodeProgressOverlay(8000);
                } else {
                    hideAccessCodeProgressOverlay(700);
                }
                return true;
            }
        }

        debugLog('Could not find access code field - checking all inputs on page', 'error');

        // Debug: Show all input fields on the page
        const allInputs = document.querySelectorAll('input');
        debugLog('Total inputs found on page: ' + allInputs.length);
        allInputs.forEach((input, index) => {
            debugLog('Input ' + index + ': type=' + input.type + ', name=' + input.name + ', id=' + input.id + ', placeholder=' + input.placeholder);
        });

        return false;
    }

    /**
     * Validates that a field is actually the access code field (not Google sign-in)
     */
    function isAccessCodeField(field) {
        // Exclude Google sign-in and other authentication fields
        const excludePatterns = [
            'email',
            'username',
            'password',
            'login',
            'signin',
            'google',
            'oauth',
            'sso'
        ];

        const fieldName = (field.name || '').toLowerCase();
        const fieldId = (field.id || '').toLowerCase();
        const fieldPlaceholder = (field.placeholder || '').toLowerCase();
        const fieldAriaLabel = (field.getAttribute('aria-label') || '').toLowerCase();

        // Check if field contains any exclude patterns
        for (const pattern of excludePatterns) {
            if (fieldName.includes(pattern) ||
                fieldId.includes(pattern) ||
                fieldPlaceholder.includes(pattern) ||
                fieldAriaLabel.includes(pattern)) {
                console.log('Canvas SEB Detector: Excluding field due to pattern:', pattern);
                return false;
            }
        }

        // Check if field is in a Google sign-in context
        const parentElement = field.closest('.google-signin, .oauth-signin, .sso-signin, [class*="google"], [id*="google"]');
        if (parentElement) {
            console.log('Canvas SEB Detector: Excluding field in Google sign-in context');
            return false;
        }

        // Must be a text or password field
        if (field.type !== 'text' && field.type !== 'password') {
            return false;
        }

        console.log('Canvas SEB Detector: Field validation passed for access code');
        return true;
    }

    /**
     * Automatically submits the access code if there's a submit button nearby
     */
    function autoSubmitAccessCode(accessCodeField) {
        // Look for submit buttons near the access code field
        const submitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button[name*="submit"]',
            '.btn-primary',
            '.submit-button',
            '[data-testid*="submit"]'
        ];

        // Check in the same form first
        const form = accessCodeField.closest('form');
        if (form) {
            for (const selector of submitSelectors) {
                const submitButton = form.querySelector(selector);
                if (submitButton) {
                    console.log('Canvas SEB Detector: Auto-submitting access code form');
                    setTimeout(() => {
                        submitButton.click();
                    }, 500); // Small delay to ensure field is processed
                    return true;
                }
            }
        }

        // If no form, look for nearby submit buttons
        const container = accessCodeField.closest('.quiz-access, .access-code-container, .modal-body, .form-container') || document;
        for (const selector of submitSelectors) {
            const submitButton = container.querySelector(selector);
            if (submitButton) {
                console.log('Canvas SEB Detector: Auto-submitting access code (nearby button)');
                setTimeout(() => {
                    submitButton.click();
                }, 500);
                return true;
            }
        }

        console.log('Canvas SEB Detector: No submit button found for auto-submission');
        return false;
    }

    /**
     * Detects quiz completion and redirects to SEB exit page
     */
    function setupQuizCompletionHandler() {
        debugLog('Setting up quiz completion handler');

        // Check for debug mode or SEB
        const isDebugMode = window.location.href.includes('debug=true') || window.location.href.includes('seb_debug=1');
        const sebDetected = isSafeBrowser();

        if (!sebDetected && !isDebugMode) {
            debugLog('Not in SEB and not in debug mode, skipping quiz completion handler');
            return;
        }

        if (isDebugMode && !sebDetected) {
            debugLog('DEBUG MODE: Setting up completion handler in non-SEB browser', 'success');
        }

        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            debugLog('Could not extract quiz info for completion handler');
            return;
        }

        debugLog('Quiz completion handler active for Course ' + quizInfo.courseId + ', Quiz ' + quizInfo.quizId);

        // Method 1: Intercept form submissions
        interceptQuizSubmission(quizInfo);

        // Method 2: Watch for completion indicators
        watchForCompletionIndicators(quizInfo);

        // Method 3: Monitor URL changes for completion
        monitorUrlForCompletion(quizInfo);
    }

    /**
     * Intercepts quiz form submissions to redirect to exit page
     */
    function interceptQuizSubmission(quizInfo) {
        debugLog('Setting up quiz submission interceptor');
        finalSubmitClickQuizInfo = quizInfo;

        if (!finalSubmitClickHandlerInstalled) {
            document.addEventListener('click', handlePotentialFinalSubmitClick, true);
            finalSubmitClickHandlerInstalled = true;
            debugLog('Installed verified final submit click handler');
        }

        // Enhanced form detection - look for ANY form on quiz pages
        const allForms = document.querySelectorAll('form');
        debugLog('Found ' + allForms.length + ' total forms on page');

        allForms.forEach((form, index) => {
            debugLog('Form ' + index + ': action=' + (form.action || 'no action') + ', id=' + (form.id || 'no id'));

            form.addEventListener('submit', function(event) {
                debugLog('FORM SUBMISSION DETECTED on form ' + index + '!', 'success');
                debugLog('Form action: ' + (this.action || 'no action'));
                debugLog('Form method: ' + (this.method || 'no method'));

                const submitButton = event.submitter || document.activeElement;
                debugLog('Submit button: ' + describeElement(submitButton));

                if (isAccessCodeForm(this)) {
                    debugLog('Ignoring access code form submission for completion redirect');
                    return;
                }

                if (isLikelyFinalQuizSubmit(submitButton, this)) {
                    debugLog('FINAL QUIZ SUBMISSION DETECTED! Marking pending redirect...', 'success');
                    debugLog('Button details: ' + describeElement(submitButton));

                    markPendingRedirect(quizInfo);
                    schedulePostSubmitChecks();
                } else {
                    debugLog('Form submission detected but not a verified final quiz submit');
                }
            });
        });
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
            return;
        }

        if (!isLikelyFinalQuizSubmit(control, form)) {
            return;
        }

        const quizInfo = finalSubmitClickQuizInfo || extractQuizInfo();
        if (!quizInfo) {
            debugLog('Verified final submit click but quiz info is unavailable');
            return;
        }

        debugLog('Verified final quiz submit click detected; marking pending redirect', 'success');
        debugLog('Clicked control: ' + describeElement(control));
        markPendingRedirect(quizInfo);
        schedulePostSubmitChecks();
    }

    function isAccessCodeForm(form) {
        if (!form) return false;

        const accessCodeSelectors = [
            'input[name="access_code"]',
            'input[id*="access_code"]',
            'input[id*="access-code"]',
            'input[name*="access_code"]',
            'input[name*="access-code"]',
            'input[placeholder*="access code"]',
            'input[placeholder*="Access Code"]',
            'input[aria-label*="access code"]',
            'input[aria-label*="Access Code"]',
            '#quiz_access_code',
            '#access_code'
        ];

        if (form.querySelector(accessCodeSelectors.join(','))) {
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

        const nonFinalSignals = [
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

        if (buttonSummary && nonFinalSignals.some(signal => buttonSummary.includes(signal))) {
            return false;
        }

        const strongFinalSignals = [
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

        if (buttonSummary && strongFinalSignals.some(signal => buttonSummary.includes(signal))) {
            return true;
        }

        const formIdentity = normalizeFormIdentity(form);
        return strongFinalSignals.some(signal => formIdentity.includes(signal));
    }

    function normalizeFormIdentity(form) {
        if (!form) return '';

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

        return parts
            .filter(part => typeof part === 'string' && part.trim().length > 0)
            .join(' ')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeElementText(element) {
        if (!element) return '';

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

        return parts
            .filter(part => typeof part === 'string' && part.trim().length > 0)
            .join(' ')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function describeElement(element) {
        if (!element) return 'none';

        const text = normalizeElementText(element);
        const tagName = element.tagName || 'element';
        const type = element.type ? ', type=' + element.type : '';
        return tagName.toLowerCase() + type + ', text="' + text + '"';
    }

    /**
     * Watches for visual indicators that the quiz is complete
     */
    function watchForCompletionIndicators(quizInfo) {
        debugLog('Setting up completion indicator watcher');

        // Watch for completion messages or success indicators
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const text = node.textContent || '';
                        const completionIndicators = [
                            // Canvas Classic Quizzes
                            'quiz submitted',
                            'submission successful',
                            'quiz completed',
                            'thank you for taking',
                            'your quiz has been submitted',
                            'quiz submission complete',
                            'your submission has been recorded',
                            'submission recorded',

                            // Canvas New Quizzes
                            'assignment submitted',
                            'assignment turned in',
                            'submission complete',
                            'successfully submitted',
                            'turned in successfully',
                            'submission received',

                            // General success indicators
                            'submission confirmed',
                            'thank you for your submission'
                        ];

                        for (const indicator of completionIndicators) {
                            if (text.toLowerCase().includes(indicator)) {
                                debugLog('🎯 Quiz completion indicator detected: ' + indicator, 'success');
                                debugLog('Marking pending redirect and triggering check...');
                                markPendingRedirect(quizInfo);
                                // Trigger a check in case we're already on the confirmation screen
                                setTimeout(maybeRedirectAfterSubmission, 300);
                                return;
                            }
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Stop observing after 10 minutes to prevent memory leaks
        setTimeout(() => {
            observer.disconnect();
        }, 600000);
    }

    /**
     * Monitors URL changes that indicate quiz completion
     */
    function monitorUrlForCompletion(quizInfo) {
        debugLog('Setting up URL completion monitor');

        let lastUrl = location.href;

        const urlObserver = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                debugLog('URL changed from ' + lastUrl + ' to ' + currentUrl);
                lastUrl = currentUrl;

                // Check if URL indicates completion
                const completionPatterns = [
                    // Canvas Classic Quizzes
                    '/courses/\\d+$',  // Redirected back to course
                    '/courses/\\d+/grades',  // Redirected to grades
                    '/courses/\\d+/quizzes$',  // Redirected to quiz list
                    '/quizzes/\\d+/submissions',  // Quiz submission page
                    '/quizzes/\\d+/results',  // Quiz results page
                    'quiz.*complete',
                    'submission.*complete',
                    'quiz_submission_id=',  // URL parameter indicating submission
                    'submission_id=',  // General submission parameter

                    // Canvas New Quizzes (Assignments)
                    '/assignments/\\d+/submissions',  // Assignment submission page
                    '/assignments/\\d+/results',  // Assignment results page
                    '/courses/\\d+/assignments$',  // Redirected to assignment list
                    'assignment.*complete',
                    'submitted=true',  // URL parameter for successful submission

                    // General Canvas completion indicators
                    '/courses/\\d+/gradebook',  // Redirected to gradebook
                    'submission_attempt=',  // Submission attempt parameter
                    'quiz.*submitted',
                    'assignment.*submitted'
                ];

                for (const pattern of completionPatterns) {
                    if (new RegExp(pattern).test(currentUrl)) {
                        debugLog('🎯 Completion URL pattern detected: ' + pattern, 'success');
                        debugLog('Current URL: ' + currentUrl);
                        debugLog('Re-checking for post-submit page...');
                        setTimeout(maybeRedirectAfterSubmission, 300);
                        return;
                    }
                }
            }
        });

        urlObserver.observe(document, { subtree: true, childList: true });
    }

    /**
     * Redirects to the SEB exit page
     */
    function redirectToSebExit(quizInfo) {
        debugLog('Redirecting to SEB exit page...', 'success');

        const exitUrl = `${SEB_DOWNLOAD_BASE_URL}/seb/exit/${quizInfo.courseId}/${quizInfo.quizId}`;

        debugLog('Exit URL: ' + exitUrl);

        // Simple immediate redirect - no fancy animations that might cause SEB to hang
        try {
            debugLog('Attempting immediate redirect...', 'success');
            window.location.href = exitUrl;
        } catch (error) {
            debugLog('Redirect failed: ' + error.message, 'error');

            // Fallback: try window.open
            try {
                debugLog('Trying window.open fallback...', 'success');
                window.open(exitUrl, '_self');
            } catch (error2) {
                debugLog('Window.open failed: ' + error2.message, 'error');

                // Last resort: show URL for manual navigation
                alert('Please navigate to: ' + exitUrl);
            }
        }
    }

    /**
     * Main function to check and enforce SEB requirement
     */
    function enforceSebRequirement() {
        debugLog('=== SEB DETECTOR STARTED ===');
        debugLog('Page URL: ' + window.location.href);
        debugLog('User Agent: ' + navigator.userAgent.substring(0, 100) + '...');

        // Only run on Canvas quiz pages
        if (!isCanvasQuizPage()) {
            debugLog('Not a quiz page, skipping');
            return;
        }

        debugLog('Quiz page detected!', 'success');

        // Extract quiz information
        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            debugLog('Could not extract quiz info', 'error');
            return;
        }

        debugLog('Quiz info: Course ' + quizInfo.courseId + ', Quiz ' + quizInfo.quizId, 'success');

        // Check for debug mode (for testing)
        const isDebugMode = window.location.href.includes('debug=true') || window.location.href.includes('seb_debug=1');

        // Check if using SEB first
        const sebDetected = isSafeBrowser();
        if (sebDetected || isDebugMode) {
            if (sebDetected) {
                debugLog('SEB DETECTED! Proceeding with auto-fill and completion handler', 'success');
            } else {
                debugLog('DEBUG MODE ENABLED! Running completion handler in non-SEB browser', 'success');
            }

            // Auto-fill access code if needed (only in actual SEB)
            if (sebDetected) {
                if (checkForAccessCodeRequirement()) {
                    showAccessCodeProgressOverlay();
                }
                setTimeout(() => {
                    autoFillAccessCode();
                }, 2000); // Wait 2 seconds for page to fully load
            }

            // Set up quiz completion handler (works in both SEB and debug mode)
            setTimeout(() => {
                setupQuizCompletionHandler();
            }, 3000); // Wait 3 seconds for page to fully load

            return;
        }

        debugLog('Non-SEB browser detected, checking for access code requirement');

        // Check if this quiz has an access code requirement (indicating SEB enforcement)
        const hasAccessCodeRequirement = checkForAccessCodeRequirement();

        if (hasAccessCodeRequirement) {
            debugLog('Access code requirement detected, redirecting to SEB download');
            redirectToSebDownload(quizInfo.courseId, quizInfo.quizId);
        } else {
            debugLog('No access code requirement detected, allowing normal access');
        }
    }
    
    /**
     * Sets up a mutation observer to watch for dynamically added access code fields
     */
    function setupAccessCodeObserver(accessCode) {
        console.log('Canvas SEB Detector: Setting up mutation observer for access code field');

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if the added node contains an access code field
                            const accessCodeField = node.querySelector ?
                                node.querySelector('input[name="access_code"], input[id*="access_code"], input[placeholder*="access code"]') :
                                null;

                            if (accessCodeField && isAccessCodeField(accessCodeField)) {
                                console.log('Canvas SEB Detector: Access code field detected via mutation observer');
                                fillAccessCodeField(accessCode);
                                observer.disconnect(); // Stop observing once we've filled the field
                            }
                        }
                    });
                }
            });
        });

        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Stop observing after 30 seconds to prevent memory leaks
        setTimeout(() => {
            observer.disconnect();
            hideAccessCodeProgressOverlay(600);
            console.log('Canvas SEB Detector: Mutation observer stopped after timeout');
        }, 30000);
    }

    function continueInitialization() {

    // Enhanced debugging for redirect detection
    debugLog('=== REDIRECT DEBUG INFO ===');
    debugLog('Is on take page: ' + isOnTakePage());
    debugLog('Looks like post-submit: ' + looksLikePostSubmitPage());
    debugLog('Pending redirect: ' + JSON.stringify(getPendingRedirect()));
    debugLog('Session storage available: ' + (typeof sessionStorage !== 'undefined'));

    // Log all forms and buttons for debugging
    setTimeout(() => {
        const forms = document.querySelectorAll('form');
        debugLog('=== FORMS ON PAGE ===');
        forms.forEach((form, i) => {
            debugLog('Form ' + i + ': action=' + (form.action || 'none') + ', method=' + (form.method || 'none'));
        });

        const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
        debugLog('=== BUTTONS ON PAGE ===');
        buttons.forEach((btn, i) => {
            const text = btn.textContent || btn.value || btn.id || 'no text';
            debugLog('Button ' + i + ': "' + text + '" (type: ' + btn.type + ')');
        });
    }, 2000);

    // Log all available window properties that might indicate SEB
    const sebProperties = ['SafeExamBrowser', 'SEB', 'seb', 'SafeBrowser'];
    sebProperties.forEach(prop => {
        if (window[prop]) {
            debugLog('Found SEB property: ' + prop + ' = ' + typeof window[prop]);
        }
    });

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        debugLog('DOM still loading, waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', () => {
            enforceSebRequirement();
            setTimeout(maybeRedirectAfterSubmission, 300);
        });
    } else {
        debugLog('DOM already loaded, running immediately');
        enforceSebRequirement();
        setTimeout(maybeRedirectAfterSubmission, 300);
    }

    // Also run when the page becomes visible (in case of tab switching)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isSafeBrowser()) {
            console.log('Canvas SEB Detector: Page became visible, checking for auto-fill');
            autoFillAccessCode();
        }
        if (!document.hidden) {
            setTimeout(maybeRedirectAfterSubmission, 200);
        }
    });
    
        // Also run when page content changes (for single-page app navigation)
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                setTimeout(enforceSebRequirement, 1000); // Delay to allow page to load
                setTimeout(maybeRedirectAfterSubmission, 1200); // Check for post-submission redirect
            }
        }).observe(document, { subtree: true, childList: true });
    }

    // Start the initialization
    initializeScript();

})();
