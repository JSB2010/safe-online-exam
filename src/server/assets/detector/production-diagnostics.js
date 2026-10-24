    // Production evidence is independent of development tracing. Only fixed
    // milestones are buffered, and nothing is sent without an attempt capability.
    let productionDiagnosticsSequence = 0;
    let productionDiagnosticsToken = null;
    let productionDiagnosticsTarget = null;
    const productionDiagnosticsQueue = [];
    function installProductionDiagnostics(token, courseId, contentId) {
        if (typeof token !== 'string' || token.length > 4096) return;
        productionDiagnosticsToken = token;
        productionDiagnosticsTarget = String(courseId) + ':' + String(contentId);
        try { sessionStorage.setItem('soe-diagnostics:' + productionDiagnosticsTarget, token); } catch { /* optional */ }
        flushProductionDiagnostics(productionDiagnosticsTarget, token);
        if (isSafeBrowser()) emitProductionDiagnostic('browser.seb_detected');
    }
    function flushProductionDiagnostics(target, token) {
        const events = productionDiagnosticsQueue.splice(0, 25).filter(item => item.target === target).map(item => item.event);
        if (!events.length) return;
        fetch(SEB_DOWNLOAD_BASE_URL + '/api/diagnostics/v1/browser-events', { method: 'POST', credentials: 'omit', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, events }) }).catch(() => {});
    }
    function emitProductionDiagnostic(stage, reasonCode) {
        try {
            const quiz = extractQuizInfo();
            if (!quiz) return;
            const target = String(quiz.courseId) + ':' + String(quiz.quizId);
            const event = { stage, at: new Date().toISOString(), sequence: ++productionDiagnosticsSequence };
            if (reasonCode) event.reasonCode = reasonCode;
            productionDiagnosticsQueue.push({ target, event });
            if (productionDiagnosticsQueue.length > 25) productionDiagnosticsQueue.shift();
            let token = productionDiagnosticsTarget === target ? productionDiagnosticsToken : null;
            if (!token && /^browser\.(?:submit|exit|assessment)/.test(stage)) { try { token = sessionStorage.getItem('soe-diagnostics:' + target); } catch { /* optional */ } }
            if (token) flushProductionDiagnostics(target, token);
        } catch { /* Diagnostic failure never affects an assessment. */ }
    }
    function productionDiagnosticFromTrace(event, type) {
        const stages = {
            'initialized': 'detector.initialized',
            'completion-handler-active': 'browser.assessment_observed',
            'access-code-submit-clicked': 'browser.begin_requested',
            'new-quiz-begin-clicked': 'browser.begin_requested',
            'classic-submit-request-started': 'browser.submit_requested',
            'classic-submit-response-confirmed': 'browser.submit_observed',
            'exit-redirect-scheduled': 'browser.exit_requested'
        };
        if (stages[event]) emitProductionDiagnostic(stages[event]);
        else if (type === 'error') emitProductionDiagnostic('browser.error', 'BROWSER_DETECTOR_ERROR');
    }
