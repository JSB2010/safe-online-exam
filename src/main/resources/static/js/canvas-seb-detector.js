/**
 * Canvas SEB Browser Detection and Redirection Script
 * 
 * This script should be injected into Canvas quiz pages to:
 * 1. Detect if the browser is Safe Exam Browser (SEB)
 * 2. If not SEB, redirect to SEB download page
 * 3. If SEB, allow normal quiz access
 */

(function() {
    'use strict';

    // Configuration
    const SEB_DOWNLOAD_BASE_URL = 'https://canvas-seb-dev-184075650720.us-central1.run.app';
    const SEB_API_KEY = '${SEB_API_KEY}'; // This will be replaced by the server with the actual API key

    // Debug panel for SEB (since we can't see console)
    let debugPanel = null;
    let debugMessages = [];

    function createDebugPanel() {
        if (debugPanel) return;

        debugPanel = document.createElement('div');
        debugPanel.id = 'seb-debug-panel';
        debugPanel.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            width: 300px;
            max-height: 400px;
            background: rgba(0, 0, 0, 0.9);
            color: #00ff00;
            font-family: monospace;
            font-size: 12px;
            padding: 10px;
            border: 2px solid #00ff00;
            border-radius: 5px;
            z-index: 999999;
            overflow-y: auto;
        `;

        const title = document.createElement('div');
        title.textContent = 'SEB Debug Panel';
        title.style.cssText = 'color: #ffff00; font-weight: bold; margin-bottom: 10px; text-align: center;';
        debugPanel.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            position: absolute;
            top: 5px;
            right: 5px;
            background: red;
            color: white;
            border: none;
            width: 20px;
            height: 20px;
            cursor: pointer;
        `;
        closeBtn.onclick = () => debugPanel.style.display = 'none';
        debugPanel.appendChild(closeBtn);

        const content = document.createElement('div');
        content.id = 'debug-content';
        debugPanel.appendChild(content);

        document.body.appendChild(debugPanel);
    }

    function debugLog(message, type = 'info') {
        console.log('Canvas SEB Detector:', message);

        // Also show visually in SEB
        if (!debugPanel) createDebugPanel();

        const timestamp = new Date().toLocaleTimeString();
        const color = type === 'error' ? '#ff0000' : type === 'success' ? '#00ff00' : '#ffffff';

        debugMessages.push(`[${timestamp}] ${message}`);
        if (debugMessages.length > 20) debugMessages.shift(); // Keep only last 20 messages

        const content = document.getElementById('debug-content');
        if (content) {
            content.innerHTML = debugMessages.map(msg =>
                `<div style="color: ${color}; margin-bottom: 5px;">${msg}</div>`
            ).join('');
            content.scrollTop = content.scrollHeight;
        }
    }
    
    /**
     * Detects if the current browser is Safe Exam Browser
     */
    function isSafeBrowser() {
        const userAgent = navigator.userAgent;
        
        // Check for SEB user agent patterns
        const sebPatterns = [
            'SEB/',
            'SafeExamBrowser',
            'Safe Exam Browser',
            'SEB_'
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
        // Check URL patterns for Canvas quizzes
        const url = window.location.href;
        const quizPatterns = [
            '/courses/\\d+/quizzes/\\d+',
            '/courses/\\d+/assignments/\\d+.*quiz',
            '/courses/\\d+/quizzes/\\d+/take'
        ];
        
        for (const pattern of quizPatterns) {
            if (new RegExp(pattern).test(url)) {
                return true;
            }
        }
        
        // Check for quiz-specific DOM elements
        const quizElements = [
            '#quiz_title',
            '.quiz-header',
            '#quiz-instructions',
            '.take_quiz_button',
            '#submit_quiz_button'
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
        const match = url.match(/\/courses\/(\d+)\/quizzes\/(\d+)/);
        
        if (match) {
            return {
                courseId: match[1],
                quizId: match[2]
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
     * Redirects to SEB download page with current Canvas URL for return navigation
     */
    function redirectToSebDownload(courseId, quizId) {
        // Include the current Canvas URL so our app can redirect back after SEB setup
        const currentUrl = encodeURIComponent(window.location.href);
        const downloadUrl = `${SEB_DOWNLOAD_BASE_URL}/seb/quiz/${courseId}/${quizId}?canvas_url=${currentUrl}`;

        // Show a brief message before redirecting
        const message = document.createElement('div');
        message.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: Arial, sans-serif;
            text-align: center;
        `;

        message.innerHTML = `
            <div style="background: #fff; color: #333; padding: 40px; border-radius: 15px; max-width: 600px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="font-size: 64px; margin-bottom: 20px; color: #d32f2f;">&#128274;</div>
                <h2 style="color: #d32f2f; margin-bottom: 20px; font-size: 24px;">
                    Safe Exam Browser Required
                </h2>
                <p style="margin-bottom: 20px; font-size: 16px; line-height: 1.5;">
                    This quiz requires <strong>Safe Exam Browser (SEB)</strong> for security.<br>
                    You will be redirected to download and set up SEB.
                </p>
                <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <p style="font-size: 14px; color: #666; margin: 0;">
                        <strong>What happens next:</strong><br>
                        1. Download Safe Exam Browser<br>
                        2. Download the quiz configuration file<br>
                        3. Open the quiz in SEB to continue
                    </p>
                </div>
                <p style="font-size: 14px; color: #666;">
                    Redirecting in <span id="countdown" style="font-weight: bold; color: #d32f2f;">3</span> seconds...
                </p>
                <button onclick="window.location.href='${downloadUrl}'" style="
                    background: #1976d2;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 5px;
                    cursor: pointer;
                    margin-top: 10px;
                    font-size: 14px;
                ">Continue Now</button>
            </div>
        `;

        document.body.appendChild(message);

        // Countdown and redirect
        let countdown = 3;
        const countdownElement = document.getElementById('countdown');
        const timer = setInterval(() => {
            countdown--;
            if (countdownElement) {
                countdownElement.textContent = countdown;
            }

            if (countdown <= 0) {
                clearInterval(timer);
                window.location.href = downloadUrl;
            }
        }, 1000);
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

        // Try to get the access code from our backend
        debugLog('Fetching access code from backend...');
        fetchAccessCodeForQuiz(quizInfo.courseId, quizInfo.quizId)
            .then(accessCode => {
                if (accessCode) {
                    debugLog('Access code retrieved: ' + accessCode.substring(0, 3) + '***', 'success');
                    attemptAutoFillWithRetry(accessCode, 0);
                } else {
                    debugLog('No access code available for auto-fill', 'error');
                }
            })
            .catch(error => {
                debugLog('Error fetching access code: ' + error.message, 'error');
            });
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
    async function fetchAccessCodeForQuiz(courseId, quizId) {
        try {
            const url = `${SEB_DOWNLOAD_BASE_URL}/api/seb/access-code/${courseId}/${quizId}`;
            debugLog('Fetching from URL: ' + url);
            debugLog('Using API key: ' + SEB_API_KEY.substring(0, 8) + '...');

            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'X-SEB-API-Key': SEB_API_KEY
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

                // Fill the field
                field.value = accessCode;
                debugLog('Field value set to: ' + accessCode.substring(0, 3) + '***');

                // Trigger events to ensure Canvas recognizes the input
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
                field.dispatchEvent(new Event('blur', { bubbles: true }));

                debugLog('Access code auto-filled successfully!', 'success');

                // Optionally auto-submit if there's a submit button nearby
                autoSubmitAccessCode(field);
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
                    return;
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
                return;
            }
        }

        console.log('Canvas SEB Detector: No submit button found for auto-submission');
    }

    /**
     * Detects quiz completion and redirects to SEB exit page
     */
    function setupQuizCompletionHandler() {
        debugLog('Setting up quiz completion handler');

        // Only set up handler if we're in SEB
        if (!isSafeBrowser()) {
            debugLog('Not in SEB, skipping quiz completion handler');
            return;
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

        // Enhanced form detection - look for ANY form on quiz pages
        const allForms = document.querySelectorAll('form');
        debugLog('Found ' + allForms.length + ' total forms on page');

        allForms.forEach((form, index) => {
            debugLog('Form ' + index + ': action=' + (form.action || 'no action') + ', id=' + (form.id || 'no id'));

            form.addEventListener('submit', function(event) {
                debugLog('FORM SUBMISSION DETECTED on form ' + index + '!', 'success');
                debugLog('Form action: ' + (this.action || 'no action'));
                debugLog('Form method: ' + (this.method || 'no method'));

                // Check if this is a final submission (not just save)
                const submitButton = event.submitter || document.activeElement;
                debugLog('Submit button: ' + (submitButton ? submitButton.textContent || submitButton.value || submitButton.id : 'none'));

                const isSubmitQuiz = submitButton && (
                    (submitButton.textContent && submitButton.textContent.toLowerCase().includes('submit')) ||
                    (submitButton.value && submitButton.value.toLowerCase().includes('submit')) ||
                    (submitButton.id && submitButton.id.toLowerCase().includes('submit')) ||
                    (submitButton.name && submitButton.name.toLowerCase().includes('submit'))
                );

                debugLog('Is submit quiz: ' + isSubmitQuiz);

                if (isSubmitQuiz) {
                    debugLog('FINAL QUIZ SUBMISSION DETECTED! Preparing redirect...', 'success');

                    // Allow the form to submit first, then redirect after a delay
                    setTimeout(() => {
                        debugLog('Executing redirect to SEB exit page', 'success');
                        redirectToSebExit(quizInfo);
                    }, 2000); // 2 second delay to allow submission to process
                } else {
                    debugLog('Form submission detected but not a final quiz submit', 'error');
                }
            });
        });

        // Enhanced button detection - look for ALL buttons and inputs
        const allButtons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
        debugLog('Found ' + allButtons.length + ' total buttons/inputs on page');

        allButtons.forEach((button, index) => {
            const buttonText = button.textContent || button.value || button.id || button.name || 'no text';
            debugLog('Button ' + index + ': "' + buttonText + '" (type: ' + button.type + ')');

            button.addEventListener('click', function(event) {
                const clickedText = (this.textContent || this.value || this.id || this.name || '').toLowerCase();
                debugLog('BUTTON CLICKED: "' + clickedText + '"', 'success');

                if (clickedText.includes('submit') && !clickedText.includes('save')) {
                    debugLog('SUBMIT BUTTON CLICKED! Preparing redirect...', 'success');

                    // Redirect after allowing the submission to process
                    setTimeout(() => {
                        debugLog('Executing redirect to SEB exit page from button click', 'success');
                        redirectToSebExit(quizInfo);
                    }, 3000); // 3 second delay for submit processing
                } else {
                    debugLog('Button clicked but not a submit button: "' + clickedText + '"');
                }
            });
        });

        // Additional: Watch for ANY click that might be a submit action
        document.addEventListener('click', function(event) {
            const target = event.target;
            const targetText = (target.textContent || target.value || target.id || target.className || '').toLowerCase();

            if (targetText.includes('submit') || targetText.includes('finish') || targetText.includes('complete')) {
                debugLog('POTENTIAL SUBMIT CLICK DETECTED: "' + targetText + '"', 'success');

                setTimeout(() => {
                    debugLog('Executing redirect from generic click handler', 'success');
                    redirectToSebExit(quizInfo);
                }, 4000); // Longer delay for generic clicks
            }
        });
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
                            'quiz submitted',
                            'submission successful',
                            'quiz completed',
                            'thank you for taking',
                            'your quiz has been submitted',
                            'quiz submission complete'
                        ];

                        for (const indicator of completionIndicators) {
                            if (text.toLowerCase().includes(indicator)) {
                                debugLog('Quiz completion indicator detected: ' + indicator, 'success');
                                setTimeout(() => {
                                    redirectToSebExit(quizInfo);
                                }, 1000);
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
                    '/courses/\\d+$',  // Redirected back to course
                    '/courses/\\d+/grades',  // Redirected to grades
                    '/courses/\\d+/quizzes$',  // Redirected to quiz list
                    'quiz.*complete',
                    'submission.*complete'
                ];

                for (const pattern of completionPatterns) {
                    if (new RegExp(pattern).test(currentUrl)) {
                        debugLog('Completion URL pattern detected: ' + pattern, 'success');
                        setTimeout(() => {
                            redirectToSebExit(quizInfo);
                        }, 500);
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

        // Check if using SEB first
        if (isSafeBrowser()) {
            debugLog('SEB DETECTED! Proceeding with auto-fill and completion handler', 'success');

            // Auto-fill access code if needed
            setTimeout(() => {
                autoFillAccessCode();
            }, 2000); // Wait 2 seconds for page to fully load

            // Set up quiz completion handler
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
            console.log('Canvas SEB Detector: Mutation observer stopped after timeout');
        }, 30000);
    }

    // Show that script is loaded
    debugLog('Canvas SEB Detector Script Loaded!', 'success');
    debugLog('Version: 2.1 with Enhanced Detection and Manual Test');

    // Add manual test button for debugging (only in SEB)
    if (isSafeBrowser()) {
        setTimeout(() => {
            try {
                const testButton = document.createElement('button');
                testButton.textContent = 'TEST EXIT';
                testButton.style.cssText = `
                    position: fixed;
                    top: 50px;
                    right: 10px;
                    background: #ff4444;
                    color: white;
                    border: none;
                    padding: 8px;
                    border-radius: 3px;
                    z-index: 999998;
                    cursor: pointer;
                    font-size: 12px;
                `;
                testButton.onclick = () => {
                    try {
                        const quizInfo = extractQuizInfo();
                        if (quizInfo) {
                            debugLog('Manual test triggered!', 'success');
                            const exitUrl = `${SEB_DOWNLOAD_BASE_URL}/seb/exit/${quizInfo.courseId}/${quizInfo.quizId}`;
                            debugLog('Redirecting to: ' + exitUrl, 'success');
                            window.location.href = exitUrl;
                        } else {
                            debugLog('Cannot test - no quiz info available', 'error');
                            alert('No quiz info available for testing');
                        }
                    } catch (error) {
                        debugLog('Test button error: ' + error.message, 'error');
                        alert('Test failed: ' + error.message);
                    }
                };
                document.body.appendChild(testButton);
                debugLog('Manual test button added', 'success');
            } catch (error) {
                debugLog('Failed to create test button: ' + error.message, 'error');
            }
        }, 3000);
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        debugLog('DOM still loading, waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', enforceSebRequirement);
    } else {
        debugLog('DOM already loaded, running immediately');
        enforceSebRequirement();
    }

    // Also run when the page becomes visible (in case of tab switching)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isSafeBrowser()) {
            console.log('Canvas SEB Detector: Page became visible, checking for auto-fill');
            autoFillAccessCode();
        }
    });
    
    // Also run when page content changes (for single-page app navigation)
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            setTimeout(enforceSebRequirement, 1000); // Delay to allow page to load
        }
    }).observe(document, { subtree: true, childList: true });
    
})();
