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

