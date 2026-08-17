    function setupExamToolsSidebar(quizInfo) {
        if (!quizInfo || document.getElementById(EXAM_TOOLS_SIDEBAR_ID)) {
            return;
        }

        const capabilities = readExamSessionCapabilities(quizInfo.courseId, quizInfo.quizId);
        if (capabilities.tools.length) {
            state.authorizedExamTools.set(examToolsKey(quizInfo.courseId, quizInfo.quizId), capabilities.tools);
        }
        const tools = state.authorizedExamTools.get(examToolsKey(quizInfo.courseId, quizInfo.quizId)) || [];
        if (!tools.length) {
            debugLog('No external exam tools configured for this quiz');
            return;
        }

        renderExamToolsSidebar(quizInfo, tools);
    }

    function removeExamToolsSidebar() {
        const sidebar = document.getElementById(EXAM_TOOLS_SIDEBAR_ID);
        if (sidebar) {
            sidebar.remove();
        }
    }

    function examToolsKey(courseId, quizId) {
        return `${String(courseId)}:${String(quizId)}`;
    }

    function examSessionCapabilityKey(courseId, quizId) {
        return EXAM_SESSION_CAPABILITY_PREFIX + examToolsKey(courseId, quizId);
    }

    function persistExamSessionCapabilities(courseId, quizId, tools, exitGrant) {
        const safeTools = Array.isArray(tools) ? tools.filter(isUsableExamTool) : [];
        const safeExitGrant = typeof exitGrant === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(exitGrant)
            ? exitGrant
            : // A capability refresh without a fresh grant must not discard the
              // one this session already earned, or the exit redirect loses it.
              readExamSessionCapabilities(courseId, quizId).exitGrant;
        state.authorizedExamTools.set(examToolsKey(courseId, quizId), safeTools);
        try {
            sessionStorage.setItem(
                examSessionCapabilityKey(courseId, quizId),
                JSON.stringify({ tools: safeTools, exitGrant: safeExitGrant, ts: Date.now() })
            );
        } catch (error) {
            // Session storage can be unavailable in hardened or private browser contexts.
        }
    }

    function readExamSessionCapabilities(courseId, quizId) {
        try {
            const raw = sessionStorage.getItem(examSessionCapabilityKey(courseId, quizId));
            if (!raw) {
                return { tools: [], exitGrant: null };
            }
            const parsed = JSON.parse(raw);
            if (!parsed || !Number.isFinite(parsed.ts) || Date.now() - parsed.ts > EXAM_SESSION_CAPABILITY_TTL_MS) {
                sessionStorage.removeItem(examSessionCapabilityKey(courseId, quizId));
                return { tools: [], exitGrant: null };
            }
            return {
                tools: Array.isArray(parsed.tools) ? parsed.tools.filter(isUsableExamTool) : [],
                exitGrant: typeof parsed.exitGrant === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(parsed.exitGrant)
                    ? parsed.exitGrant
                    : null
            };
        } catch (error) {
            return { tools: [], exitGrant: null };
        }
    }

    function isUsableExamTool(tool) {
        if (!tool || typeof tool.label !== 'string' || typeof tool.url !== 'string') {
            return false;
        }
        try {
            const parsed = new URL(tool.url);
            return parsed.protocol === 'https:' && tool.label.trim().length > 0;
        } catch (error) {
            return false;
        }
    }

    function renderExamToolsSidebar(quizInfo, tools) {
        if (!document.body) {
            return;
        }
        injectExamToolsStyles();

        const storageKey = `seb_exam_tools_${quizInfo.courseId}_${quizInfo.quizId}`;
        const savedState = readExamToolsState(storageKey);
        const sidebar = document.createElement('aside');
        sidebar.id = EXAM_TOOLS_SIDEBAR_ID;
        sidebar.setAttribute('aria-label', 'Exam tools');
        sidebar.setAttribute('data-seb-tools-placement', 'automatic');
        sidebar.addEventListener('dragstart', (event) => event.preventDefault());
        sidebar.addEventListener('selectstart', (event) => event.preventDefault());
        if (savedState.collapsed) {
            sidebar.classList.add('is-collapsed');
        }
        if (savedState.left !== null && savedState.top !== null) {
            sidebar.style.left = savedState.left + 'px';
            sidebar.style.top = savedState.top + 'px';
            sidebar.style.right = 'auto';
        }

        const header = document.createElement('div');
        header.className = 'seb-tools-header';

        const dragHandle = document.createElement('span');
        dragHandle.className = 'seb-tools-drag-handle';
        dragHandle.setAttribute('aria-hidden', 'true');
        dragHandle.title = 'Drag to move exam tools';
        dragHandle.textContent = '\u2807';

        const title = document.createElement('div');
        title.className = 'seb-tools-title';
        const titleStrong = document.createElement('strong');
        titleStrong.textContent = 'Exam tools';
        const titleSmall = document.createElement('small');
        titleSmall.textContent = `${tools.length} available`;
        title.append(titleStrong, titleSmall);

        const controls = document.createElement('div');
        controls.className = 'seb-tools-controls';
        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'seb-tools-icon-button';
        resetButton.title = 'Move tools to the best available corner';
        resetButton.setAttribute('aria-label', 'Move tools to the best available corner');
        resetButton.textContent = '\u21ba';
        resetButton.addEventListener('click', () => {
            placeExamToolsAutomatically(sidebar);
            persistExamToolsState(storageKey, sidebar);
        });
        const collapseButton = document.createElement('button');
        collapseButton.type = 'button';
        collapseButton.className = 'seb-tools-icon-button';
        collapseButton.title = 'Collapse tools';
        collapseButton.setAttribute('aria-label', 'Collapse exam tools');
        collapseButton.setAttribute('aria-expanded', String(!sidebar.classList.contains('is-collapsed')));
        collapseButton.textContent = '-';
        collapseButton.addEventListener('click', () => {
            sidebar.classList.toggle('is-collapsed');
            const collapsed = sidebar.classList.contains('is-collapsed');
            collapseButton.textContent = collapsed ? '+' : '-';
            collapseButton.title = collapsed ? 'Expand tools' : 'Collapse tools';
            collapseButton.setAttribute('aria-label', collapsed ? 'Expand exam tools' : 'Collapse exam tools');
            collapseButton.setAttribute('aria-expanded', String(!collapsed));
            clampExamToolsPosition(sidebar);
            persistExamToolsState(storageKey, sidebar);
        });
        controls.append(resetButton, collapseButton);
        header.append(dragHandle, title, controls);

        const body = document.createElement('div');
        body.className = 'seb-tools-body';
        tools.forEach((tool) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'seb-tool-button';
            button.title = `Open ${tool.label}`;
            button.setAttribute('aria-label', `Open ${tool.label}`);
            button.addEventListener('click', (event) => openExamTool(event, tool), true);

            const mark = document.createElement('span');
            mark.className = 'seb-tool-mark';
            mark.textContent = tool.label.trim().slice(0, 1).toUpperCase();
            const text = document.createElement('span');
            text.className = 'seb-tool-text';
            const name = document.createElement('strong');
            name.textContent = tool.label;
            const host = document.createElement('small');
            host.textContent = examToolDisplayHost(tool.url);
            text.append(name, host);
            button.append(mark, text);
            body.append(button);
        });

        sidebar.append(header, body);
        document.body.appendChild(sidebar);
        collapseButton.textContent = sidebar.classList.contains('is-collapsed') ? '+' : '-';
        if (savedState.left !== null && savedState.top !== null) {
            clampExamToolsPosition(sidebar);
        } else {
            placeExamToolsAutomatically(sidebar);
        }
        makeExamToolsDraggable(sidebar, header, storageKey);
        window.addEventListener('resize', () => {
            if (document.getElementById(EXAM_TOOLS_SIDEBAR_ID) === sidebar) {
                clampExamToolsPosition(sidebar);
                persistExamToolsState(storageKey, sidebar);
            }
        }, { passive: true });
    }

    function openExamTool(event, tool) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
        }

        // A new user action supersedes any short focus recovery scheduled for
        // a prior tool launch.
        const launchVersion = ++state.examToolLaunchVersion;
        const windowName = getExamToolWindowName(tool);
        const existingWindow = state.examToolWindows.get(windowName);
        if (focusExamToolWindow(existingWindow)) {
            debugLog('Focused existing exam tool window: ' + tool.label, 'success');
            return;
        }

        // SEB's macOS WKWebView can create a window for about:blank but ignore
        // a later cross-origin location.replace(), leaving an empty window. A
        // direct user-gesture navigation is both reliable and subject to the
        // generated URL filter.
        const openedWindow = window.open(tool.url, windowName);
        if (!openedWindow) {
            debugLog('Exam tool window could not be opened: ' + tool.label, 'warn');
            return;
        }
        try {
            openedWindow.opener = null;
        } catch (error) {
            // Some embedded browser engines do not expose opener across a
            // newly-created cross-origin window. The named window remains
            // safe to reuse and SEB's allowlist remains the enforcement layer.
        }
        state.examToolWindows.set(windowName, openedWindow);
        focusNewExamToolWindow(tool, windowName, openedWindow, launchVersion);
    }

    function focusNewExamToolWindow(tool, windowName, toolWindow, launchVersion) {
        focusExamToolWindow(toolWindow);

        // Sheets performs a second, cross-origin startup navigation after its
        // initial document appears. In SEB's macOS WKWebView that navigation
        // can return focus to the Canvas window after the direct user-gesture
        // focus above. Reassert focus only for Sheets, and only for this most
        // recent tool launch, so normal tools and a student's later tool click
        // are never interrupted.
        if (!isGoogleSheetsToolUrl(tool.url)) {
            return;
        }
        [150, 500, 1100].forEach((delay) => {
            setTimeout(() => {
                if (
                    state.examToolLaunchVersion !== launchVersion ||
                    state.examToolWindows.get(windowName) !== toolWindow
                ) {
                    return;
                }
                focusExamToolWindow(toolWindow);
            }, delay);
        });
    }

    function isGoogleSheetsToolUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' &&
                parsed.hostname.toLowerCase() === 'docs.google.com' &&
                /^\/spreadsheets(?:\/|$)/i.test(parsed.pathname);
        } catch (error) {
            return false;
        }
    }

    function examToolDisplayHost(url) {
        try {
            const parsed = new URL(url);
            if (/\/seb\/tool\/youtube\/[A-Za-z0-9_-]{11}$/i.test(parsed.pathname)) {
                return 'youtube.com';
            }
            return parsed.hostname;
        } catch (error) {
            return 'approved tool';
        }
    }

    function focusExamToolWindow(toolWindow) {
        if (!toolWindow) {
            return false;
        }
        try {
            if (toolWindow.closed) {
                return false;
            }
            toolWindow.focus();
            return true;
        } catch (error) {
            return false;
        }
    }

    function getExamToolWindowName(tool) {
        let hash = 0;
        const source = tool.id || tool.url || tool.label || 'tool';
        for (let index = 0; index < source.length; index += 1) {
            hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
        }
        return 'seb_exam_tool_' + Math.abs(hash).toString(36);
    }

    function injectExamToolsStyles() {
        if (document.getElementById(EXAM_TOOLS_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = EXAM_TOOLS_STYLE_ID;
        style.textContent = `
            #${EXAM_TOOLS_SIDEBAR_ID} {
                position: fixed;
                top: 12px;
                right: 12px;
                z-index: 2147483000;
                width: min(260px, calc(100vw - 24px));
                max-height: calc(100dvh - 24px);
                color: #172033;
                background: #ffffff;
                border: 1px solid #d0d5dd;
                border-radius: 12px;
                box-shadow: 0 18px 44px rgba(24, 36, 56, 0.24);
                font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                overflow: hidden;
                isolation: isolate;
                -webkit-user-select: none;
                user-select: none;
                -webkit-touch-callout: none;
                touch-action: manipulation;
                transition: left 160ms ease-out, top 160ms ease-out, width 160ms ease-out;
            }
            #${EXAM_TOOLS_SIDEBAR_ID}.is-moving {
                cursor: grabbing;
                transition: none;
            }
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed {
                width: 182px;
            }
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed .seb-tools-body,
            #${EXAM_TOOLS_SIDEBAR_ID}.is-collapsed .seb-tools-title small {
                display: none;
            }
            .seb-tools-header {
                min-height: 48px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 9px 9px 9px 8px;
                background: #f8fafc;
                border-bottom: 1px solid #eaecf0;
            }
            .seb-tools-drag-handle {
                width: 24px;
                height: 32px;
                display: grid;
                place-items: center;
                flex: 0 0 auto;
                color: #98a2b3;
                border-radius: 7px;
                cursor: grab;
                font-size: 19px;
                line-height: 1;
                letter-spacing: -3px;
                touch-action: none;
            }
            .seb-tools-drag-handle:hover {
                color: #475467;
                background: #eaecf0;
            }
            .seb-tools-title strong,
            .seb-tool-text strong {
                display: block;
                color: #172033;
                font-size: 14px;
                line-height: 1.2;
                font-weight: 800;
            }
            .seb-tools-title small,
            .seb-tool-text small {
                display: block;
                margin-top: 2px;
                color: #667085;
                font-size: 12px;
                line-height: 1.2;
                font-weight: 700;
            }
            .seb-tools-controls {
                display: flex;
                margin-left: auto;
                gap: 6px;
            }
            .seb-tools-icon-button {
                width: 30px;
                height: 30px;
                border: 1px solid #d0d5dd;
                border-radius: 8px;
                background: #ffffff;
                color: #344054;
                font-size: 18px;
                font-weight: 800;
                line-height: 1;
                cursor: pointer;
            }
            .seb-tools-icon-button:hover {
                border-color: #98a2b3;
                background: #f9fafb;
            }
            .seb-tools-icon-button:focus-visible,
            .seb-tool-button:focus-visible {
                outline: 3px solid rgba(11, 99, 206, 0.36);
                outline-offset: 2px;
            }
            .seb-tools-body {
                display: grid;
                gap: 8px;
                padding: 10px;
                max-height: min(420px, calc(100dvh - 88px));
                overflow: auto;
                overscroll-behavior: contain;
            }
            .seb-tool-button {
                width: 100%;
                min-height: 48px;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 10px;
                border: 1px solid #dfe3ea;
                border-radius: 8px;
                background: #ffffff;
                color: #172033;
                text-align: left;
                cursor: pointer;
                -webkit-user-select: none;
                user-select: none;
                transition: border-color 120ms ease-out, background 120ms ease-out, transform 120ms ease-out;
            }
            .seb-tool-button:hover {
                border-color: #0b63ce;
                background: #eff8ff;
            }
            .seb-tool-button:active {
                transform: translateY(1px);
            }
            .seb-tool-mark {
                width: 30px;
                height: 30px;
                display: grid;
                place-items: center;
                flex: 0 0 auto;
                color: #175cd3;
                background: #eff8ff;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 900;
            }
            @media (prefers-reduced-motion: reduce) {
                #${EXAM_TOOLS_SIDEBAR_ID},
                .seb-tool-button {
                    transition: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function makeExamToolsDraggable(sidebar, handle, storageKey) {
        let drag = null;
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.isPrimary === false) {
                return;
            }
            const target = event.target;
            if (target && typeof target.closest === 'function' && target.closest('button')) {
                return;
            }
            event.preventDefault();
            const rect = sidebar.getBoundingClientRect();
            drag = {
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top
            };
            sidebar.classList.add('is-moving');
            sidebar.style.left = rect.left + 'px';
            sidebar.style.top = rect.top + 'px';
            sidebar.style.right = 'auto';
            sidebar.style.bottom = 'auto';
            sidebar.setAttribute('data-seb-tools-placement', 'manual');
            try {
                handle.setPointerCapture(event.pointerId);
            } catch (error) {
                // Pointer capture is unavailable in some embedded browser engines.
            }
        });
        const move = (event) => {
            if (!drag) {
                return;
            }
            const bounds = getExamToolsSafeBounds();
            const rect = sidebar.getBoundingClientRect();
            const maxLeft = Math.max(bounds.left, window.innerWidth - rect.width - bounds.right);
            const maxTop = Math.max(bounds.top, window.innerHeight - rect.height - bounds.bottom);
            const left = Math.min(Math.max(bounds.left, event.clientX - drag.offsetX), maxLeft);
            const top = Math.min(Math.max(bounds.top, event.clientY - drag.offsetY), maxTop);
            sidebar.style.left = left + 'px';
            sidebar.style.top = top + 'px';
        };
        const finish = (event) => {
            if (!drag) {
                return;
            }
            drag = null;
            sidebar.classList.remove('is-moving');
            try {
                handle.releasePointerCapture(event.pointerId);
            } catch (error) {
                // Pointer capture may already be released.
            }
            snapExamToolsToNearbyEdge(sidebar);
            persistExamToolsState(storageKey, sidebar);
        };
        // Listen on the window as well as using pointer capture. This keeps a
        // drag usable in embedded browsers that implement pointer events but
        // do not support setPointerCapture.
        window.addEventListener('pointermove', move, { passive: true });
        window.addEventListener('pointerup', finish, { passive: true });
        window.addEventListener('pointercancel', finish, { passive: true });
    }

    function clampExamToolsPosition(sidebar) {
        const rect = sidebar.getBoundingClientRect();
        const hasStoredPosition = sidebar.style.left && sidebar.style.top;
        if (!hasStoredPosition) {
            return;
        }
        const bounds = getExamToolsSafeBounds();
        const maxLeft = Math.max(bounds.left, window.innerWidth - rect.width - bounds.right);
        const maxTop = Math.max(bounds.top, window.innerHeight - rect.height - bounds.bottom);
        sidebar.style.left = Math.min(Math.max(bounds.left, rect.left), maxLeft) + 'px';
        sidebar.style.top = Math.min(Math.max(bounds.top, rect.top), maxTop) + 'px';
        sidebar.style.right = 'auto';
        sidebar.style.bottom = 'auto';
    }

    function placeExamToolsAutomatically(sidebar) {
        const bounds = getExamToolsSafeBounds();
        const rect = sidebar.getBoundingClientRect();
        const width = rect.width || Math.min(260, Math.max(160, window.innerWidth - bounds.left - bounds.right));
        const height = rect.height || 160;
        const candidates = [
            { name: 'top-right', left: window.innerWidth - width - bounds.right, top: bounds.top },
            { name: 'bottom-right', left: window.innerWidth - width - bounds.right, top: window.innerHeight - height - bounds.bottom },
            { name: 'top-left', left: bounds.left, top: bounds.top },
            { name: 'bottom-left', left: bounds.left, top: window.innerHeight - height - bounds.bottom }
        ].map((candidate, index) => {
            const positioned = {
                ...candidate,
                left: Math.min(Math.max(bounds.left, candidate.left), Math.max(bounds.left, window.innerWidth - width - bounds.right)),
                top: Math.min(Math.max(bounds.top, candidate.top), Math.max(bounds.top, window.innerHeight - height - bounds.bottom))
            };
            return { ...positioned, score: examToolsPlacementScore(positioned, width, height) + index / 100 };
        });
        const best = candidates.reduce((current, candidate) => candidate.score < current.score ? candidate : current);
        sidebar.style.left = Math.round(best.left) + 'px';
        sidebar.style.top = Math.round(best.top) + 'px';
        sidebar.style.right = 'auto';
        sidebar.style.bottom = 'auto';
        sidebar.setAttribute('data-seb-tools-placement', best.name);
    }

    function getExamToolsSafeBounds() {
        const margin = 12;
        let top = margin;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const chrome = document.querySelectorAll('#header, .ic-app-header, .ic-app-nav-toggle-and-crumbs, header, [role="banner"]');
        chrome.forEach((element) => {
            const rect = element.getBoundingClientRect();
            const spansMostOfViewport = rect.width >= viewportWidth * 0.45;
            const isTopChrome = rect.top <= margin && rect.bottom > margin && rect.bottom < viewportHeight * 0.4;
            if (spansMostOfViewport && isTopChrome) {
                top = Math.max(top, Math.round(rect.bottom) + margin);
            }
        });
        return { left: margin, top, right: margin, bottom: margin };
    }

    function examToolsPlacementScore(candidate, width, height) {
        const left = candidate.left;
        const top = candidate.top;
        const right = left + width;
        const bottom = top + height;
        let score = 0;
        const obstructions = document.querySelectorAll(
            '#header, .ic-app-header, .ic-app-nav-toggle-and-crumbs, #left-side, .ic-app-course-menu, header, [role="banner"], [role="navigation"]'
        );
        obstructions.forEach((element) => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) {
                return;
            }
            const overlapWidth = Math.max(0, Math.min(right, rect.right) - Math.max(left, rect.left));
            const overlapHeight = Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top));
            score += overlapWidth * overlapHeight;
        });
        return score;
    }

    function snapExamToolsToNearbyEdge(sidebar) {
        const rect = sidebar.getBoundingClientRect();
        const bounds = getExamToolsSafeBounds();
        const maxLeft = Math.max(bounds.left, window.innerWidth - rect.width - bounds.right);
        const maxTop = Math.max(bounds.top, window.innerHeight - rect.height - bounds.bottom);
        const snapDistance = 44;
        let left = Math.min(Math.max(bounds.left, rect.left), maxLeft);
        let top = Math.min(Math.max(bounds.top, rect.top), maxTop);
        if (Math.abs(left - bounds.left) <= snapDistance) {
            left = bounds.left;
        } else if (Math.abs(left - maxLeft) <= snapDistance) {
            left = maxLeft;
        }
        if (Math.abs(top - bounds.top) <= snapDistance) {
            top = bounds.top;
        } else if (Math.abs(top - maxTop) <= snapDistance) {
            top = maxTop;
        }
        sidebar.style.left = Math.round(left) + 'px';
        sidebar.style.top = Math.round(top) + 'px';
    }

    function readExamToolsState(storageKey) {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                return { collapsed: false, left: null, top: null };
            }
            const parsed = JSON.parse(raw);
            return {
                collapsed: !!parsed.collapsed,
                left: Number.isFinite(parsed.left) ? parsed.left : null,
                top: Number.isFinite(parsed.top) ? parsed.top : null
            };
        } catch (error) {
            return { collapsed: false, left: null, top: null };
        }
    }

    function persistExamToolsState(storageKey, sidebar) {
        try {
            const rect = sidebar.getBoundingClientRect();
            localStorage.setItem(
                storageKey,
                JSON.stringify({
                    collapsed: sidebar.classList.contains('is-collapsed'),
                    left: Math.round(rect.left),
                    top: Math.round(rect.top)
                })
            );
        } catch (error) {
            // Storage can be disabled in hardened browser contexts.
        }
    }

