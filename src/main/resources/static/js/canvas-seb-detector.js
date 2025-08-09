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
                console.log('SEB detected via user agent:', userAgent);
                return true;
            }
        }
        
        // Check for SEB-specific properties
        if (window.SafeExamBrowser || window.SEB) {
            console.log('SEB detected via window properties');
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
                    console.log('SEB detected via header:', header);
                    return true;
                }
            }
        } catch (e) {
            // Headers check failed, continue with other methods
        }
        
        console.log('SEB not detected');
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
     * Main function to check and enforce SEB requirement
     */
    function enforceSebRequirement() {
        console.log('Canvas SEB Detector: Starting enforcement check');

        // Only run on Canvas quiz pages
        if (!isCanvasQuizPage()) {
            console.log('Canvas SEB Detector: Not a quiz page, skipping');
            return;
        }

        // Extract quiz information
        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            console.log('Canvas SEB Detector: Could not extract quiz info');
            return;
        }

        console.log('Canvas SEB Detector: Quiz detected', quizInfo);

        // Check if using SEB first
        if (isSafeBrowser()) {
            console.log('Canvas SEB Detector: SEB detected, allowing access');
            return;
        }

        console.log('Canvas SEB Detector: Non-SEB browser detected, checking for access code requirement');

        // Check if this quiz has an access code requirement (indicating SEB enforcement)
        const hasAccessCodeRequirement = checkForAccessCodeRequirement();

        if (hasAccessCodeRequirement) {
            console.log('Canvas SEB Detector: Access code requirement detected, redirecting to SEB download');
            redirectToSebDownload(quizInfo.courseId, quizInfo.quizId);
        } else {
            console.log('Canvas SEB Detector: No access code requirement detected, allowing normal access');
        }
    }
    
    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', enforceSebRequirement);
    } else {
        enforceSebRequirement();
    }
    
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
