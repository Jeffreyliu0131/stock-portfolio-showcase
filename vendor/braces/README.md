# Maintained security backport: braces 3.0.3

This directory contains the runtime files of the MIT-licensed npm release
[`braces@3.0.3`](https://github.com/micromatch/braces/tree/3.0.3), with a narrow
backport for [CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The upstream name and version are retained. This is a locally maintained patch,
not a new upstream release. The original license is in `LICENSE`.

## Changes and provenance

Only the security changes to `lib/constants.js`, `lib/parse.js`, `lib/compile.js`,
`lib/expand.js` and `lib/stringify.js` from
[upstream pull request 72](https://github.com/micromatch/braces/pull/72), at reviewed
commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`, are backported onto the published
3.0.3 files. The pull request was closed without an official release; the rest of
that branch's unreleased changes are not included. Package metadata is reduced
to local installation, license, engine and dependency information.

The patch caps combined brace/parenthesis nesting at 100, checks direct AST
inputs in all recursive walkers, honors stricter numeric `maxDepth` limits,
and rejects cyclic parent chains in expansion. The default limit cannot be
raised or disabled by options. Excessive input receives a bounded validation
error instead of exhausting the JavaScript stack. Previous stringify escaping
behavior is preserved. The patch does not claim to bound every possible
expansion size or sanitize arbitrary application input.

## Installation and verification

The root development dependency uses `file:vendor/braces`; the npm `$braces`
override makes micromatch use this same copy. Do not replace it with a registry
version until an official fix has been reviewed. No postinstall patch, runtime
download, package renaming or audit severity reduction is used.

Raw `npm audit` still reports the original upstream version and advisory.
`npm run audit:security` retains that report and accepts this one remediated
advisory only after verifying the exact backported source hashes, the installed
consumer resolution, every affected path remaining development-only, and the
security regression tests. Unknown advisories, changed dependency paths, source
drift, production use, audit/network errors or failed regressions block the gate.
This is a maintained remediation check, not an upstream patched-release claim.
Also run
`node --test scripts/tests/dependency-hardening.test.mjs` (included in
`npm run test:release` and `npm run verify`). The tests verify actual resolution
through micromatch, depth boundaries, malicious strings and ASTs, compatibility,
and the dynamic-import file matching used by the build chain.

This dependency belongs to the build toolchain, not application request handlers.
Any update requires both runtime builds, built-artifact smoke tests and the full
dependency regression suite. Once an official repaired release is available,
replace the local dependency/override together, remove this maintained copy,
and repeat those checks. Keep the original advisory visible in this record until
that replacement is complete.
