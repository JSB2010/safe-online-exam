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
     * Checks if this quiz requires SEB by calling our API
     */
    async function checkSebRequirement(courseId, quizId) {
        try {
            const url = `${SEB_DOWNLOAD_BASE_URL}/seb/check?quizId=${encodeURIComponent(quizId)}`;
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'omit',
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                return data.seb_required === true;
            } else {
                console.warn('SEB check returned non-OK status:', response.status);
            }
        } catch (error) {
            console.error('Error checking SEB requirement:', error);
        }

        // Unknown -> do not assume; return null so caller can decide a fallback
        return null;
    }
    
    /**
     * Redirects to SEB download page
     */
    function redirectToSebDownload(courseId, quizId) {
        const downloadUrl = `${SEB_DOWNLOAD_BASE_URL}/seb/quiz/${courseId}/${quizId}`;
        
        // Show a brief message before redirecting
        const message = document.createElement('div');
        message.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
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
            <div style="background: #fff; color: #333; padding: 30px; border-radius: 10px; max-width: 500px;">
                <h2 style="color: #d32f2f; margin-bottom: 20px;">
                    <i style="font-size: 48px;">⚠️</i><br>
                    Safe Exam Browser Required
                </h2>
                <p style="margin-bottom: 20px; font-size: 16px;">
                    This quiz requires Safe Exam Browser (SEB). You will be redirected to download and set up SEB.
                </p>
                <p style="font-size: 14px; color: #666;">
                    Redirecting in <span id="countdown">3</span> seconds...
                </p>
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
    async function enforceSebRequirement() {
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
        
        // Check if this quiz requires SEB
        const requiresSeb = await checkSebRequirement(quizInfo.courseId, quizInfo.quizId);
        if (!requiresSeb) {
            console.log('Canvas SEB Detector: Quiz does not require SEB');
            return;
        }
        
        console.log('Canvas SEB Detector: Quiz requires SEB, checking browser');
        
        // Check if using SEB
        if (isSafeBrowser()) {
            console.log('Canvas SEB Detector: SEB detected, allowing access');
            return;
        }
        
        console.log('Canvas SEB Detector: Non-SEB browser detected, redirecting');
        redirectToSebDownload(quizInfo.courseId, quizInfo.quizId);
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
