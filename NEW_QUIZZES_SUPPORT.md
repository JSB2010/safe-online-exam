# Canvas New Quizzes SEB Support

## Finding

Respondus does not appear to implement Canvas New Quizzes lockdown as a generic LTI-only pattern that any third-party tool can copy.

Public Canvas and Respondus evidence points to a Canvas-native Respondus integration:

- Canvas Assignments expose `require_lockdown_browser`, which is documented as "Respondus LockDown Browser required": https://canvas.instructure.com/doc/api/assignments.html
- Canvas LMS source stores lockdown fields under assignment `settings["lockdown_browser"]`, including `require_lockdown_browser`, monitor options, and `access_code`: https://github.com/instructure/canvas-lms/blob/master/lib/api/v1/assignment.rb
- Classic quiz lockdown enforcement calls `Canvas::LockdownBrowser.plugin`, a Canvas plugin hook tagged `:lockdown_browser`: https://github.com/instructure/canvas-lms/blob/master/app/controllers/quizzes/quizzes_controller.rb and https://github.com/instructure/canvas-lms/blob/master/lib/canvas/lockdown_browser.rb
- New Quizzes launches are generated through Canvas' New Quizzes launch-data builder rather than the classic quiz controller: https://github.com/instructure/canvas-lms/blob/master/lib/new_quizzes/launch_data_builder.rb
- Canvas exposes `Canvas.assignment.lockdownEnabled` as an LTI variable, backed by the assignment lockdown setting: https://canvas.instructure.com/doc/api/file.tools_variable_substitutions.html
- Respondus support articles describe Canvas-specific LTI installation, Instructure developer-key coordination, and Instructure hotfixes for New Quizzes launch failures:
  - https://support.respondus.com/hc/en-us/articles/4409604294811-Canvas-The-LockDown-Browser-LTI-Tool-is-not-appearing-in-my-course
  - https://support.respondus.com/hc/en-us/articles/46832915666587-Resolved-LockDown-Browser-Mac-and-iPad-Failing-to-Launch-with-Canvas-New-Quizzes
  - https://support.respondus.com/hc/en-us/articles/49831405234971-Resolved-LockDown-Browser-Dashboard-Error-for-Canvas

Do not set Canvas' `require_lockdown_browser` flag for SEB. That flag is Respondus-specific in Canvas' API/source contract and can route students into Respondus enforcement instead of this tool.

## Supported Architecture

This application should support New Quizzes through access-code enforcement plus SEB-controlled launch routing:

1. Discover New Quizzes as assignment-backed content using Canvas assignments with `new_quizzes=true`.
2. Hydrate New Quiz details from Canvas New Quizzes API `/api/quiz/v1/courses/{courseId}/quizzes/{assignmentId}` when available.
3. Enable enforcement by setting the New Quiz student access code through New Quizzes API quiz settings.
4. Store a content-scoped SEB setting using `newquiz:{courseId}:{assignmentId}`.
5. Update the Canvas module item from the New Quiz assignment to this tool's `/seb/launch/{contentId}` URL.
6. Generate the `.seb` file with `/seb/launch/{contentId}` as the start URL.
7. At launch, redirect SEB users to the New Quiz `canvas_launch_url` when available, otherwise to the Canvas assignment URL.
8. Serve the access code only through the secured SEB API path.

That is the reliable cross-deployment path available to an ordinary hosted Canvas LTI app. It uses documented Canvas/New Quizzes APIs and does not require a private Canvas plugin.

## Setup Requirements

- Canvas cloud deployment with New Quizzes API available.
- This LTI tool installed and reachable from Canvas.
- Canvas OAuth/API access for the instructor/admin user that can list assignments, update module items, and update New Quiz settings.
- The New Quiz must be in a Canvas module for automatic module-link replacement. If it is not in a module, the app still sets the access code and can provide a `.seb` file, but Canvas module navigation is not fully gated.
- Optional Canvas theme JavaScript can help auto-fill access codes on direct Canvas pages. The module launch plus access-code gate is the primary enforcement path.

## Limitation

This cannot fully reproduce Respondus' Canvas-native "LockDown Browser Required" behavior on hosted Canvas without Instructure-level or self-hosted Canvas plugin support. The practical SEB solution is to control the launch route and protect the New Quiz with a generated access code that is only exposed inside SEB.
