# Project contract

This repository is an independent public showcase snapshot with general source, technical contracts, and synthetic fixtures. It is not a production development source and has no associated live deployment. Default build/start commands select the local demo; explicit provider/Sites targets remain for technical study and independently owned installations. Before editing, read [README](README.md), [operations](docs/09-PRODUCTION-OPERATIONS.md), and the task-relevant contract in the [document map](docs/00-DOCUMENT-MAP.md).

- Preserve exact Decimal math, unified cash, broker quantities/costs, JSON v2/v3, empty-only atomic restore, CAS/revisions, and existing IndexedDB data. Formulas belong in [the domain contract](docs/02-DOMAIN-AND-CALCULATIONS.md).
- In the included architecture, a Sites installation owns authenticated account current in D1. Provider has no account-current access and retains a legacy local-data export interface. Platform authentication headers are trusted only behind Sites dispatch. These contracts do not imply that this repository has a running installation.
- Preserve the `production` and `research` experience variants: two AI entries and wire v3 versus research presentation/v4. The `production` label is a code policy, not a live-service status. Keep `?fixture=ready` development-only under `npm run dev`; compiled demo builds do not support that fixture.
- Public documentation contains general product and engineering contracts. Do not add private financial facts, conversations, account plans, operating diaries, machine paths, production identifiers, or private history. Keep necessary private records in an ignored local location; do not read real holdings or credentials merely to document behavior.
- Use synthetic fixtures and placeholder configuration. Provider secrets remain server-only. Review filenames, prose, images, staged changes, and Git author/committer metadata as well as automated secret scans. Do not import private repositories, operating history, or another installation's wiring into this snapshot.
- Applied migration SQL and matching metadata are immutable. No runtime DDL, seed, reset, automatic migration, or storage change without a separate reviewed data plan.
- Validate demo defaults and explicit provider/Sites builds after shared configuration changes. Run `verify` before Sites because domain build clears `dist`. Keep one copy of business logic. For a separately authorized installation, add/review server-side caller authentication, shared rate/usage controls, and spending boundaries before exposing key-bearing provider routes; CORS and in-process limits do not supply these guarantees.
- Publishing, source connection changes, access changes, Git commit/push/merge, and retirement operations require explicit task authorization. Do not connect this showcase to an existing service or replace its running source. Release examples apply only to independently owned installations. A local build is not a deployment or user acceptance.
- Update the existing contract owner when behavior changes; keep private release evidence separate. Do not turn dated test results or archived plans into current feature claims.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
