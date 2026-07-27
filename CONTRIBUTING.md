# Contributing

Thank you for improving Safe Online Exam. By submitting a pull request,
patch, or other contribution, you confirm that you have the right to make
that contribution and agree to the contributor grant below.

## Before You Start

- Use a GitHub issue for a reproducible non-sensitive bug or a focused feature
  proposal when discussion would prevent duplicate work.
- Use
  [private vulnerability reporting](https://github.com/JSB2010/safe-online-exam/security/advisories/new)
  instead of an issue for suspected security problems.
- Do not include student data, school-private URLs, credentials, access codes,
  session URLs, database dumps, `.seb` assessment files, or client private
  identities in an issue, branch, fixture, screenshot, or log.
- Read the [documentation guide](docs/README.md), [architecture](docs/architecture.md),
  and [canonical repository guidance](AGENTS.md) for the area you plan to
  change.

This project accepts focused changes that preserve Canvas LTI URLs, public
compatibility routes, content identifiers, migration ordering, PostgreSQL
concurrency behavior, generated SEB behavior, and maintained deployment
targets unless a change intentionally migrates that contract.

## Development

Safe Online Exam requires Node.js 24 and the npm version pinned in
`package.json`.

```bash
npm ci
npm run verify
```

Run the PostgreSQL and browser layers when the change can affect their
boundaries:

```bash
npm run verify:postgres
npm run test:e2e
```

Use `bash scripts/compose-smoke.sh` for container, Compose, migration,
readiness, or persistence changes. See [Testing](docs/testing.md) for the full
test map and real Canvas/SEB acceptance sequence.

Do not commit generated `dist/`, coverage output, real environment files,
private keys, `.p12` files, local databases, or production diagnostics.

## Pull Requests

Keep each pull request reviewable and explain:

- the problem and user impact;
- the chosen behavior and compatibility implications;
- tests completed and their results;
- documentation updated;
- any migration, secret, Canvas, certificate, or deployment action required;
  and
- manual or live validation that remains.

Add a new forward-only migration rather than editing an applied migration.
Update the owning public guide when behavior, routes, configuration, setup,
deployment, operations, or test expectations change. Preserve unrelated
worktree changes.

Pull requests run application verification, PostgreSQL integration, production
Compose smoke, dependency review, and repository security analysis. A passing
test suite does not authorize deployment or release publication.

## Contributor Grant

You grant Jacob Barkin and his successors and assigns a perpetual,
worldwide, non-exclusive, irrevocable, royalty-free, transferable, and
sublicensable license to use, reproduce, modify, distribute, publicly
perform, publicly display, commercialize, and relicense your contribution
as part of Safe Online Exam or a derivative work, under the project's
current or future source-available and commercial licenses.

You also grant a patent license for patent claims that you can license
and that your contribution necessarily infringes when used as part of the
project.

If you contribute on behalf of an employer or another organization, you
confirm that the organization has authorized this grant. Do not submit
third-party code, assets, or data unless their terms permit this grant
and you identify the source and license in the pull request.

## License And Review

Contributions accepted into the public repository are made available in
that repository under the [PolyForm Noncommercial License 1.0.0](LICENSE).
The contributor grant above also lets the copyright holder offer managed
hosting and separate commercial licenses.

Keep changes focused, preserve public Canvas and SEB compatibility
contracts, and include tests and documentation when behavior changes.
