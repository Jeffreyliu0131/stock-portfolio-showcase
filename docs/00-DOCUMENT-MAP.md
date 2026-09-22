# Document map

These documents describe the complete source and reusable contracts included in an independent showcase snapshot. This repository is not a production development source and has no connected live deployment. `production` and `research` are code experience variants, not deployment-status claims.

Start with the [local demo instructions](../README.md#run-locally). `?fixture=ready` works only with `npm run dev`; compiled demo builds do not provide that query fixture. Deployment mechanisms are retained for learning and independently owned installations, not for changing an existing service's source.

| Document | Responsibility |
|---|---|
| [Product](01-PRD.md) | Intended use, capabilities, experience variants, and exclusions |
| [Domain](02-DOMAIN-AND-CALCULATIONS.md) | Financial formulas, precision, current-state semantics, market/FX boundaries, and backup rules |
| [UX](03-UX-SPEC.md) | Visible flows, failure states, interaction requirements, and accessibility acceptance |
| [Architecture](04-TECHNICAL-SPEC.md) | Runtime responsibilities, storage, identity, API boundaries, and source modules |
| [Acceptance](05-ACCEPTANCE-CRITERIA.md) | Observable pass/fail criteria |
| [Testing](06-TEST-STRATEGY.md) | Verification commands, synthetic coverage, and evidence limitations |
| [Operations](09-PRODUCTION-OPERATIONS.md) | Local demo, independent-installation prerequisites, build integrity, publication mapping, smoke checks, and rollback |
| [AI system](AI-SYSTEM.md) | Portfolio and issuer-research contracts, prompts, data flows, and eval limits |
| [Security](../SECURITY.md) | Public-source, credential, runtime-data, and reporting boundaries |
| [Agent contract](../AGENTS.md) | Change and validation rules |

Financial formulas have one owner: the domain document. Other documents link to that contract rather than define competing arithmetic. An implemented module, synthetic test, source publication, production deployment, and real-device acceptance are distinct facts. Record verification against the exact source and artifact tested; do not infer a live result from code existence.
