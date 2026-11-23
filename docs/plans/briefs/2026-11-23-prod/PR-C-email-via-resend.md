# Brief PR-C — email through Resend (two PRs)

Read first: `docs/plans/2026-11-23-production-messages.md` §2, ADR-0014 (all of §3 and §4), ADR-0018, ADR-0013 (the
WhatsApp intake is the pattern to follow), `packages/notifications/src/adapters/resend.channel.ts`,
`apps/worker/src/modules/notifications/email.module.ts`, `email-startup.module.ts`,
`persistence/email-channel.adapter.ts`.

## State today

The Resend adapter exists, but email is off by a constant
(`packages/notifications/src/email-configuration.ts:10-12`, reason `EMAIL_FEEDBACK_NOT_IMPLEMENTED`) and the worker
never constructs `ResendChannel` (`email.module.ts:44`). The owner decided on 2026-10-03 that hard-bounce and complaint
suppression must exist before live sending (ADR-0014 §3). So this is two PRs, in this order. **PR-C2 alone may ship
only if Waleed waives that decision for the pilot** (question in the messages document); the manager tells you which.

---

## PR-C1 — Resend feedback intake and suppression · Heavy (migration + public webhook)

This needs its own slice spec before code (`CLAUDE.md` §1 step 2): `docs/specs/NNN-notifications-email-feedback/`
through `/speckit-specify`, then a plan by Fable and one debate round (PP-195 Heavy). The spec settles what ADR-0014
§3 leaves to "PR 14's slice spec": the feedback inbox tables, whether intake is tenant or global, retention (30 days,
scrubbed), and the reconciliation retries.

**Goal.** A signed Resend webhook is verified, stored scrubbed, deduplicated by provider event id, acknowledged, and
processed by the worker into: provider-receipt evidence linked to the attempt, and a suppression entry for a hard
bounce or complaint that prevents a later attempt to that address.

**Shape (from ADR-0014, not negotiable):** verify the Svix signature and timestamp on the raw body → store → enqueue
→ 200; processing in the worker, never in the API request; no resend on bounce; no open or click tracking; no
automatic re-subscription; addresses stored as keyed hashes only.

**Files (expected; the spec confirms):** a migration with the inbox and suppression tables, grants and — if tenant
tables — RLS plus negative isolation tests; `apps/api/src/modules/notifications/` (webhook route, rate-limited,
guard-exempt by the same recorded mechanism the WhatsApp intake uses); `apps/worker/src/modules/notifications/`
(processor, use case, repository, the suppression gate that `email.module.ts:71` stubs with
`isSuppressed: async () => false`); `packages/notifications/src/` (signature verification, feedback parsing);
`docs/module-map.md` if an arrow is added; a new env key for the webhook signing secret in `.env.example`.

**Tests.** Signature valid / invalid / stale; replayed event ignored; bounce → suppression → next attempt refused;
complaint likewise; delivered → receipt evidence; callback before the send result commits; RLS negative tests for
every new tenant table; `EXPLAIN` on any new query.

**Size estimate:** about 900 lines (production 350, tests 450, migration and docs 100). Cap 1,800. The capability
stays `enabled: false` at the end of this PR.

---

## PR-C2 — activate email · Medium (no migration)

**Goal.** With complete configuration the worker sends operational email through Resend; with incomplete
configuration it stays off and says why. Nothing changes for in-app or push.

**Files.**

- `packages/notifications/src/email-configuration.ts` — return `enabled: true` only when `RESEND_API_KEY`,
  `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_ADMIN_ORIGIN`, `NOTIFICATION_EMAIL_HASH_KEY` (32+ characters) and
  `NOTIFICATION_EMAIL_HASH_KEY_ID` are all present and valid, and (after PR-C1) the webhook signing secret; otherwise
  `enabled: false` with a reason naming the missing group, never a value.
- `apps/worker/src/modules/notifications/email.module.ts` and `email-startup.module.ts` — construct `ResendChannel`
  from the environment when enabled; report the real capability state in the startup log; replace the
  `CONFIG_INVALID` default at `email.module.ts:90-92` with the rendered-template check for the live channel.
- `email.module.ts:67` and `persistence/email-channel.adapter.ts:15` — take the admin origin from
  `EMAIL_ADMIN_ORIGIN` instead of the literal.
- `apps/api/src/main.ts:38` — the API's capability log reads the same configuration.
- `deploy/docker-compose.staging-shared.yml`, `deploy/staging.env.example` (and `deploy/docker-compose.prod.yml`,
  `deploy/prod.env.example` if PR-A has merged) — pass the email keys to the **worker only**; the API gets none of
  the sending keys.

**Do not touch.** The WhatsApp path, the OTP module, the in-app and push consumers, the Resend request shape, any
template copy, any migration.

**Tests.** Configuration: each missing key keeps email off with the right reason; complete configuration turns it
on. Worker: with a stub HTTP server standing in for Resend, one authorized attempt is submitted once with the
idempotency key and recorded `PROVIDER_ACCEPTED`; a provider refusal is recorded and not retried as a new
submission; a suppressed address is refused before any HTTP call (after PR-C1). No real network call in any test.

**Size estimate:** about 220 lines (production 90, tests 110, compose and env 20). Cap 440.

---

## Local gates (both)

Typecheck, lint, `pnpm lint:docs`, `pnpm module-map:check`, the specs you touched; then the guard skills for the tier
(PP-198). `ci-gate` on the exact head decides the rest.

## Before any real email (manager and Waleed, not the implementer)

Sending domain verified with SPF, DKIM and DMARC; one controlled delivery, one bounce and one complaint exercised
against staging with the feedback recorded (ADR-0014 §4). An accepted send API response is not a delivery proof.

## Report

Branch, head SHA, test results, the capability log line in each state, and any point where ADR-0014 and the code
disagreed.
