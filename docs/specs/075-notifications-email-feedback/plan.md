# Plan — spec 075: email feedback intake, suppression and activation

Spec: `spec.md` in this folder. Three PRs in order; each is one use-case group, each merges only on a green
exact-head `ci-gate`. Tier: C1a and C1b **Heavy** (migration, public webhook, grants); C2 **Medium** (no migration).
The pattern to copy is the WhatsApp intake; the files named "pattern" below are read, not edited.

Pattern files: `apps/api/src/modules/notifications/http/whatsapp-webhook.controller.ts`,
`http/whatsapp-webhook-security.ts`, `use-cases/receive-whatsapp-stop/`, `packages/db/schema/platform-whatsapp.ts`,
`packages/db/src/platform-whatsapp-database.ts`, `packages/db/src/platform-whatsapp-inventory.ts`,
`packages/db/migrations/0030_2026-10-01_platform-whatsapp-grants.sql`,
`apps/worker/src/modules/notifications/jobs/whatsapp-inbound.processor.ts`, `jobs/whatsapp-maintenance.processor.ts`,
`use-cases/process-whatsapp-inbox/`, `use-cases/recover-whatsapp-inbox/`, `use-cases/clear-whatsapp-payloads/`,
`persistence/drizzle-suppression.gate.ts`.

## Before code (both C1 PRs)

- Answers to ET-Q1 and ET-Q2 (`owner-questions.ar.md`); the plan below assumes the recommended options.
- Confirm against Resend's documentation: the three signature header names and the signing string; the event type
  names; the bounce classification field; whether `GET /emails/{id}` returns the tags and the recipient. Record what
  was found at the top of the PR description. A difference from `spec.md` is reported to the manager before coding
  around it.
- The migration lane: C1a holds the only migration. Build and test it on a private cluster; renumber and
  `pnpm db:generate` only when the manager grants the lane.

## PR-C1a — intake (API) and the tables · about 560 lines

Order: contract → migration + grants + RLS → verification (pure) → use case → adapters → integration tests.

| File | Change | Budget |
|---|---|---|
| `packages/contracts/src/notifications/resend-feedback.ts` (+ index export) | the allowlist schema, event and bounce enums, quarantine reason codes | 45 |
| `packages/db/schema/platform-email.ts` | the three platform tables | 85 |
| `packages/db/schema/notifications.ts` | `notificationAttemptFeedback` | 30 |
| `packages/db/migrations/NNNN_<date>_platform-email-feedback.sql` | tables, checks, indexes, RLS + FORCE on the tenant table, grants, `platform_email_is_suppressed` definer | 110 |
| `packages/db/src/platform-email-database.ts`, `platform-email-inventory.ts` (+ index export) | the facade on `pospay_notifications`, role and inventory assertions; no raw client exported | 70 |
| `packages/notifications/src/resend-webhook.ts` (+ index export) | signature verification, timestamp window, event digest; `readResendWebhookConfiguration` | 60 |
| `apps/api/src/modules/notifications/http/resend-webhook.controller.ts`, `resend-webhook-security.ts` | the route and its `onRequest` / raw-body hook; reuse the WhatsApp limiter helpers by extracting them only if no behaviour changes | 90 |
| `apps/api/src/modules/notifications/use-cases/receive-email-feedback/` | store, enqueue, confirm | 45 |
| `apps/api/src/modules/notifications/ports/` + `persistence/` | inbox repository port (Arabic doc line per method) and its Drizzle adapter; queue adapter | 55 |
| `apps/api/src/app.ts`, `main.ts`, `notifications.module.ts` | wire the optional capability; log its state | 25 |
| `.env.example`, `deploy/*.env.example`, the two compose files | `RESEND_WEBHOOK_SECRET` to the api | 10 |
| `docs/adr/0014-email-provider.md` (addendum), `CLAUDE.md` §5 (one clause + changelog), `docs/module-map.md` if an arrow is added | classification of the tables | 30 |
| Tests | signature unit spec; contract spec; API integration spec; privilege and RLS-negative specs; schema inventory spec | 330 (not counted in the 560) |

Notes:

- The use case contains no `drizzle`, `sql` or `fetch`; time and ids come from the `Clock` and `IdGenerator` ports.
- The request body is cleared in a `finally`, as the WhatsApp controller does (line 64-66).
- The digest key: reuse the notifications message-id HMAC helper with a new domain-separation label; do not add a
  new secret unless that helper cannot take a label — then report.
- Nothing in this PR reads or writes `notification_attempts`.

## PR-C1b — reconciliation, suppression, gate, delivery log (worker + one query) · about 520 lines

| File | Change | Budget |
|---|---|---|
| `packages/notifications/src/adapters/resend-retrieval.ts` (+ export) | `GET https://api.resend.com/emails/{id}`, native HTTPS, bounded timeout and response size, returns only id, tags and the canonical recipient | 70 |
| `apps/worker/src/modules/notifications/domain/email-feedback.ts` | pure rules: bounce classification → suppress or not, binding eligibility, retry spacing | 60 |
| `apps/worker/src/modules/notifications/use-cases/reconcile-email-feedback/` | retrieve → tenant transaction (lock, bind, evidence) → platform transaction (suppress, audit, resolve) | 80 |
| `use-cases/recover-email-feedback/`, `use-cases/clear-email-feedback-payloads/` | the two sweeps | 50 |
| `ports/email-feedback-inbox.repository.ts`, `ports/email-feedback-attempts.repository.ts`, `ports/email-retrieval.port.ts` | ports with Arabic doc lines | 45 |
| `persistence/drizzle-email-feedback-inbox.repository.ts`, `drizzle-email-feedback-attempts.repository.ts`, `drizzle-email-suppression.gate.ts` | adapters; the gate calls `platform_email_is_suppressed` and asserts read-committed like the WhatsApp gate | 110 |
| `jobs/email-feedback.processor.ts`, `jobs/email-feedback-maintenance.processor.ts`, queue registration | BullMQ wiring, id-only payloads | 55 |
| `email.module.ts`, `email-startup.module.ts`, `apps/worker/src/main.ts` | bind the real gate; start and stop the processors; capability log with the quarantined count | 30 |
| `apps/api/src/modules/notifications/queries/` (delivery log) + `packages/contracts` item schema + OpenAPI | `provider_receipt` by a lateral read of the latest evidence | 20 |
| Tests | domain unit spec; worker integration spec with a stub Resend server; gate spec; `EXPLAIN` specs; delivery-log shape spec | 420 (not counted in the 520) |

Notes:

- Two transactions, never nested: the tenant one first, the platform one second. Each is idempotent on its own.
- The retrieval runs outside both. No address is assigned to a variable that outlives the hash computation.
- The lock order is fixed: the attempt row only. No phone lock, no other attempt.
- `domain/email-feedback.ts` carries full Arabic JSDoc on every exported function.
- The capability stays `enabled: false`; a test asserts that no send path changed.

## PR-C2 — activation · about 220 lines

Follows `docs/plans/briefs/2026-11-23-prod/PR-C-email-via-resend.md` (section PR-C2) with the requirements FR-020 to
FR-024. Files: `packages/notifications/src/email-configuration.ts`,
`apps/worker/src/modules/notifications/email.module.ts`, `email-startup.module.ts`,
`persistence/email-channel.adapter.ts`, `apps/api/src/main.ts:38`, the compose and env example files (worker only).
Budget: production 90, tests 110, compose and env 20. No migration, no new table, no contract change.

## Gates

- Local, each PR: typecheck, lint, `pnpm lint:docs`, `pnpm module-map:check`, the specs the PR adds or touches (DB
  specs on the PR's own private cluster, one at a time). Then the implementer runs `clean-code-guard`, `test-guard`
  and — for C1a and C1b — `waleed-security-reviewer` (PP-198).
- `ci-gate` on the exact head decides the full `pnpm check` and the API shards.
- C1a deploys to staging alone after merge, with a PP-129 snapshot before `migrate`.

## Staging proof before production (manager and Waleed)

1. After C1b: send a signed test event from the Resend dashboard to staging; the row is stored, reconciled or
   quarantined with a reason, and nothing in the logs contains an address.
2. After C2 on staging: one real delivery to a mailbox Waleed controls, one hard bounce (a non-existent mailbox on a
   domain he controls) and one complaint, each visible as `provider_receipt`; a second send to the bounced address is
   refused as `SUPPRESSED`.
3. Only then are the email keys entered for production.

## Sizes and caps

| PR | Production + config + docs | Tests | Cap (2× the first column) |
|---|---|---|---|
| C1a | 560 | 330 | 1,120 |
| C1b | 520 | 420 | 1,040 |
| C2 | 110 | 110 | 220 |
| Total | 1,190 | 860 | — |

## Risks

- **Resend's webhook details differ from the spec.** Confirmed first, before code; the verification is one small
  pure file, so a change is contained.
- **`GET /emails/{id}` does not return tags.** Then tenant resolution has no authenticated source and ADR-0014 §3
  cannot be met as written — stop and report; do not fall back to the tags in the webhook body.
- **Shared Resend account with another product.** Foreign events quarantine by design; the count is logged so a
  flood is visible.
- **Global suppression blocks a mistyped-then-corrected address.** By design until a lift tool exists (ET-Q3); the
  owner sees `SUPPRESSED` in the delivery log.
- **A second migration lands first.** The C1a migration touches no existing table, so a renumber is mechanical.
