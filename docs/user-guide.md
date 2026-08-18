# User Guide

This guide explains the workflows visible in Canvas. It assumes a working
deployment, completed [Canvas setup](canvas-setup.md), and at least one
supported client with Safe Exam Browser installed.

## Roles At A Glance

| Role                        | Opens Safe Online Exam from                                                      | Primary responsibility                                                                        |
| --------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Root-account administrator  | **Safe Online Exam Admin** in account navigation                                 | Connect courses, recover settings, and manage school tool presets                             |
| Instructor                  | **Safe Online Exam** in course navigation                                        | Configure course policy and choose which assessments require SEB                              |
| Student                     | **Safe Online Exam** in course navigation when enabled, or from a protected quiz | Connect Canvas, run the optional setup check, and launch protected assessments                |
| Infrastructure/device admin | Outside Canvas                                                                   | Operate the service and deliver the SEB configuration-encryption identity to approved clients |

Canvas LTI identity and Canvas API authorization are separate. The first time
a user needs Canvas API access, the application displays **Connect Canvas**.
The authorization belongs to that Canvas user and can be refreshed with
**Reconnect Canvas** if scopes, credentials, or Canvas permissions change.

## Canvas Administrators

The root-account dashboard is not a public `/admin` page. It is available only
through the LTI `account_navigation` placement and requires a signed Canvas
administrator role, a signed root-account-admin value, numeric account claims,
and administrator OAuth access.

### Authorize The Dashboard

1. Open **Safe Online Exam Admin** from the Canvas root account.
2. Select **Authorize Canvas** when prompted.
3. Review the requested course, term, account, and assessment permissions.
4. Complete Canvas authorization and return to the still-open LTI page.

The application stores one refreshable OAuth grant per Canvas user. An
administrator grant includes the ordinary course/student capabilities, so the
same person does not need separate tokens for teaching and administration.

### Connect Courses

The dashboard tracks only courses deliberately connected to Safe Online Exam.
It does not import the root account’s complete history.

1. Open **Configured courses** and choose **Connect courses**.
2. Search Canvas’s active course catalog. Filter by enrollment term when
   useful.
3. Select the intended courses and connect them.
4. Open a connected course and select **Refresh** to synchronize current
   Classic Quiz and New Quiz metadata.

The **Operational term** selection is shared by the root account and persists
across browsers and reloads. The dashboard shows non-concluded connected
courses in that term by default. Use **Show past and other courses** to inspect
historical connections; changing terms or course status never deletes those
records. Safe Online Exam refreshes stored Canvas course status periodically
and whenever a course is connected or manually refreshed.

Course connection gives the root administrator a recovery and rollout view; it
does not enable SEB for every assessment.

### Recover A Course Or Assessment

From a connected course, a root administrator can:

- reveal the effective course start and exit passwords for 30 seconds;
- rotate the course exit password;
- reveal an assessment’s start password, exit password, and current Canvas
  access code for 30 seconds;
- reset an assessment exit password to the current course or managed default;
- regenerate a Canvas access code;
- reset assessment policy to course defaults;
- enable or disable SEB; and
- refresh assessment metadata from Canvas.

To rebuild an entire course from a clean Safe Online Exam setup, choose the
course reset action and enter the exact Canvas course ID. The reset first
records the current access-code state of every Classic Quiz and New Quiz in
Canvas, then removes every current code.
Only after all Canvas changes succeed does it delete the local course policy,
assessment settings, outstanding course grants, and school-tool assignments for
that course. It preserves the Canvas OAuth grant and administrator course
connection. The next instructor launch opens guided setup again. School tools
must be assigned again if the rebuilt course should use them. If Canvas rejects
or cannot confirm any assessment change, Safe Online Exam restores the exact
pre-reset Canvas access-code state for every assessment already removed or
possibly changed during that attempt and keeps the local assessment settings
available for recovery and retry. If Canvas cannot confirm a restoration, the
dashboard requires manual verification of every assessment before another
reset.

Use reveal and recovery actions only through the embedded dashboard. Sensitive
responses are short-lived and sent with no-store headers. Do not copy them
into tickets or chat. Every administrator mutation requires a short-lived
action token bound to the current LTI identity, root account, deployment, and
session.

### Manage School Exam Tools

A school tool preset is a reviewed web resource that administrators can assign
to connected courses.

1. Open **Approved exam tools**.
2. Create a preset with a clear name, exact HTTPS launch URL, and only the
   resources it needs.
3. Assign it to selected connected courses, or to all connected courses.
4. Review the rollout result and retry failed assignments.

An assigned preset becomes school-managed in that course. Instructors may
enable or disable it for assessments, but they cannot silently rewrite its
launch or resource policy. Editing a preset marks assigned courses for
reconciliation. Remove it from courses before deleting it.

The application supports at most 32 school presets per root account and 2,000
courses in one bulk rollout request. Large institutions should connect and
roll out in reviewed batches.

## Instructors

Open **Safe Online Exam** from the Canvas course-navigation menu. The server
uses the signed LTI course and role claims; changing a course ID in a URL does
not authorize another course.

### First Course Setup

The guided setup has four stages:

1. **Welcome:** review the short course-setup sequence.
2. **Exit password:** set a course exit password when the course does not
   already have effective managed protection. This password protects native
   early quit; it is not a Canvas access code.
3. **Exam tools:** enable only the approved resources students need. This is
   optional when an assessment needs no additional tools.
4. **First assessment:** save the course policy, then enable an assessment from
   the list.

Each stage must be valid before **Continue** advances. Password fields show the
same live requirements enforced by the server, and incomplete exam-tool
definitions identify the field that needs attention.

Course policy remains editable from **Course settings** after onboarding. Use
**Advanced website access** there only when an exam tool cannot express the
resource a student needs.

### Refresh Assessments

Select the refresh action when Canvas quizzes have been created, renamed,
published, unpublished, or changed outside Safe Online Exam. The service
discovers:

- Classic Quizzes through the Canvas REST API; and
- New Quizzes through the assignment and New Quiz APIs.

For student launch, cached assessment metadata must be currently verified,
published, and within Canvas’s global unlock and lock window. Failed or stale
discovery fails closed rather than trusting old availability data.

### Configure Course Policy

Course policy provides defaults for:

- an optional start password;
- the required effective exit password;
- allowed URL rules under **Advanced website access**; and
- the course exam-tool catalog.

A start password protects the inner `.seb` payload and is a second check before
the assessment opens. It does not replace certificate encryption, Canvas
authentication, or Config Key proof.

The exit password protects native early quit. It is not the Canvas access code.
Do not reuse the same value for start and exit protection. New passwords must
be 8–128 characters after surrounding spaces are removed, contain at least five
different letters or numbers, contain no control characters or line breaks,
and avoid common words, sequences, and repeated patterns.

### Add Exam Tools And URL Rules

An exam tool has an exact HTTPS launch page plus a deliberate resource policy:

- **This page or file only** for one exact resource;
- **This address and related links** for a bounded site path; or
- **This whole website** only after explicitly accepting broader access.

Add cross-site resources such as CDN or embedded-content hosts only when the
tool genuinely needs them. The generated SEB URL filter—not the visible
sidebar—controls what the client can load.

Use the dedicated YouTube-video option for one public video. It creates a
server-owned embedded player and does not allow general YouTube browsing or
Google sign-in.

Course and assessment settings keep generic URL rules under **Advanced website
access**. Use them only when an approved exam tool cannot cover the resource;
the normal course setup flow does not ask for URL rules.

Instructor-owned course tools can be duplicated to other active courses where
the same Canvas user is a teacher:

1. Open the tool and choose **Duplicate to courses**.
2. Select one or more eligible target courses.
3. Confirm the copy result.

The server retrieves the teacher-course list again before writing. Copying
appends an equivalent tool without replacing the target catalog and is safe to
retry. School-managed presets and quiz-only tools cannot be duplicated this
way.

### Configure An Assessment

Open an assessment’s settings to:

- inherit course policy or set assessment-specific start/exit passwords;
- select a subset of course tools;
- add tools that exist only for this assessment; and
- add assessment-specific URL rules from **Advanced website access**.

Selecting no course tools is a valid explicit policy. A quiz-only tool never
becomes a course default.

Any protected-policy change changes the configuration fingerprint. Students
must download a fresh `.seb` file after a password, tool, URL, certificate, or
relevant service setting changes.

### Enable Or Disable SEB

Enabling requires an effective exit password. The service:

1. generates a new access code;
2. updates the appropriate Canvas Classic Quiz or New Quiz;
3. persists the SEB policy only after Canvas accepts the change; and
4. exposes the assessment to the student launch list.

Routine instructor responses do not return the access code. Use the explicit,
short-lived password reveal only for authorized recovery.

Disabling removes the Safe Online Exam requirement through the corresponding
Canvas API and updates the local state. Verify the Canvas assessment after any
upstream error instead of manually editing both systems in parallel.

## Students

### Connect Canvas

1. Open **Safe Online Exam** from the Canvas course.
2. Select **Connect Canvas** when prompted.
3. Approve the Canvas authorization.
4. Return to the course tool.

The authorization lets the service request a one-time Canvas session URL for
SEB. It does not copy the browser’s cookies into the `.seb` file.

### Run The Optional Setup Check

Run **Setup check** before the first high-stakes assessment on each device:

1. Confirm the Canvas connection.
2. Allow the browser to open Safe Exam Browser.
3. Wait for the check page to report readiness.
4. Quit SEB and return to Canvas.

The check exercises configuration download, certificate decryption, SEB
runtime detection, storage, connectivity, and Config Key proof. It does not
release an assessment access code, prove the device is institution-managed, or
guarantee that a future network and assessment will be unchanged.

Until the reminder is dismissed or the check is started, protected quiz launch
pages show **Setup check (recommended)** beside **Return to course** and **Open
Safe Exam Browser**. The dialog opens only when the student selects that button;
it never interrupts or blocks the normal assessment launch. After dismissal or
starting the check, the ordinary **Setup check** action remains available
without the recommendation. This reminder preference is not a device-trust or
setup-completion record.

### Open An Assessment

1. Choose the assessment from the student list or its Canvas quiz page.
2. Select **Open Safe Exam Browser**.
3. Approve the browser’s native-protocol prompt.
4. If SEB does not open, use the delayed recovery panel to install or open it,
   then retry with a fresh launch.
5. Complete the assessment in SEB.

The launch uses a one-time, short-lived configuration grant. Reusing an old
download URL or old configuration after settings changed will fail.

Once Canvas loads inside SEB, the detector asks the SEB JavaScript API for the
current Config Key and submits proof to the service. Only valid current proof
can release the Canvas access code, selected tools, and an exit grant. The
detector fills only an unambiguous Canvas access-code prompt.

### Finish And Exit

Cancelling a Canvas submission confirmation does not start the exit flow.
Classic Quiz exit waits for Canvas’s completed-submission result. New Quiz
exit waits for its authoritative result interface. After completion, use the
displayed quit action.

Native early quit remains protected by the effective exit password. Contact
the instructor or approved support channel for recovery; do not attempt to
bypass the client policy.

## Support And Privacy

When helping a user, record:

- the public release version or active revision;
- role and placement used;
- assessment type;
- approximate timestamp and time zone;
- browser, operating system, and SEB version;
- the visible error message; and
- whether the failure occurs before LTI launch, during Canvas authorization,
  while opening SEB, or after the assessment page loads.

Do not collect access codes, OAuth tokens, cookies, one-time session URLs,
`.seb` files from a live assessment, private keys, `.p12` identities, database
dumps, or student content. Continue with the safe diagnostic sequence in
[Troubleshooting](troubleshooting.md).
