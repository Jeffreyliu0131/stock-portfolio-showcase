# Local builds and independent installation

This repository is an independent showcase snapshot containing general source, technical contracts, and synthetic fixtures. It has no connected production deployment and is not the development source for an existing service. The release mechanisms below are included for learning and for separately authorized installations in resources you own. Do not connect this showcase repository to another running service or replace that service's source to follow these examples.

A source commit, local build, uploaded version, and active deployment are separate states. Keep any installation's real origins, identifiers, credentials, release mappings, rollback references, and raw evidence in ignored private storage.

## Default local workflow

Use Node.js 22 and the committed lockfile:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

The environment template contains placeholders and keeps AI disabled. Append `?fixture=ready` to the local URL **only while `npm run dev` is running** for the labelled synthetic view. That view makes no account/provider requests. The query fixture is development-only and is unavailable in compiled builds, including the compiled demo.

For a compiled local demo:

```sh
npm run build
npm start
```

Default build/start select the demo target and `.next-demo/` output. The compiled demo does not automatically populate the development fixture. These commands do not publish a service. Demo uses example origins and does not consume private deployment wiring; keep provider secrets absent when performing credential-free review.

Explicit `build:provider`, `build:sites`, and `build:ci` remain available. The `production` and `research` experience names select code behavior: v3/two-entry presentation versus v4/research presentation. They do not indicate that this showcase is deployed.

## Before any independent public installation

Create a separate reviewed installation plan for your own source repository, accounts, data resources, access policy, and rollback path. Retain the application contracts rather than import another installation's configuration or operating history.

The included provider routes have an important access/cost boundary:

- Exact-origin CORS and Origin checks constrain browser behavior; they do not authenticate a server-side caller. Login on a Sites page does not authenticate a separate provider endpoint.
- In-process rate limits are best-effort, are not shared across instances, and reset with process state. They are not durable quotas or hard spending caps.
- Before exposing key-bearing provider routes, implement and verify server-side caller authentication/authorization, shared rate/usage controls, bounded concurrency/request cost, and provider/account budgets with an enforceable stop path. Keep paid routes disabled or unconfigured until those controls exist.

These are deployment prerequisites, not features claimed to be complete in this snapshot. A local build, correct CORS, concealed API key, or HTTP 200 cannot establish that the paid-call abuse boundary is closed. See [SECURITY.md](../SECURITY.md).

For an installation you independently operate, preserve its app/provider origins, app identity, access policy, D1 binding/schema/data, secrets, wire contract, and any legacy export path during maintenance. Applied migration SQL and matching journals/snapshots remain immutable. Do not use a reset, seed, automatic migration, or provider shutdown as a release shortcut.

## Explicit target configuration

Provider and Sites production builds require validated wiring for your independent installation:

| Input | Placement and meaning |
|---|---|
| `PORTFOLIO_SITES_ORIGIN` | Exact HTTPS application origin, with no path or trailing slash |
| `PORTFOLIO_PROVIDER_ORIGIN` | Exact distinct HTTPS provider origin |
| `SITES_PROJECT_ID` | Your independently configured Sites project identifier |
| `PORTFOLIO_EXPERIENCE` | Explicit installation policy: `production` or `research`; provider/Sites default to `production` |
| `PORTFOLIO_TARGET` | Low-level wrapper selection when used directly; default showcase npm build/start deliberately select demo |
| `.deployment/config.json` | Ignored local wiring: `sitesOrigin`, `providerOrigin`, `projectId`, `experience`; no provider keys |
| `.openai/hosting.json` | Generated/ignored in development source; a validated private publication overlay may track only `project_id`, `d1: "DB"`, `r2: null` |
| `NEXT_PUBLIC_*` wiring | Wrapper-generated nonsecret target, experience, and origin values; do not manually set conflicting values |

Secrets belong in server-only local or managed configuration. Never use client-prefixed variables for them. Review `PORTFOLIO_AI_ENABLED` and server provider settings independently from the experience/UI switch. Research availability depends on server configuration, including OpenAI credentials and the research-enable setting; hiding a UI entry is not endpoint authorization.

`PORTFOLIO_BUILD_MODE=check` permits synthetic CI wiring and creates non-deployable artifacts. The all-zero D1 identifier in local configuration is an emulation placeholder; the actual binding belongs to the installation's Sites project. Do not deploy this Worker directly with Wrangler.

## Verification and artifact integrity

For local dual-target validation without real deployment wiring:

```sh
npm run verify
npm run audit:security
npm run build:ci
npm run bundle:check
npm run smoke:built
```

For a separately authorized, configured installation candidate, build explicitly:

```sh
npm run verify
npm run build:provider
npm run build:sites
npm run bundle:check
npm run smoke:built
```

Run sequentially because framework-generated types are shared. `verify` ends with domain compilation and clears `dist`; run it before Sites. Provider emits `.next/`; Sites emits `dist/server/`, `dist/client/`, hosting metadata, and the complete Drizzle set. The wrapper clears stale target output/types, restores only recognized generated config changes, and rejects unrelated source changes.

Both explicit production targets record actual source SHA/fingerprint, canonical SHA/fingerprint, exact wiring, clean/dirty state, and artifact-manifest digest. A failed compiler or changing source does not receive a new seal. From the checkout that produced the relevant artifact, run:

```sh
npm run release:check -- provider
npm run release:check -- sites
```

The gate requires unchanged clean committed source, exact wiring, and a fresh deployable artifact. Demo/check-mode output cannot qualify. It discovers complete required file membership and verifies hashes/sizes, including runtime/client files, public assets, traced Next dependencies, Sites metadata, and every SQL migration/journal/snapshot. Only the seal files themselves are handled separately.

Source and Sites artifacts reject links. The narrow Vercel adapter alias exception permits only validated targets wholly within that output tree, with cycles rejected. Scratch, emulation databases, and logs stay outside publication content; contamination requires a fresh build rather than an exemption. This is a local integrity check, not a signature against privileged forgery.

## File projection into a Sites publication repository

In this section, **canonical source** means the reviewed source repository of your independently owned installation. It does not mean this showcase controls another service. A private publication repository can receive a verified file projection without becoming a second feature-development branch.

```text
installation source SHA + content fingerprint
  -> verified file export
  -> private hosting overlay + ordinary mirror commit
  -> build sourceSha = actual mirror SHA
  -> configured branch HEAD = uploaded version's commit SHA
```

1. From clean committed installation source, run `node scripts/sites-source-map.mjs export <empty-private-staging-directory>`. The exporter runs the public audit, copies source files, and records per-file hashes/SHA/fingerprint in `.publication/source-map.json`. It rejects dirty/changing source or a nonempty destination and changes no remote.
2. Use a clean checkout of your configured private publication branch. Review a diff that installs exactly the exported files and removes obsolete tracked source. Preserve `.git`, ignored credentials/caches, and your hosting overlay. Do not merge private Git ancestry into public source.
3. Only `.publication/source-map.json` and `.openai/hosting.json` may be tracked outside the canonical file set. The overlay has exactly `{ project_id, d1: "DB", r2: null }`, with two-space JSON indentation and a terminal newline. For subsequent releases, preserve that installation's project and binding.
4. Compare the mirrored map byte-for-byte with the fresh export; never edit hashes to bless drift. Stage the ignored map explicitly with `git add -f .publication/source-map.json`. Commit only the reviewed maintenance diff with the intended repository-local identity.
5. In that clean committed mirror run `node scripts/sites-source-map.mjs verify`, `npm ci`, relevant verification, `npm run build:sites`, `npm run bundle:check`, and `npm run release:check -- sites`. Its build SHA is the actual mirror commit; do not substitute the canonical commit identity for an artifact built elsewhere.
6. Push the configured publication branch after the release checks pass. Coordinate automatic deployment settings when manually verifying a release. Confirm the actual remote configured-branch HEAD equals build `sourceSha`; recheck connector constraints rather than assume arbitrary branch/commit selection exists.
7. Package from that same checkout. On macOS use the Sites packager with `COPYFILE_DISABLE=1` to avoid AppleDouble files. Verify the archive below, re-run `release:check -- sites`, and save the version with the actual mirror SHA and matching archive.
8. Deploy only to your independently owned Site and approved access policy. Privately record canonical SHA/fingerprint, actual mirror SHA, manifest digest, saved-version/deployment identifiers, acceptance, and rollback references. A pushed commit or saved version alone is not an active deployment.

Verify the archive from its mirror checkout:

```sh
python3 scripts/verify-sites-archive.py <archive>
```

If the packager emits owner/xattr metadata, normalize only after proving exact file membership and content:

```sh
python3 scripts/verify-sites-archive.py <archive> --normalize-to <new-normalized-archive>
python3 scripts/verify-sites-archive.py <new-normalized-archive>
```

The normalizer emits a separate archive without platform/owner metadata; it cannot discard unexpected files or approve changed bytes. Upload only a verified archive. Packaging alone does not establish a successful deployment.

## Independent-installation smoke and rollback

Use synthetic instrument/account fixtures in an isolated environment. Check market/FX schemas and feed/time semantics, v3/v4 protocol compatibility, no-store responses, allowed/disallowed preflight, provider account-current GET/POST refusal with forged identity, public PNG headers, and relevant local-data export behavior. Separately test the caller-authentication, shared limits, and budget stop mechanism added to your installation; existing smoke does not test those absent protections.

Sites acceptance includes anonymous denial, protected-page routing, your approved access policy, binding/migration consistency, user isolation, and CAS conflicts. Do not read or mutate real holdings for automated smoke. Real model calls require explicit cost/provider authorization; otherwise record live AI as untested. Physical-device and private account reconciliation remain separate acceptance.

For your own deployment, preserve prior compatible versions before promotion. Provider rollback retains its stable alias; Sites rollback changes app code without resetting D1. When rolling back both, choose a recorded compatible pair and preserve the v3 transition boundary; research compatibility needs its own checks. AI outages may use the server kill switch under authorization. Schema changes require a separate recovery plan.

## Source publication checks

Run `npm run public:check`, review staged source/images manually, and run `node scripts/public-history-audit.mjs` in a full readable repository. The history audit inspects paths/content and commit/tag metadata reachable from all local refs and HEAD; it neither fetches refs nor mutates history. CI sees fetched branches/tags only. Pull-request refs need explicit fetching into an audit mirror; caches, discussions, release attachments, inaccessible refs, and outside copies need separate review. Keep all raw audit and private operating evidence outside public Git.
