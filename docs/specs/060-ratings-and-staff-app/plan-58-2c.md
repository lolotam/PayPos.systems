# 58-2c plan — public rating opt-out capability

Date: 2026-10-30. Status: **PLAN — awaiting Waleed's admission** (technical, cards only; never on the decisions page).
Parent: [`plan-58-2-split.md`](plan-58-2-split.md) §58-2c. Base: `main` `d5d2f31a`. Builds on merged 58-1, 58-2a, 58-2b.

## Scope

`POST /v1/ratings/opt-out` (spec 060 FR-B10, D-B10, D-B11; ADR-0011 §3–§4; `CLAUDE.md` §5 fourth entry point): a
customer holding a valid rating link stops rating messages for her company-wide customer row, before or after rating,
until the link expires. Row 58-2's subtasks (spec §B.5): pure token parser + hash, per-IP admission, the opt-out use
case, its `@Public()` route and audit, tests RT-17 (opt-out part), RT-19, RT-20 (limits).
**No migration:** 0188 already grants `UPDATE (opted_out_at, updated_at)` and `customers_update` to `pospay_app`
(`0188…opt-out-guard.sql:2–5`), which also permits the row lock; every other table is only read.

Non-goals: rating issuance, claim or send (59b), the codec (59b-1), view/submit (60-1), the page and its CORS origin
(60-2), any restore (RT-Q10, RT-17b), notification activation, `platform_whatsapp_suppressions` writes (ADR-0013),
cancelling `SCHEDULED` requests (the claim rechecks, D-B5), any `rating_requests` write, env/server changes, ADR or
module-map changes (no new arrow).

## Verified facts (repository, 2026-10-30)

| Fact | Evidence |
|---|---|
| A claimed token row: `token_hash` set ⇔ status SENDING/SENT; `(company_id, token_hash)` unique | `0185_…rating-storage.sql:44,100` |
| After the claim `token_hash`, `expires_at`, `claimed_at` are frozen; `customer_id` is immutable; no DELETE grant | `0185:189–205`, `0185:153–159` |
| Customer write needs 58-2b; the guard refuses restore/replace (`23514 customers_opt_out_one_way`) | `0188:2–21`; `rls-customers.spec.ts:354–357` (both lock modes) |
| Three FKs reference `customers(company_id,id)`, so their inserts take `KEY SHARE` on the customer row | `0131:92` service_sessions, `0162:112` discount_proposals, `0185:92` |
| Today nothing UPDATEs `customers`; find-or-create only inserts `ON CONFLICT DO NOTHING` | `customers/persistence/drizzle-customer-transactions.ts:44–52` |
| Worker 59-1 locks `rating_requests` by day key `FOR UPDATE`, touches only unclaimed rows, never locks customers | `worker/…/persistence/rating-request.repository.ts:21–62` |
| Limiter throws `RateLimiterUnavailableError` on bad replies; nothing maps it, so today it would be a 500 | `shared/ports/rate-limiter.port.ts:52`; `shared/exception.filter.ts:30–43` |
| `RATE_LIMITER` is `null` when `deps.redis` is absent; the harness always builds Redis | `app.ts:142–143`; `test/harness.ts:228` |
| Customers clock is hard-coded (`ordersClock` is injectable); `CustomerTransactions.run` demands a `userId` | `customers.module.ts:21`; `app.ts:61,149`; `customer-transactions.port.ts:36–39` |
| `audit_log.actor_user_id` is nullable; `app_user_id()` is NULL without a user | `0003_…cross-cutting.sql:21`; `0000_…context-helpers.sql:8–10` |

## Behaviour

1. **Headers, then admission (D-B11):** every answer, errors included, sets `Cache-Control: no-store` and
   `Referrer-Policy: no-referrer` (ADR-0011 §4, RT-20). Then one key `rating-public:<request.ip>` for all three
   rating routes and prefixes, `hit(key, 30, 60)` (ADR-0011 §4 owner value); `request.ip` comes from `trustProxy`
   (`app.ts:240`), so untrusted forwarded headers are ignored. The token header is read after the hit, never in a
   pipe, so malformed tokens count. Over the limit: 429 `TOO_MANY_REQUESTS`, `retry-after` from `remaining(key)`, at
   least 1 (`clock-by-card.controller.ts:80`). **Fail-closed:** a `null` limiter, `RateLimiterUnavailableError` or a
   Redis rejection → 503 `NOT_READY`, before parsing or any database access (`devices.controller.ts:69–74`).
2. **Token transport:** header `x-rating-token` (`RATING_TOKEN_HEADER` in contracts; D-B10, ADR-0011 §4), redacted
   by the logger's `token` suffix (`packages/observability/src/redaction.ts:8–11`); never URL, query or body. Body and
   query are ignored, so no client-supplied id is read (ADR-0011 §1).
3. **Parse (pure, `domain/rating-token.ts`):** exactly `<uuid>.<43 chars>`; lowercase canonical 8-4-4-4-12 hex
   (`withTenant`'s check is case-insensitive, `with-tenant.ts:53`); unpadded base64url whose last character has its
   two low bits zero; no whitespace, `=`, `+` or `/`. Returns `{ companyId, canonical }` or `null`.
4. **Hash:** SHA-256 of the full canonical string, 32 bytes, through an injected `RatingTokenHash` port; the domain
   stays crypto-free (`TermsHashPort` precedent, `orders/domain/discount-terms.ts:86–97`).
5. **One `withTenant(candidateCompanyId)` with no user** (ADR-0011 §1, `CLAUDE.md` §5): (a) read `customer_id,
   expires_at` of the request with `token_hash = H`, **unlocked**; none → unavailable; (b) `SELECT opted_out_at
   FROM customers … FOR NO KEY UPDATE`; (c) sample the `Clock` after the lock; (d) `ratingOptOutDecision(expiresAt,
   now, optedOutAt)` in `domain/rating-opt-out.ts`: `now >= expiresAt` → unavailable (equality is expired); already
   opted out → done, no write; else (e) `UPDATE customers SET opted_out_at = now, updated_at = now WHERE … AND
   opted_out_at IS NULL RETURNING id`; only when one row returns, audit `customer` / `rating_opted_out` with
   `after: { opted_out_at }`, no phone, token or hash (FR-B10, `CLAUDE.md` §8).
6. **Uniform answers:** valid token → **204**, first or repeated (first time kept, ADR-0011 §3). Missing header,
   malformed, unknown, foreign-prefix or expired → **404 `RATING_LINK_UNAVAILABLE`** (new in `errors.ts` and i18n;
   «الرابط ده مش متاح.» / "This link is not available.", spec §B.4, RT-Q2 approved). No `Idempotency-Key`: no money
   or stock effect and the write is idempotent (§6). No feature mark on the route (`TODO(spec)` below).
7. **Composition:** `customersClock?` in `AppDependencies` (mirrors `ordersClock`); a session-less
   `RatingOptOutTransactions` port and Drizzle adapter (the existing one needs a user); the controller injects the
   shared `RATE_LIMITER`. One transaction per request, none on a refused admission or parse (§6 connection budget).

## Concurrency and lock analysis (fresh, as the split plan requires)

Opt-out holds exactly one row lock: the customer, `FOR NO KEY UPDATE`. It takes no request lock.

- **Why not lock the request:** the customer id comes from the request, so locking it first is request → customer,
  the inverse of the claim's customer → request (D-B5, FR-B05, ADR-0011 §3): a deadlock pair once 59b-2 exists.
  It would protect nothing: every field opt-out reads is frozen after the claim (`0185:189–205`), rows are never
  deleted, and opt-out writes no request.
- **Why `NO KEY UPDATE`, not `UPDATE`:** `FOR UPDATE` conflicts with the `KEY SHARE` that FK checks take, so it
  would stall service-session recording (`0131:92`), discount proposals (`0162:112`) and 59-1's request insert
  (`0185:92`, `rating-request.repository.ts:40`) behind a public request, and the reverse. The `UPDATE` touches no
  key column, so it stays at `NO KEY UPDATE` too.
- **Against each writer:** two opt-outs (duplicate POST, two businesses' links) serialise on the customer; the
  second re-reads the committed `opted_out_at` and writes nothing; 0188's guard is the backstop. The future claim
  (59b-2) locks the customer first, so commit order decides (opt-out first → `OPTED_OUT`; claim first → that one
  request may still be sent, ADR-0011 §3). The future submit (60-1) locks only the request. 59-1 and find-or-create
  never conflict. One lock per transaction → no cycle.
- **Binding on 59b-2:** its claim must lock the customer in a mode that conflicts with `NO KEY UPDATE` (`FOR NO KEY
  UPDATE` recommended; `FOR KEY SHARE` would not serialise). ADR-0011 §6's opt-out-racing-claim test lands there.

## Exact write scope (implementer)

New (N) or edited (E). Contracts: (E) `packages/contracts/src/customers/ratings.ts` (`RATING_TOKEN_HEADER`);
(E) `packages/contracts/src/customers-openapi.ts` (path, header parameter, 204/404/429/503 → `ErrorEnvelope`);
(E) `packages/contracts/src/__tests__/customers.spec.ts`. Errors and copy: (E) `apps/api/src/shared/errors.ts`
(`RATING_LINK_UNAVAILABLE: 404`); (E) `packages/i18n/src/ar.ts`; (E) `packages/i18n/src/en.ts`. Under
`apps/api/src/modules/customers/`:

1. Pure domain: (N) `domain/rating-token.ts`, (N) `domain/rating-opt-out.ts`, (N) their two specs under
   `domain/__tests__/` — Arabic JSDoc on every export (§3.1).
2. Ports (N): `ports/rating-opt-out.port.ts` (transactions; scope: find request, lock customer, mark, audit),
   `ports/rating-token-hash.port.ts`; adapters (N): `persistence/drizzle-rating-opt-out-transactions.ts`,
   `persistence/rating-token-hash.adapter.ts`.
3. Use case (N): `use-cases/opt-out-of-ratings/opt-out-of-ratings.usecase.ts` and its `.usecase.spec.ts`;
   HTTP (N): `http/rating-opt-out.controller.ts`, `http/__tests__/rating-opt-out.controller.spec.ts`.
4. Wiring (E): `customers.module.ts`, `apps/api/src/app.ts` (`customersClock?`); harness: (E)
   `apps/api/test/harness.ts` (`omitRedis?`, `customersClock?`), (N) `apps/api/test/rating-link.fixture.ts`.
5. Integration: (N) `__tests__/rating-opt-out.spec.ts`, (N) `__tests__/rating-opt-out-locks.spec.ts`,
   (N) `__tests__/rating-admission.spec.ts`, (N) `__tests__/rating-opt-out-no-redis.spec.ts`.

Generated by the lead, never the implementer: `packages/contracts/openapi/openapi.json` (`pnpm contracts:openapi`,
asserted by `openapi.spec.ts:263`), `apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts`
(`api:generate`; `api:check` runs in root `pnpm check`). The implementer runs no shell, tests, installs, Git writes or
database operations; it returns changed paths, reasoning and limits.

## Tests

| Spec / rule | Cases (integration on the T2 Postgres via the harness, ADR-0006, unless marked unit) |
|---|---|
| Parser (unit) | lowercase canonical accepted; uppercase/braced/unhyphenated UUID, 42/44 chars, `=`, `+`, `/`, non-zero tail bits, two dots, spaces → `null` |
| Decision, use case, hash (unit) | before/at/after expiry; already opted out → no write; lookup before lock, clock after lock; no audit on 0 rows; a known SHA-256 vector |
| RT-17 opt-out part | 1 ms before expiry → 204, opted out; exactly at and after → 404, row unchanged; a consumed token (`consumeAndRate`) opts out before expiry, not after; `expires_at` unchanged |
| RT-19 | before and after rating; duplicate POST at a later clock keeps the first time and one audit row; one customer via two businesses' links → one company-wide row; `platform_whatsapp_suppressions` unchanged; nothing writes `NULL` |
| ADR-0011 §6 Tampered / Cross-tenant (opt-out side) | altered random byte, altered prefix, B's prefix on A's random part, missing header → 404, no change on A or B, no audit; another company's signed-in cookie changes nothing |
| RT-20 limits | 30 hits/IP/minute across valid, malformed and foreign-prefix tokens; the 31st → bilingual 429 + `retry-after`, no `withTenant` call (`calls.tenant`); two forged `X-Forwarded-For` values share one bucket; `no-store`/`no-referrer` on 204, 404, 429; the token never appears in captured logs |
| Fail-closed | `omitRedis` harness: 503 `NOT_READY`, no database call; controller unit: `RateLimiterUnavailableError` and a rejected `hit` → 503, use case never called |
| Locks | opt-out completes while another connection holds `FOR KEY SHARE` on the customer and `FOR UPDATE` on the request; it blocks behind a held `FOR NO KEY UPDATE` (`waitForBlockedAppSession`, `createGate`), then keeps the committed first time |
| Contracts / coverage | OpenAPI publishes the path, header and responses; route-access coverage passes with `@Public()` |

`CLAUDE.md` §9: no new table, so no new RLS negative test; the cross-tenant rows above and 58-2b's
`rls-customers.spec.ts` are the isolation evidence. No `queries/` file (write path; lookup by the unique
`rating_requests_token_hash_key`); no UI. Fixtures reuse `packages/db/test/rating-fixtures.ts` (`claimRequest`
with `sha256(knownToken)`) and `rating-concurrency-fixtures.ts` by relative path (`customer-persistence.spec.ts:11`).

## Local verification protocol (lead, expected, not run)

1. `node scripts/test-db/lane.mjs up 58-2c`; confirm `.env.test.local` points at this worktree's private cluster.
2. `pnpm --filter "@pospay/db^..." build`; `pnpm contracts:openapi`; `api:generate` in admin and pos.
3. `typecheck`/`lint` for `@pospay/api`, `@pospay/contracts`, `@pospay/i18n`; `pnpm --filter @pospay/contracts test`;
   `pnpm --filter @pospay/api exec vitest run` on the new and edited specs, `redis-rate-limiter.spec.ts`,
   `customers.spec.ts` and `route-declarations.spec.ts`.
4. `api:check` (admin, pos), `pnpm lint:docs`, `pnpm module-map:check`, `git diff --check`, scope check;
   `node scripts/test-db/lane.mjs down 58-2c` after its ownership check. Record each result separately. Full
   `pnpm check` runs on CI at the exact merge head (PP-69.7, PP-72.1).

## Size, lane, implementer, review

- **Size (low confidence):** ~330–450 production lines, ~600–800 test lines, ~26 files; above the spec's 58-2 row.
- **Lane:** no migration → a normal lane. **Implementer:** Kimi k3.1-pro#high via opencode; corrections stay on Kimi.
- **Design advisors: yes, before implementation.** Spec §B.5 names them only for 58-1 and 59b-1, but this is the first
  unauthenticated tenant write and fixes the lock mode 59b-2 inherits; Astra's findings are folded in first.
- **After:** lead diff → `clean-code-guard`/`test-guard` → Astra security review → five GitHub reviewers and CI on
  the exact head; backup before merge (§10); staging per the pipeline.

## Risks

- Browsers cannot call the route until 60-2 adds the page origin (CORS). This is the first production writer of
  `opted_out_at`, which any `pospay_app` path can write (58-2b risk).
- No transaction deadline: claims and FK inserts are short and the limiter caps attempts; no `timeoutMs` bound.

## Open points for Waleed (technical)

Answered 2026-10-30 (PP-83.1, PP-83.2): all five as recommended; the Astra design review runs before
implementation (`owner-questions.ar.md`, section «اعتماد خطة 58-2c»).

1. **Lock design:** customer `FOR NO KEY UPDATE` only, request read unlocked. Recommended. Alternative: also lock
   the request after the customer (no added safety; waits behind a submit).
2. **Limiter failure answer:** `null` limiter, malformed reply and Redis rejection all → 503 `NOT_READY`.
   Recommended. Alternative: a network rejection surfaces as 500 (still closed, but untyped).
3. **Success status:** 204, no body. Recommended. Alternative: 200 `{ state: 'opted_out' }`.
4. **Audit on a repeated opt-out:** none. Recommended. Alternative: one row per valid POST.
5. **Design-advisor pass before implementation:** yes (Astra). Recommended.

`TODO(spec)`, a feature question (not technical): spec §B.4 reuses `FEATURE_DISABLED (feature customers)` without
naming routes, and `FeatureGuard` refuses a marked route that has no principal (`access.guard.ts:125–131`). Should
opt-out work when the company's `customers` feature is off? Recommended: yes, always (a stop request is never
refused; the flag would reveal tenant state to a link holder). Waleed answered yes (2026-10-30, PP-83.3); it is
RT-Q16 on the decisions page, and Abu Salem's pick binds if it differs. Until he answers: no feature mark.
