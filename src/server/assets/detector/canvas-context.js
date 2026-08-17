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

        const assignmentMatch = url.match(/\/courses\/(\d+)\/assignments\/(\d+)(?:\/taking\/([^/?#]+))?/u);
        if (assignmentMatch) {
            return {
                courseId: assignmentMatch[1],
                assignmentId: assignmentMatch[2],
                attemptId: assignmentMatch[3] || null,
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

    async function isSebRequiredForAssessment(quizInfo) {
        const key = quizInfo.courseId + ':' + quizInfo.quizId;
        const now = Date.now();
        const cached = state.sebRequirementChecks.get(key);
        if (cached && cached.expiresAt > now) {
            return cached.promise;
        }

        const promise = fetch(
            `${SEB_DOWNLOAD_BASE_URL}/api/seb/requirement/${encodeURIComponent(quizInfo.courseId)}/${encodeURIComponent(quizInfo.quizId)}`,
            {
                method: 'GET',
                credentials: 'omit',
                headers: { 'Accept': 'application/json' }
            }
        ).then(async (response) => {
            if (!response.ok) {
                throw new Error('Requirement status returned HTTP ' + response.status);
            }
            const data = await response.json();
            return data?.success === true && data.sebRequired === true;
        }).catch((error) => {
            debugLog('Could not verify Safe Online Exam requirement: ' + errorMessage(error), 'warn');
            return false;
        });

        state.sebRequirementChecks.set(key, {
            expiresAt: now + SEB_REQUIREMENT_CACHE_TTL_MS,
            promise
        });
        return promise;
    }

    function isCurrentQuizContext(quizInfo) {
        const current = extractQuizInfo();
        return !!current && quizKey(current) === quizKey(quizInfo);
    }

    async function shouldShowSebLaunchPrompt(quizInfo) {
        return await isSebRequiredForAssessment(quizInfo)
            && isCurrentQuizContext(quizInfo)
            && !isSafeBrowser()
            && checkForAccessCodeRequirement();
    }

    function findAccessCodeField() {
        const quizInfo = extractQuizInfo();
        if (!quizInfo) {
            return null;
        }
        return quizInfo.contentType === 'NEW_QUIZ'
            ? findTrustedNewQuizAccessCodeField()
            : findTrustedClassicAccessCodeField(quizInfo);
    }

    function findTrustedClassicAccessCodeField(quizInfo) {
        const forms = Array.from(document.querySelectorAll('form.access_code_form, form#access_code_form'))
            .filter((form) => isSameOriginClassicQuizForm(form, quizInfo));
        if (forms.length !== 1) {
            return null;
        }
        const form = forms[0];
        const submitters = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
        if (submitters.length !== 1) {
            return null;
        }
        const fields = Array.from(form.querySelectorAll('input[name="access_code"]'))
            .filter((field) => !field.disabled
                && !isDetectorOwnedElement(field)
                && isVisibleElement(field)
                && isAccessCodeField(field));
        return fields.length === 1 ? fields[0] : null;
    }

    function isSameOriginClassicQuizForm(form, quizInfo) {
        try {
            const action = new URL(form.getAttribute('action') || location.href, location.href);
            const current = new URL(location.href);
            const expectedQuizPath = `/courses/${quizInfo.courseId}/quizzes/${quizInfo.quizId}`;
            const currentPathIsAccessGate = current.pathname === expectedQuizPath
                || current.pathname === expectedQuizPath + '/take';
            return currentPathIsAccessGate
                && action.origin === current.origin
                && action.pathname === current.pathname;
        } catch (error) {
            return false;
        }
    }

    function findTrustedNewQuizAccessCodeField() {
        const gate = findTrustedNewQuizAccessCodeGate();
        return gate ? gate.field : null;
    }

    function findTrustedNewQuizAccessCodeGate() {
        const gates = findNewQuizAccessCodeSubmitters(document)
            .map((submitter) => findNewQuizAccessCodeGateForSubmitter(submitter))
            .filter(Boolean);
        const uniqueFields = new Set(gates.map((gate) => gate.field));
        const uniqueSubmitters = new Set(gates.map((gate) => gate.submitter));
        return uniqueFields.size === 1 && uniqueSubmitters.size === 1 ? gates[0] : null;
    }

    function findNewQuizAccessCodeGateForSubmitter(submitter) {
        const container = findNewQuizAccessCodePromptContainer(submitter);
        if (!container) {
            return null;
        }

        const fields = Array.from(
            container.querySelectorAll('input[type="password"], input[type="text"], input:not([type])')
        ).filter((field) => !field.disabled
            && !isDetectorOwnedElement(field)
            && isVisibleElement(field)
            && isAccessCodeField(field));
        const semanticFields = fields.filter(hasAccessCodeFieldIdentity);
        const field = semanticFields.length === 1
            ? semanticFields[0]
            : fields.length === 1
                ? fields[0]
                : null;
        return field ? { container, field, submitter } : null;
    }

    function findNewQuizAccessCodePromptContainer(submitter) {
        let container = submitter && submitter.parentElement;
        while (container && container !== document.documentElement) {
            if (isDetectorOwnedElement(container)) {
                return null;
            }
            const summary = normalizeElementText(container);
            const isStableCanvasSubmitter = submitter.getAttribute('data-automation') === 'sdk-submit-access-code-button';
            const promptIndicators = isStableCanvasSubmitter
                ? ACCESS_CODE_TEXT_INDICATORS
                : NEW_QUIZ_ACCESS_CODE_PROMPT_INDICATORS;
            if (promptIndicators.some((indicator) => summary.includes(indicator))) {
                return container;
            }
            if (container === document.body) {
                break;
            }
            container = container.parentElement;
        }
        return null;
    }

    function hasTrustedNewQuizAccessCodePrompt() {
        return findNewQuizAccessCodeSubmitters(document)
            .some((submitter) => Boolean(findNewQuizAccessCodePromptContainer(submitter)));
    }

    function hasAccessCodeFieldIdentity(field) {
        const identity = normalizeTextParts([
            field.name,
            field.id,
            field.placeholder,
            typeof field.getAttribute === 'function' ? field.getAttribute('aria-label') : null,
            typeof field.getAttribute === 'function' ? field.getAttribute('data-testid') : null,
            typeof field.getAttribute === 'function' ? field.getAttribute('data-automation') : null
        ]);
        return identity.includes('access code')
            || identity.includes('access_code')
            || identity.includes('access-code');
    }

    function findNewQuizAccessCodeSubmitters(container) {
        const automationSubmitters = Array.from(
            container.querySelectorAll('[data-automation="sdk-submit-access-code-button"]')
        ).filter((button) => isVisibleElement(button) && !isDetectorOwnedElement(button));
        if (automationSubmitters.length) {
            return automationSubmitters;
        }
        return Array.from(container.querySelectorAll('button, input[type="submit"], input[type="button"]'))
            .filter((button) => {
                if (!isVisibleElement(button) || isDetectorOwnedElement(button)) {
                    return false;
                }
                const label = String(button.textContent || button.value || '').trim().toLowerCase();
                return label === 'submit';
            });
    }

    function findContextualAccessCodeField(root) {
        if (!root || !hasCanvasAccessCodePrompt()) {
            return null;
        }

        const candidates = Array.from(root.querySelectorAll('input[type="password"], input[type="text"]'))
            .filter((field) => !field.disabled && !isDetectorOwnedElement(field) && isAccessCodeField(field));
        if (!candidates.length) {
            return null;
        }

        const passwordCandidates = candidates.filter((field) => field.type === 'password');
        if (passwordCandidates.length === 1) {
            return passwordCandidates[0];
        }
        if (candidates.length === 1) {
            return candidates[0];
        }

        const contextMatches = candidates.filter((field) => {
            const container = field.closest('form, [role="dialog"], section, article, main');
            const summary = normalizeElementText(container);
            return ACCESS_CODE_TEXT_INDICATORS.some((indicator) => summary.includes(indicator));
        });
        const contextualPasswords = contextMatches.filter((field) => field.type === 'password');
        if (contextualPasswords.length === 1) {
            return contextualPasswords[0];
        }
        return contextMatches.length === 1 ? contextMatches[0] : null;
    }

    function hasCanvasAccessCodePrompt() {
        if (!document.body) {
            return false;
        }

        const snapshot = document.body.cloneNode(true);
        [SEB_LAUNCH_PROMPT_ID, ACCESS_CODE_PROGRESS_OVERLAY_ID, EXAM_TOOLS_SIDEBAR_ID].forEach((id) => {
            const detectorElement = snapshot.querySelector('#' + id);
            if (detectorElement) {
                detectorElement.remove();
            }
        });
        const text = (snapshot.textContent || '').toLowerCase();
        return ACCESS_CODE_TEXT_INDICATORS.some((indicator) => text.includes(indicator));
    }

    function isDetectorOwnedElement(element) {
        if (!element || typeof element.closest !== 'function') {
            return false;
        }
        return Boolean(element.closest(
            '#' + SEB_LAUNCH_PROMPT_ID +
            ', #' + ACCESS_CODE_PROGRESS_OVERLAY_ID +
            ', #' + EXAM_TOOLS_SIDEBAR_ID
        ));
    }

    function isAccessCodeChallengePage() {
        const quizInfo = extractQuizInfo();
        if (findAccessCodeField()) {
            return true;
        }

        if (quizInfo && quizInfo.contentType === 'NEW_QUIZ') {
            return hasTrustedNewQuizAccessCodePrompt();
        }

        if (document.querySelector('#access_code_form, .access_code_form, form[action*="access_code"], form[action*="access-code"], .access_code')) {
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

        return isAccessCodeChallengePage();
    }

    function findSebCourseNavigationUrl(courseId) {
        const courseIdValue = String(courseId || '');
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const anchor of anchors) {
            const identifyingText = [anchor.textContent, anchor.getAttribute('aria-label'), anchor.getAttribute('title')]
                .filter(Boolean)
                .join(' ')
                .trim()
                .toLowerCase();
            if (
                !identifyingText.includes('safe online exam') &&
                !identifyingText.includes('safe exam browser') &&
                identifyingText !== 'seb'
            ) {
                continue;
            }
            try {
                const url = new URL(anchor.href, window.location.origin);
                const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
                if (
                    url.origin === window.location.origin &&
                    segments.length === 4 &&
                    segments[0] === 'courses' &&
                    segments[1] === courseIdValue &&
                    segments[2] === 'external_tools' &&
                    /^[a-z0-9_-]{1,128}$/i.test(segments[3])
                ) {
                    return url.href;
                }
            } catch {
                // Ignore malformed or cross-origin course-navigation links.
            }
        }
        return null;
    }

    function canvasExternalToolUrl(courseId, toolId) {
        const courseIdValue = String(courseId || '');
        const toolIdValue = String(toolId || '');
        if (!/^\d{1,20}$/u.test(courseIdValue) || !/^\d{1,20}$/u.test(toolIdValue)) {
            return null;
        }
        return `${window.location.origin}/courses/${encodeURIComponent(courseIdValue)}/external_tools/${encodeURIComponent(toolIdValue)}`;
    }

    function matchingCanvasDeveloperKeyId(developerKeyId, clientId) {
        const developerKeyIdValue = String(developerKeyId || '').replace(/^0+(?=\d)/u, '');
        const clientIdValue = String(clientId || '').replace(/^0+(?=\d)/u, '');
        if (developerKeyIdValue && developerKeyIdValue !== '0' && developerKeyIdValue === clientIdValue) {
            return true;
        }
        if (
            !/^\d{1,20}$/u.test(developerKeyIdValue) ||
            !/^\d{1,20}$/u.test(clientIdValue) ||
            developerKeyIdValue === '0' ||
            clientIdValue === '0'
        ) {
            return false;
        }

        // Canvas (through Switchman) reserves ten trillion IDs per shard. Its
        // LTI client ID can therefore be globally qualified while the External
        // Tools API returns the same DeveloperKey as a shard-local ID.
        const canvasShardIdWidth = 13;
        const developerKeyIsGlobal = developerKeyIdValue.length > canvasShardIdWidth;
        const clientIdIsGlobal = clientIdValue.length > canvasShardIdWidth;
        if (developerKeyIsGlobal === clientIdIsGlobal) {
            return false;
        }

        const localDeveloperKeyId = developerKeyIsGlobal
            ? developerKeyIdValue.slice(-canvasShardIdWidth).replace(/^0+(?=\d)/u, '')
            : developerKeyIdValue;
        const localClientId = clientIdIsGlobal
            ? clientIdValue.slice(-canvasShardIdWidth).replace(/^0+(?=\d)/u, '')
            : clientIdValue;
        return localDeveloperKeyId !== '0' && localDeveloperKeyId === localClientId;
    }

    function matchingCanvasExternalToolUrl(courseId, tools) {
        if (!Array.isArray(tools) || !String(LTI_CLIENT_ID || '').trim()) {
            return null;
        }
        const clientId = String(LTI_CLIENT_ID);
        const deploymentIdCheckingEnabled = LTI_DEPLOYMENT_ID_CHECKING_ENABLED === true || LTI_DEPLOYMENT_ID_CHECKING_ENABLED === 'true';
        const deploymentIds = Array.isArray(LTI_DEPLOYMENT_IDS)
            ? LTI_DEPLOYMENT_IDS.map(String).filter(Boolean)
            : [];
        const matchingTools = tools.filter((tool) => {
            if (!tool || typeof tool !== 'object' || !matchingCanvasDeveloperKeyId(tool.developer_key_id, clientId)) {
                return false;
            }
            if (tool.version && String(tool.version) !== '1.3') {
                return false;
            }
            return !deploymentIdCheckingEnabled || deploymentIds.includes(String(tool.deployment_id || ''));
        });
        for (const tool of matchingTools) {
            const url = canvasExternalToolUrl(courseId, tool.id);
            if (url) {
                return url;
            }
        }
        return null;
    }

    function nextCanvasExternalToolsPageUrl(response, courseId) {
        const linkHeader = response.headers && typeof response.headers.get === 'function'
            ? response.headers.get('Link') || response.headers.get('link')
            : null;
        if (!linkHeader) {
            return null;
        }
        const expectedPath = `/api/v1/courses/${encodeURIComponent(courseId)}/external_tools`;
        for (const entry of linkHeader.split(',')) {
            const urlMatch = entry.match(/<([^>]+)>/u);
            const relMatch = entry.match(/;\s*rel="?([^";]+)"?/iu);
            if (!urlMatch || !relMatch || !relMatch[1].split(/\s+/u).includes('next')) {
                continue;
            }
            try {
                const nextUrl = new URL(urlMatch[1], window.location.origin);
                if (nextUrl.origin === window.location.origin && nextUrl.pathname === expectedPath) {
                    return nextUrl.href;
                }
            } catch {
                return null;
            }
        }
        return null;
    }

    async function resolveSebCourseNavigationUrl(courseId) {
        const navigationUrl = findSebCourseNavigationUrl(courseId);
        const courseIdValue = String(courseId || '');
        if (!/^\d{1,20}$/u.test(courseIdValue) || !String(LTI_CLIENT_ID || '').trim()) {
            return navigationUrl;
        }
        const existingRequest = state.courseNavigationUrlRequests.get(courseIdValue);
        if (existingRequest) {
            return existingRequest;
        }

        const request = (async () => {
            try {
                const endpoint = new URL(`/api/v1/courses/${encodeURIComponent(courseIdValue)}/external_tools`, window.location.origin);
                endpoint.searchParams.set('include_parents', 'true');
                endpoint.searchParams.set('placement', 'course_navigation');
                endpoint.searchParams.set('per_page', '100');
                const tools = [];
                const visitedPages = new Set();
                let pageUrl = endpoint.href;
                while (pageUrl) {
                    if (visitedPages.has(pageUrl) || visitedPages.size >= CANVAS_EXTERNAL_TOOLS_MAX_PAGES) {
                        throw new Error('Canvas external-tools pagination exceeded its safe limit');
                    }
                    visitedPages.add(pageUrl);
                    const response = await fetch(pageUrl, {
                        method: 'GET',
                        credentials: 'same-origin',
                        cache: 'no-store',
                        headers: { Accept: 'application/json' }
                    });
                    if (!response.ok) {
                        throw new Error('Canvas returned HTTP ' + response.status);
                    }
                    const pageTools = await response.json();
                    if (!Array.isArray(pageTools)) {
                        throw new Error('Canvas returned an invalid external-tools response');
                    }
                    tools.push(...pageTools);
                    const matchingUrl = matchingCanvasExternalToolUrl(courseIdValue, tools);
                    if (matchingUrl) {
                        return matchingUrl;
                    }
                    pageUrl = nextCanvasExternalToolsPageUrl(response, courseIdValue);
                }
                return null;
            } catch (error) {
                const message = error instanceof Error ? error.message : 'unknown error';
                debugLog('Could not resolve the Safe Online Exam Canvas installation: ' + message, 'warn');
                return navigationUrl;
            }
        })();
        state.courseNavigationUrlRequests.set(courseIdValue, request);
        const resolvedUrl = await request;
        if (!resolvedUrl && state.courseNavigationUrlRequests.get(courseIdValue) === request) {
            state.courseNavigationUrlRequests.delete(courseIdValue);
        }
        return resolvedUrl;
    }

    async function buildAssessmentLtiLaunchUrl(courseId, quizId) {
        const courseNavigationUrl = await resolveSebCourseNavigationUrl(courseId);
        const rawContentId = String(quizId || '');
        const contentId = /^\d{1,20}$/u.test(rawContentId)
            ? `classicquiz_${rawContentId}`
            : /^newquiz:\d{1,20}:\d{1,20}$/u.test(rawContentId)
                ? rawContentId
                : null;
        if (!courseNavigationUrl || !contentId) {
            return null;
        }
        try {
            const canvasLaunch = new URL(courseNavigationUrl);
            const target = new URL(`/seb/launch/${contentId}`, SEB_DOWNLOAD_BASE_URL);
            if (canvasLaunch.origin !== window.location.origin || target.origin !== new URL(SEB_DOWNLOAD_BASE_URL).origin) {
                return null;
            }
            // Canvas validates that launch_url belongs to the configured tool,
            // then performs the normal signed LTI launch for this exact target.
            canvasLaunch.searchParams.set('display', 'borderless');
            canvasLaunch.searchParams.set('launch_url', target.href);
            return canvasLaunch.href;
        } catch {
            return null;
        }
    }

    async function redirectToSebDownload(courseId, quizId) {
        if (document.getElementById(SEB_LAUNCH_PROMPT_ID)) {
            return;
        }
        const quizInfo = extractQuizInfo();
        if (!isStudentAssessmentAccessPage(quizInfo)) {
            debugLog('Not a student assessment access route, skipping browser launch prompt');
            return;
        }
        const promptKey = quizInfo ? quizKey(quizInfo) : courseId + ':' + quizId;
        const isNewQuiz = quizInfo
            ? quizInfo.contentType === 'NEW_QUIZ'
            : typeof quizId === 'string' && quizId.startsWith('newquiz:');
        if (isNewQuiz && state.dismissedLaunchPromptKey === promptKey) {
            debugLog('New Quiz SEB launch prompt was dismissed for this attempt');
            return;
        }
        if (state.launchPromptRequestKey === promptKey) {
            return;
        }
        state.launchPromptRequestKey = promptKey;
        const secureLaunchUrl = await buildAssessmentLtiLaunchUrl(courseId, quizId);
        if (state.launchPromptRequestKey === promptKey) {
            state.launchPromptRequestKey = null;
        }
        const currentQuizInfo = extractQuizInfo();
        if (
            document.getElementById(SEB_LAUNCH_PROMPT_ID) ||
            !currentQuizInfo ||
            quizKey(currentQuizInfo) !== promptKey
        ) {
            return;
        }
        const launchUnavailableMessage = 'Safe Online Exam could not locate its Canvas course installation. Reload this page, or ask your instructor or Canvas administrator for help.';

        const message = document.createElement('div');
        message.id = SEB_LAUNCH_PROMPT_ID;
        message.setAttribute('role', 'dialog');
        message.setAttribute('aria-modal', 'true');
        message.setAttribute('aria-labelledby', 'seb-launch-dialog-title');
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
                <div style="width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 18px; overflow: hidden; background: #ffffff; border: 1px solid #dbe2ea; border-radius: 10px;">
                    <img src="${escapeHtml(SAFE_ONLINE_EXAM_ICON_URL)}" alt="" width="40" height="40" loading="lazy" decoding="async" style="display: block; width: 40px; height: 40px; object-fit: contain;" />
                </div>
                <p style="margin: 0 0 6px; color: #0b63ce; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0;">
                    Safe Online Exam
                </p>
                <h2 id="seb-launch-dialog-title" style="color: #182230; margin: 0 0 12px; font-size: 24px; line-height: 1.15; font-weight: 800;">
                    ${secureLaunchUrl ? 'Open Safe Exam Browser' : 'Safe Online Exam needs attention'}
                </h2>
                <p style="margin: 0; font-size: 15px; line-height: 1.45; color: #667085;">
                    ${secureLaunchUrl && isNewQuiz
                        ? 'Open this assessment in Safe Exam Browser, or stay here to review previous attempts.'
                        : secureLaunchUrl
                            ? 'Open this assessment in Safe Exam Browser.'
                            : escapeHtml(launchUnavailableMessage)}
                </p>
                </div>
                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 32px 18px; background: #f8fafc; border-top: 1px solid #dbe2ea; flex-wrap: wrap;">
                        ${isNewQuiz
                            ? '<button id="seb-launch-view-page-button" type="button" style="min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid #cfd7e3; border-radius: 8px; background: #ffffff; color: #344054; font-weight: 800; cursor: pointer;">View quiz page</button>'
                            : '<button id="seb-launch-back-button" type="button" style="min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid #cfd7e3; border-radius: 8px; background: #ffffff; color: #344054; font-weight: 800; cursor: pointer;">Back</button>'}
                        ${secureLaunchUrl
                            ? `<a id="seb-launch-open-link" href="${escapeHtml(secureLaunchUrl)}" rel="noopener noreferrer" referrerpolicy="no-referrer" style="min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; border-radius: 8px; background: #0b63ce; color: #ffffff; text-decoration: none; font-weight: 800;">Open Safe Exam Browser</a>`
                            : '<button id="seb-launch-retry-button" type="button" style="min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 0; border-radius: 8px; background: #0b63ce; color: #ffffff; font-weight: 800; cursor: pointer;">Reload page</button>'}
                </div>
            </div>
        `;

        const previousFocus = document.activeElement;
        document.body.appendChild(message);
        const dismissPrompt = (rememberForAttempt = false) => {
            if (rememberForAttempt) {
                state.dismissedLaunchPromptKey = promptKey;
            }
            message.remove();
            if (previousFocus && typeof previousFocus.focus === 'function') {
                previousFocus.focus();
            }
        };
        const backButton = document.getElementById('seb-launch-back-button');
        const viewPageButton = document.getElementById('seb-launch-view-page-button');
        const openLink = document.getElementById('seb-launch-open-link');
        const retryButton = document.getElementById('seb-launch-retry-button');
        if (backButton) {
            backButton.addEventListener('click', () => {
                if (window.history && typeof window.history.back === 'function') {
                    window.history.back();
                    return;
                }
                dismissPrompt();
            });
        }
        if (viewPageButton) {
            viewPageButton.addEventListener('click', () => {
                debugLog('New Quiz launch prompt dismissed to view the quiz page');
                detectorTrace('new-quiz-launch-prompt-dismissed', { quizInfo }, 'success');
                dismissPrompt(true);
            });
        }
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                window.location.reload();
            });
        }
        message.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                dismissPrompt(isNewQuiz);
            }
        });
        if (openLink) {
            openLink.focus();
        } else if (retryButton) {
            retryButton.focus();
        }
    }
