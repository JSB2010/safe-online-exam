# Development matcher security review

The exact `minimatch@10.2.6` override selects `11.0.5` for the development lint
stack. It does not migrate application dependencies or change production
behavior. Remove the override when all lint consumers accept a fixed release
natively, after rerunning the compatibility tests and dependency gates.

## Advisory and scope

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
(CVE-2026-118764, moderate) affects minimatch `>=7.0.0 <11.0.1`. Attacker-controlled
patterns can amplify glob parts and consume excessive CPU/memory when
`optimizationLevel >= 2`. The first patched release is `11.0.1`.

The lockfile has one affected matcher, used only by development dependencies:

- ESLint 10 (`^10.2.5`).
- `@eslint/config-array` 0.23.5 (`^10.2.4`).
- `@typescript-eslint/typescript-estree` 8.72.1 (`^10.2.2`).

These consumers do not enable optimization level 2, and the application does
not expose their glob patterns as a public input. The matcher and its new
`@isaacs/nonrecursive-glob-match` dependency are both marked development-only
and omitted from the production install. This addresses a development
supply-chain advisory, not a confirmed production exploit.

## Why this version and override

ESLint 10's current constraints exclude minimatch 11. Downgrading ESLint or
`@eslint/js` to satisfy an automated security solver is not an appropriate
routine fix. The override applies only to the reviewed vulnerable version,
not every past or future minimatch version.

[Minimatch 11](https://github.com/isaacs/minimatch/releases/tag/v11.0.0)
replaces regular-expression matching and removes `makeRe`, `AST`, and some
options. This is a deliberate, tested security exception to transitive semver
compatibility, not an assumption that major releases are interchangeable.
The three consumers use the retained `minimatch` function or `Minimatch`
constructor, `match`, and `pattern`; they do not use the removed APIs.

[Version 11.0.5](https://github.com/isaacs/minimatch/releases/tag/v11.0.5)
includes additional bounds on expansion cells, rejects incomplete expansions,
and removes the quadratic pairwise deduplication. It is preferred over the
first patched 11.0.1 release, which could truncate expansion. The npm registry
records 11.0.5 publication at 2026-11-05T23:30:59.365Z, more than three days before
this review on November 10. Its Node requirement (`20 || >=22`) supports Node 24.
No release-age exception, lifecycle approval, audit suppression, major migration
hold, or CI security gate is changed.

## Regression coverage

`test/server/minimatch-compatibility.test.ts` checks resolution from all three
consumers, their retained matching APIs, dotfiles, brace/extglob patterns,
partial path matching, actual ESLint source and ignored-file selection, and
bounded rejection of a globparts amplification pattern in a timed subprocess.
Run it alongside the complete repository verification and supply-chain gates.
