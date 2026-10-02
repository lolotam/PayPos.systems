# ADR-0011 — Public rating link

- **Status:** Accepted
- **Date:** 2026-10-02
- **Slice:** Phase 1 · G3 · before PRs 58–60

## Context

[SPEC §9 item 2 and §10](../specs/phase-1/SPEC.md#9-governing-amendments-this-phase-needs--each-its-own-pr-before-its-slice)
require a customer to rate without signing in. Before this amendment, `CLAUDE.md` §5 names only gateway webhooks, messaging
callbacks and worker jobs. A public link is a fourth entry point, but all its tenant queries still use `withTenant`.

Customers are company-scoped; a rating request, its business and its fixed claim-time performers belong to that
company. Page opt-out changes the customer's company preference, whereas WhatsApp STOP is the global sender
suppression in ADR-0013. This design neither changes rating attribution nor makes ratings affect commissions.

## Decision

### 1. Token format, tenant resolution and expiry

The bearer token is **`<company_id>.<256-bit random>`**: a canonical UUID company prefix and 32 cryptographically
random bytes encoded as unpadded base64url (43 characters). Strictly validate the complete format and canonical
encoding before any DB operation. Generate entropy in an adapter through an injected cryptographic token source,
never in a use case or with UUIDs, timestamps, phone numbers or `Math.random()`.

Persist only **SHA-256 of the complete canonical token**, as 32-byte `token_hash`, plus `expires_at` and
`consumed_at` on the tenant's RatingRequest. Hashing the company prefix together with the random bytes binds both
parts. Index `(company_id, token_hash)` uniquely; use tenant PKs, tenant-qualified FKs, ENABLE/FORCE RLS and
negative tests in the implementation PR. No plaintext bearer token in Postgres, outbox, BullMQ, Redis, audit,
request logs, errors, tracing or analytics.

Parse the company prefix as a **candidate tenant**, then enter `withTenant(candidateCompanyId)` and look up the
matching hash. A matching, unexpired row authenticates only the rating/opt-out capability for that row's request
and customer. The prefix alone grants no authority. Never resolve through a global table scan, `withUser`,
`withNewTenant`, a dispatcher pool, a new definer or an RLS-bypass role. Ignore a session's selected company and
reject/omit other client-supplied company, business, customer, request or performer ids.

Lifetime is **7 days from token issuance**, `expires_at = issued_at + 7 days` in UTC, independent of the branch's
request-send deadline. Valid means the trusted server clock is strictly before expiry; equality is expired.
Expiry is never extended by a page view, submission, delivery callback or opt-out. Failed/malformed/unknown,
tampered, expired and replayed rating submissions use the same bilingual unavailable-link response without
revealing which part matched. The link cannot open customer history or any authenticated account.

### 2. Single rating — atomic compare-and-set

GET validates and renders; it never consumes a token or opts a customer out. In `submit-rating`, validate stars
as integer 1–5 and the optional comment, then inside **one `withTenant` transaction** claim the request with an
atomic **`UPDATE … WHERE company_id = resolved_company AND token_hash = supplied_hash AND consumed_at IS NULL
AND expires_at > trusted_now RETURNING …`**. This is a persistence operation, not SQL in a use case.
Acquire the request row lock before taking the trusted current time for the expiry check, so waiting on a
concurrent operation cannot admit a token that expired during that wait; the UPDATE remains the consumption fence.

Only the execution returning one row may insert the Rating and append any enabled `LowRatingReceived` event.
Use a unique `(company_id, request_id)` rating constraint as a second invariant. Consumption, rating and outbox
commit together; an insert/event failure rolls all of them back. Two simultaneous submissions yield one winner;
zero returned rows never creates a rating. A lost successful response followed by retry cannot create another.
Keep the request's token hash until expiry so rating consumption does not remove the opt-out capability.

Attribution uses only the request's performers snapshotted at send claim; posted ids cannot alter it. ≤ 2 stars
alerts the manager only if enabled; each snapshotted performer gets that rating. The existing rating scheduling,
closing grace and at-most-once messaging rules remain SPEC §10's responsibility.

### 3. Opt-out with the same token, including after rating

The page's explicit opt-out POST validates the same full hash and `expires_at > trusted_now`, **without** requiring
`consumed_at IS NULL`. It updates only the Customer referenced by that request, inside `withTenant`; preserve the
first `opted_out_at` on retries. Do not consume the rating token just to opt out, revoke the token early, remove an
existing rating or re-subscribe. A used rating token remains valid for opt-out until the original expiry.

Lock the same customer preference row during page opt-out and rating-request claim, with a consistent lock order
in both paths. Opt-out commit is the boundary: subsequent claims recheck `opted_out_at` and cannot claim.
It applies to that company's customer across its businesses; it does not create global WhatsApp suppression.
Per SPEC §10, at most one request per business already claimed that day may still be delivered. WhatsApp STOP
uses ADR-0013's separate global phone lock/admission boundary and blocks all messages from the platform sender.

### 4. Public routes, rate limit and minimal page

Proposed contracts: rating-page validation GET, `POST /v1/ratings/submit` and `POST /v1/ratings/opt-out`. Each API
method declares exactly one **`@Public()`**, followed by its explicit token-capability validation; `@Public()`
does not authorize a tenant query by itself. Shared schemas live in contracts. UI uses generated client hooks,
ar/en i18n, RTL-safe UI, and no component fetches.

Apply a **per-IP Redis rate limit before token lookup**, across GET/submit/opt-out and all company prefixes;
use the verified proxy-derived IP, not arbitrary forwarded headers. Missing rate-limit infrastructure fails
closed for public token operations. The owner decided (2026-10-03) **30 requests/IP/minute**, shared across all rating
operations, with a generic bilingual 429 and `Retry-After`.

The page and its data response disclose **only the business name and the stars form** (1–5 stars, optional
comment, submit and opt-out control). No customer name/phone, staff names, performer ids, session details, dates,
prices, rating history, averages or business profile data. Validate the token before loading the business name;
unknown links get the generic unavailable view. After consumption, show a generic completion state and keep
opt-out accessible until expiry; do not return the submitted rating/comment to the browser.

The comment is **optional plain text, at most 1,000 Unicode characters**, with no images, attachments or links.
Enforce the limit and reject link-bearing content on the server; render accepted text with escaping, never HTML,
Markdown or automatic linkification. Comments are visible **only to the owner/manager**, within their authorized
tenant/business scope; staff, reception and public responses never expose them. The owner decided this policy;
it overrides any earlier staff-comment visibility toggle. The orchestrator requires owner approval of ar/en
submit, opt-out and unavailable/expired-link copy before PR 60; no extra profile fields.

Use HTTPS, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, no third-party scripts or trackers and no
search indexing. Prefer the token in the link's URL fragment; the frontend sends it in a dedicated, explicitly
redacted bearer header for GET and POST, avoiding proxy access URLs and GET bodies. Do not reflect it in rendered
text, page metadata or error messages.

### 5. Governing amendment — applied in this documentation change

Amend **`CLAUDE.md` §5's session-less-entry-point bullet** to name four paths: gateway webhooks, messaging
callbacks, worker jobs, and the public rating link (this ADR). State that the link prefix resolves a candidate
tenant, then its hash/expiry is validated inside `withTenant` before any rating/business data is returned.
Record the 7-day life, atomic single-rating consumption, same-token opt-out until expiry, per-IP limit and
minimal business-name/stars page. Preserve the existing dispatcher/auth/global-messaging exceptions.
The **V3.7 (2026-10-02)** changelog entry links the amendment as initially proposed; this ADR now records acceptance.

Other documents' three-path descriptions are older summaries. This ADR explicitly amends that enumeration,
without permitting a new raw-client facade or cross-module write. This lane applies only the requested
CLAUDE.md amendment; companion-document synchronization belongs to the orchestrator's documentation integration.

### 6. Required tests in PRs 58–60

- **Tampered:** altered random byte, altered prefix alone, malformed UUID/encoding, truncated/extra parts,
  noncanonical encodings and invalid stars; no rating, preference mutation or business-name disclosure.
- **Replayed:** repeat submission, lost-response retry, two concurrent submits and rollback during rating/outbox
  insert; one committed rating/consumption/event, rollback restores eligibility. GET/link previews never consume.
- **Expired:** just before, exactly at and after 7 days, for page, rating and opt-out; consumed tokens can opt out
  just before expiry, cannot after, and views/retries never refresh life.
- **Cross-tenant:** A token with B prefix, foreign ids, mismatched session/selected company, and synthetic equal
  random portions in A/B; all capabilities stay on the full hash's company/request/customer. New tenant tables
  get restricted-role read/write/re-home/FK negatives plus pooled-context leak tests in the same PR.
- **Opt-out:** before and after rating, duplicate POST preserving first time, customer shared across two
  businesses, opt-out racing claim (both commit orders), and the documented already-claimed delivery window.
  Verify page opt-out leaves global STOP suppression unchanged and cannot re-subscribe.
- **Privacy/admission:** exact business-name/form DTO allowlist and rendered page, ar/en/RTL, no PII/token in
  logs/traces/events/jobs/access URLs, no-cache/no-referrer headers, per-IP limits before lookup across prefixes
  at 30 requests/minute, bilingual 429/Retry-After and trusted-proxy spoof rejection; unauthenticated routes still
  pass route-access coverage.
- **Comments:** absent/empty and 1,000-character comments accepted, 1,001 rejected (including Unicode input),
  links/images rejected and markup never executed; invalid input leaves the token unconsumed. Owner/manager
  scope permits comment reads; staff/reception, public and cross-tenant reads cannot reveal comments.

### 7. Owner decisions — 2026-10-02

- **Waleed:** allow an optional plain-text comment of at most 1,000 characters, no images or links, visible only
  to the owner/manager. This is the accepted comment policy in §4.
- **Owner (2026-10-03):** accept 30 requests/IP/minute across rating operations and require owner approval of ar/en
  public-form copy before PR 60, as recorded in §4.
- **Deferred to the ratings slice:** token delivery remains open below; acceptance does not authorize an
  unresolved bearer-token transport or enable rating sends.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Customer OTP/session before rating | adds friction and contradicts SPEC's public link |
| Prefix alone, sequential ids, plaintext token storage | allows guessing or exposes reusable bearer credentials |
| Global lookup or bypass-role resolver | unnecessary; prefix plus tenant-local hash verification preserves RLS |
| SELECT then unconditional consume/insert | concurrent submissions can both win |
| Delete/revoke token after rating | removes the required opt-out capability before expiry |
| GET opt-out or exposing the visit/customer to confirm identity | link preview can change preferences; page leaks information SPEC forbids |

## Consequences

- Possession authorizes only one rating and repeatable opt-out for the linked company customer. A forwarded link
  grants that same narrow capability until expiry; it proves possession, not the customer's personal identity.
- No tenant-access exception or new DB role is needed. Public input still requires tenant RLS, atomic writes,
  capability checks and rate limits. Rating expiry and send deadlines are different clocks.
- G3 records the fourth entry point and applies the rule amendment now. Token issuance, storage, routes,
  rate limiting, page and tests remain the implementation PRs; this document does not claim they exist.

## Open questions for the owner

1. **Hash-only token delivery (`TODO(spec)`, before PR 59b):** a CSPRNG token cannot be recovered from its hash by
   a later queued sender. ADR-0018 forbids bearer links in event/job JSON and defers this transport to ratings.
   Recommend a separately approved keyed, domain-separated 256-bit pseudorandom derivation from immutable
   company/request identity, with the derivation secret only in Dokploy and token produced only in sender
   memory. The customer side stores only the full-token hash; inject a restricted codec at composition roots,
   with no notifications contact read or customer write port. Approve whether this meets the required random
   token policy and settle key lifetime/rotation; until then **do not enable rating sends or add plaintext or
   encrypted bearer-token storage silently**. This proposal does not relax the CSPRNG issuance contract above.
