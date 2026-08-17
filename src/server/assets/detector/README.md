# Canvas detector source

The Canvas detector is authored as ordered source fragments because every part
shares the private scope of one browser IIFE. `manifest.json` is the canonical
assembly order. `src/server/services/detector-source.ts` joins the fragments
without separators so the result preserves the established browser behavior
byte-for-byte; the build then writes both readable and minified public assets.

The fragment boundaries follow runtime responsibilities:

- `core.js`: detector state, configuration, tracing, and shared DOM utilities
- `overlays.js`: reusable blocking and launch overlays
- `canvas-context.js`: Canvas route, course, quiz, and assignment discovery
- `exam-tools.js`: approved-tool launch surfaces and resource-rule handling
- `access-code.js`: Config Key proof and one-time access-code flow
- `submission.js`: submission detection, exit handoff, and recovery behavior
- `runtime.js`: mutation observers, navigation hooks, and startup

Fragments are intentionally not standalone programs: `core.js` opens the IIFE
and `runtime.js` closes it. Edit them in manifest order, then run the detector
and static-controller tests, `npm run build`, and `npm run test:e2e`.
