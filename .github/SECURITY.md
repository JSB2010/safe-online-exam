# Security Policy

## Supported Versions

Security fixes are provided for the newest stable release in the current
`1.x` line. Operators should upgrade to the latest patch before reporting an
issue that may already be fixed. Older pre-release builds, local forks, moving
development images, and unmaintained deployment snapshots are not supported.

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

The application depends on Canvas, Safe Exam Browser, PostgreSQL, the host
platform, operating systems, browsers, and device-management policy. Their
supported versions and advisories remain separate. A supported application
release does not make an unpatched surrounding system supported.

## Report A Vulnerability

Do not open a public issue for a suspected vulnerability or include secrets,
student information, Canvas credentials, private keys, access codes, or
production URLs in a report.

Use GitHub's
[private vulnerability reporting](https://github.com/JSB2010/safe-online-exam/security/advisories/new)
to send the maintainers a confidential report. Include:

- the affected release or commit;
- the impacted route, workflow, or deployment mode;
- clear reproduction steps or a proof of concept;
- the security impact and any known mitigations; and
- whether the issue is already being exploited.

The maintainers will acknowledge the report, investigate it privately, and
coordinate disclosure and remediation according to its severity. Do not test
against school or production systems without explicit authorization.

## What To Report

Examples include:

- an LTI/OAuth authorization bypass;
- cross-course, cross-account, or cross-deployment access;
- replay or reuse of a one-time state, configuration grant, proof, or exit
  grant;
- disclosure of an access code, token, password, or private key;
- a generated configuration that weakens the documented SEB boundary;
- a route that permits unsafe server-side requests or unbounded upstream data;
  or
- a release/deployment artifact that violates its documented integrity or
  secret-handling contract.

Ordinary setup problems, feature requests, and non-sensitive reproducible bugs
belong in GitHub issues. Use [Troubleshooting](../docs/troubleshooting.md) to
remove credentials and private school details before posting.

## Deployment Responsibility

Self-hosters are responsible for timely application and platform updates,
public HTTPS, least-privileged IAM, protected secrets, PostgreSQL backups and
restore drills, monitoring, incident response, supported SEB clients, managed
client identities, and compliance with their institution’s privacy and
accessibility requirements.

Never upload the SEB `.p12` or private key to the application runtime. Never
enable production diagnostics, broaden URL filters, or disable certificate
encryption merely to investigate an incident. Preserve evidence, isolate the
affected workflow, and rotate only the compromised material.
