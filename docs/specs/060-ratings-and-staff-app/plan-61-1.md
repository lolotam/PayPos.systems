# 61-1 — Low-rating notice: planning design (U1/U2/U3 + A1 review brief)

> **Status: A1 DOCUMENTATION DELIVERY AUTHORIZED; B SELECTED AS DESIGN ONLY.** Current base
> `319e8c637f063dddb6df5e487d3585f223eb500a`, verified from live `origin/main` and fast-forward merged after checkpoint.
> Initial investigation baseline was `da775eb5e5b62adcb48b26d1e55fdba1a2ce671f`; relevant A1 source context is unchanged.
> Owning branch `plan/61-1-low-rating-alert`. Only ADR0010, module-map markdown/generated YAML and these two planning
> documents are authorized for A1. No runtime reader/port, executable test, migration, seed or T/K/E is authorized.
> U2/U4 are OPEN DESIGN/READINESS BLOCKERS and P1 rolling compatibility is unresolved. Earlier `REQUIRESCORRECTION` receipts
> are historical, not a PASS for the final diff; a fresh independent review is required before the one A1 PR.
> A1 brief: 1000 total added/deleted lines including generated output; refusal threshold 2000; three correction rounds.
> Evidence and the manager's technical decision (not a new owner quote): `61-1-planning-evidence.md`.
>
> Owner restriction, unchanged: «البداية تخطيط وتحقق مصدر فقط؛ لا production أوmigration أوPR قبل مراجعة الخطة وموافقة وليد اللازمة لتغييرmigration.»

## 0. Manager decisions of record

The planner received an English rendering; the owning lead has the Arabic original and has checked this record against
it (evidence §E0). The planner's reading gaps remain disclosed in §E1. The table below is the EARLIER planning
decision. The latest technical manager decision in §E0.1 now authorizes A1 documentation and one PR after its gates;
it selects B as design only, rejects treating U2 as a mere verification limit, and leaves all runtime work blocked.
The R2/3 approval in evidence §E13 additionally removes the unproved early-time promise and keeps U4 open before E.

| # | Decision (as received) | What it does NOT authorize |
|---|---|---|
| 1 | A1 direction approved: API `customers → identity` and API staff-names public interfaces on the same tx | No code or PR until U3 is closed and a reviewable ADR/module-map diff, signatures, tests and consumers are submitted (§6 is that submission) |
| 2 | P1 extraction from 61-2 approved as prerequisite planning: catalog, defaults, seed, grant refusal and current-role policy together, plus a graph update removing the cycle | Not migration approval, not privilege expansion; Waleed decides before generation |
| 3 | A1 / P1 / kind / templates / emitter accepted as a CANDIDATE split | Not five approved PRs. Each must be independently mergeable, adjacent-version compatible; consumer fully deployed before producer; a kind listed only with a real emitter; one open PR per session |
| 4 | Close U1/U2/U3 or report a proven conflict; at most two lossless IN_APP alternatives; trace every field; no chunking/truncation/dropping of valid names, no team label, no invented performer cap | Wire/model changes must be explicit before implementation |
| 5 | No cap promises an unbounded payload within 1000 ms; give byte arithmetic; report impossibility | No benchmark, no SQL, no timeout increase |
| 6 | Fix the runtime validation boundary under the architecture; finish required readings | Old reviews ≠ approval of the final plan |
| 7 | Count all prod, tests, docs and generated lines, added and deleted | Brief sizes only after the transport is decided; 0217 is an old provisional number |
| 8 | Withdraw T1's per-migration self-reversal claim | Splitting a migration authorizes no SQL reverse; code rollback has a floor, the DB uses a verified snapshot; no migration card now |

**Withdrawn card.** Draft card T-1 (migration self-reversal) is WITHDRAWN in full. Its original wording survives only in
the retained manager-reviewed draft (`F:/Dev/Temp/pospay-61-1-planning/manager-reviewed-bounded-draft/`) as audit history and is not
restated here. T-2 is kept only as history; T-3, T-4 and B-1 stay retired. No new card is produced by this document.

## 1. Scope

In scope: the design of the `LowRatingReceived` → IN_APP notice of RT-22/RT-23 (spec 060 lines 612–615), the recipient
and comment-reader partition of BR-B4 (spec 060 lines 746–748), and the candidate split that would deliver it.

Out of scope and untouched: #887 and the activation blockers #803/#804/#805/#808/#809/#810/#811; #888 and its backups;
WhatsApp/email/push channels (AL-Q6 defers team external delivery; RT-23 fixes generic copy if those channels ship later); 61-2
averages; any staging or production action; RT-Q8/RT-Q9 (not reopened).

## 2. Status of U1 / U2 / U3 / U4

| Item | Result | Where |
|---|---|---|
| U1 — lossless IN_APP transport | **CLOSED as design**: two alternatives, **B selected by manager for IN_APP design only**; no T implementation | §3 |
| U2 — liveness inside the 1000 ms rating transaction | **OPEN DESIGN/READINESS BLOCKER**; safe failure is established but does not satisfy liveness or authorize E | §5 |
| U3 — runtime validation boundary | **CLOSED as design**: root-built parse closure injected through an own port; legality shown from config, NOT lint-tested | §4 |
| U4 — emission-time authorization | **OPEN DESIGN/READINESS BLOCKER** before E's readers; BR-B4 is preserved, and decision instant/clock/writer coordination are unselected | §6.1–§6.2 |
| Tenant/place precondition | Existing API tenancy `describeWorkspaces` supplies the metadata and active-company result; no third public symbol or worker import | §6.3–§6.4 |

## 3. U1 — transport (two lossless alternatives only)

### 3.1 What exists today (no change is "free because it is JSONB")

Traced end to end (evidence F-W1…F-W9):

1. Contract: `notificationRequest` = `z.object({business_id, branch_id, notification_recipients: 1..100})`; the IN_APP
   recipient is a strict `discriminatedUnion('template_key', …14 variants)` with `template_revision: 1`, locale `ar|en`.
   `displayName`/`safeText` are `.min(1).max(255)` in UTF-16 units.
2. Worker handler `storeRecipient` checks `validInAppTemplate(key, revision, locale, safe_parameters)` and passes ONLY
   `safe_parameters` to the store; `InAppInput.safeParameters` is `readonly {name; type: 'text'|'number'; value: string|number}[]`.
3. `validInAppTemplate` looks up a fixed list of 14 definitions; `validateParameters` requires exact count, name, type,
   and `textAllowed`, which refuses `value.length > 255` (UTF-16) and, for default `safe` text, any 4–8 digit run.
4. Repository: `${JSON.stringify(input.safeParameters)}::jsonb`; DB CHECK `jsonb_typeof(safe_parameters) = 'array'`;
   unique `(company_id, source_event_id, recipient_user_id, template_key)`.
5. API inbox: `inAppNotificationPage.parse` (strict response union) over the whole page.
6. Browser: `readInAppNotificationPage` drops unknown keys/higher revisions before parsing — client-side only.
7. Admin renderer: per-key branches; unknown keys fall to `generic_notice` copy.

Consequences: an old API that meets a new row fails the WHOLE page; an old worker that meets a new IN_APP variant throws
`NOTIFICATION_REQUEST_INVALID` (retry then park). Both are wire/model changes and are planned as such (§7).

### 3.2 The details object (shared by A and B)

```ts
// proposed, packages/contracts — not written
const DISPLAY_NAME_UNSAFE =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;
const ratingDisplayName = (maxCodePoints: 200 | 255) => z.string().refine((value) =>
  value === value.trim() && value.length > 0 &&
  Array.from(value).length <= maxCodePoints && !DISPLAY_NAME_UNSAFE.test(value));
const performerName = z.strictObject({
  name_ar: ratingDisplayName(255).nullable(),   // null = Arabic absent → renderer falls back to name_en
  name_en: ratingDisplayName(255).nullable(),
});
const detailsBase = {
  stars: z.union([z.literal(1), z.literal(2)]),
  branch_name_ar: ratingDisplayName(255).nullable(),
  branch_name_en: ratingDisplayName(255).nullable(),
  business_date: z.iso.date(),
  performers: z.array(performerName),          // ALL snapshot performers, id order, NO max (no invented cap)
  customer_name: ratingDisplayName(200).nullable(),
  phone_last3: z.string().regex(/^[0-9]{2,3}$/), // existing customers maskPhone semantics; see 3.5
};
export const lowRatingDetailsV1 = z.strictObject(detailsBase);                                   // rejects `comment`
export const lowRatingCommentDetailsV1 = z.strictObject({ ...detailsBase, comment: ratingComment }); // requires it
```

This is a proposed contracts-module schema declaration, not executed code. It uses that module's existing `z`,
`id` and `ratingComment` imports. The name predicate changes only the length unit for these NEW templates and
uses the existing display filter; it adds no new blanket control-character rule or generic text-kind exception.

The exact new B request schemas are:

```ts
const lowRatingParameters = z.tuple([z.strictObject({
  name: z.literal('details'), type: z.literal('details'), value: lowRatingDetailsV1,
})]);
const lowRatingCommentParameters = z.tuple([z.strictObject({
  name: z.literal('details'), type: z.literal('details'), value: lowRatingCommentDetailsV1,
})]);
const lowRatingRecipient = z.strictObject({
  channel: z.literal('IN_APP'), user_id: id, locale: z.enum(['ar', 'en']),
  template_key: z.literal('low_rating'), template_revision: z.literal(1),
  safe_parameters: lowRatingParameters,
});
const lowRatingCommentRecipient = z.strictObject({
  channel: z.literal('IN_APP'), user_id: id, locale: z.enum(['ar', 'en']),
  template_key: z.literal('low_rating_with_comment'), template_revision: z.literal(1),
  safe_parameters: lowRatingCommentParameters,
});
const lowRatingNotificationRequest = z.strictObject({
  business_id: id, branch_id: id,
  notification_recipients: z.array(z.discriminatedUnion('template_key', [
    lowRatingRecipient, lowRatingCommentRecipient,
  ])).min(1).max(100),
});
```

The pre-append groups validator parses every group, verifies unique `user_id` across ALL groups and one request
business/branch scope, and returns the parsed groups. Group cardinality 1..100 does not cap P or total R.
Response variants reuse their corresponding exact parameter tuple with the current inbox envelope fields
(`id`, `company_id`, `business_id`, `branch_id`, `source_event_id`, `locale`, revision, creation/read timestamps).
They carry no recipient phone, token or token hash. Legacy scalar branches remain unchanged.

- No unknown keys, no metadata, no ids. Business and branch UUIDs travel only in the request scope
  (`business_id`, `branch_id`) taken from the consumed `rating_requests` row, never from the request body.
- `comment` is exactly `ratingComment` (≤ 1000 code points, LF/CR/tab allowed, no links/markup). The submit use case maps
  `''` to `null` before storage (`submit-rating.usecase.ts:51`), so `''` is unreachable from the emitter; the schema still
  accepts what `ratingComment` accepts, for parity.
- Two template keys, both revision 1, both new: `low_rating` and `low_rating_with_comment`, as in the byte model.
  They give each strict recipient a fixed details shape. This is an explicit technical addition to spec FR-B13's
  single named template; T must update spec 060 FR-B13 first, before changing its contracts (§7.1). Two keys do not prevent duplicates: the unique
  index includes `template_key`, so only a DISJOINT recipient partition prevents two bells. Do not rely on insertion
  order or `ON CONFLICT` to choose a recipient's ACL variant.
- Locale: every row is stored with `ar`; the admin renderer uses the viewer's UI locale (`viewerLocale ?? item.locale`),
  as every staff-alert branch of `render-notification.ts` already does (only `generic_notice` keeps the row locale).

### 3.3 Alternative B — typed details parameter (SELECTED FOR DESIGN ONLY)

Wire, new two-variant IN_APP addition only (legacy variants, rows and `SafeParameter` untouched):

```ts
// proposed IN_APP variants (request and response unions)
{ channel: 'IN_APP', user_id, locale, template_revision: 1, template_key: 'low_rating',
  safe_parameters: [{ name: 'details', type: 'details', value: LowRatingDetailsV1 }] }          // tuple of exactly 1
{ …, template_key: 'low_rating_with_comment',
  safe_parameters: [{ name: 'details', type: 'details', value: LowRatingCommentDetailsV1 }] }
```

Required explicit changes (the "JSONB is flexible" argument is rejected; each layer is typed):

| Layer | Change | Unchanged |
|---|---|---|
| `packages/contracts` | two request variants in `inAppRecipient`, two response variants in `inAppNotification`; export the details schemas | `notificationParameter` (255), external SafeParameter shapes, 14 legacy variants |
| `packages/notifications` | `LowRatingDetailsParameter` type + `validLowRatingTemplate(key, revision, locale, parameters)` (own validator mirroring the contract; parity tests in worker, which already depends on both packages; no new contracts dependency) + two definitions + ar/en copy | `definition.ts` `SafeParameter`, `validateParameters`, `textAllowed`, `validInAppTemplate`'s 14 entries |
| worker `notifications` | own plain domain union for legacy scalar parameters versus the details tuple (no contract/notifications package import into domain); `storeRecipient` branches by key and validates; legacy scalar helper inputs are narrowed explicitly, no casts | repository SQL (`JSON.stringify(array)::jsonb` already stores an object element) |
| DB | none: an array holding one object satisfies `jsonb_typeof = 'array'` | column, CHECK, indexes |
| API inbox | response union gains the two variants; strict page parse keeps working | query SQL |
| admin | renderer branch for both keys; explicitly narrow existing scalar-only helper types before `.trim()`/interpolation; viewer locale, ar→en fallback, i18n copy; unknown-key client skip unchanged | existing legacy behavior |

### 3.4 Alternative A — one scalar text parameter, double-encoded

`safe_parameters: [{ name: 'details', type: 'text', value: JSON.stringify(details) }]`. Keeps `SafeParameter`'s shape but:
the value exceeds `textAllowed`'s 255 UTF-16 cap and trips `UNSAFE_TEXT`'s 4–8 digit rule (`2026` in the date, `123`
is fine, any digit-run name). So A needs a template-specific IN_APP validator that bypasses the generic one for these
two keys ONLY, a contract variant whose `value` must `JSON.parse` into the strict details, an API response variant of the
same, and a renderer that parses. Every `"` and `\` inside the details is encoded twice (outbox JSON and inner string),
and the API returns a string the client must parse again.

**PP-136 advice correction:** the advice that A needs a new generic `textKind` is REJECTED. A key-scoped bypass needs no
generic kind; adding `textKind: 'json'` would widen the generic validator for every template.

### 3.5 Field trace (both alternatives; B shown)

| Field | Source (read on the rating tx) | Rule | Bound used | Privacy |
|---|---|---|---|---|
| `stars` | submit body (validated `submitRatingInput`) | emit only for 1 or 2 (RT-22) | literal | — |
| `branch_name_ar/en` | tenancy public reader (§6.3) | safe display policy; unsafe/missing → injected generic label | 255 cp (DB `char_length` 1..255; writer `nameAr/nameEn` trim max 255 UTF-16 ⊂) | in-app only |
| `business_date` | rating request row (evidence F5, carried forward) | `z.iso.date()` | 10 B | — |
| `performers[]` | `rating_performers` snapshot ids, ordered by `employee_id` ASC (today's SELECT has no ORDER BY — the new read adds one) → staff public names | first word of the trimmed stored name (RT-23 "first names"); unsafe → ar→en→label (ADR-0037 D4); repeats kept (distinct staff may share a name) | 255 cp each; P unbounded | in-app only |
| `customer_name` | customers row of the request (own module) | full stored name, trimmed, never a first word; unsafe/missing display name → null and translated generic renderer label. A missing required customer row is a context failure, not a fabricated identity | 200 cp (DB `length(btrim(name))` 1..200; writer `max(200)` UTF-16 ⊂) | in-app only |
| `phone_last3` | customers `phone` (E.164 `^[+][1-9][0-9]{1,14}$`) | existing `maskPhone` strips all except its final up-to-3 digits; `^[0-9]{2,3}$` matches the existing API contracts and shorter legal phone, without padding | 3 B | same masking semantics, no new permission or owner deviation |
| `comment` | `ratings.comment` just inserted | verbatim, only in `low_rating_with_comment`, only for comment readers | 1000 cp (`ratingComment`; DB `char_length <= 1000`) | see §3.6 |

Name policy (dedicated, IN_APP only): shares the phone/URL/code filter of `DISPLAY_NAME_UNSAFE`, applies a code-point
limit equal to each field's source limit, trims, takes a first word only for performers, never truncates. The existing
`displayName` (`.max(255)` UTF-16) is NOT claimed to cover DB-legal names: a 255-code-point emoji name is 510 UTF-16 units
and would fail it although the DB accepts it (the writer's own `max(255)` UTF-16 makes such a name
unreachable through today's API, but other writers are not assumed to share that cap). A missing/unsafe display
name is represented by null, with the translated generic label selected by the renderer's i18n boundary. The composer
contains no label literal. Every performer keeps an entry, including a generic individual label when neither language
is safe; valid names are never replaced because they are long or numerous. This is not a team label.

### 3.6 Comment privacy (stated, not resolved by redaction)

RT-23 (spec line 615) says «never the phone beyond the last 3 digits (S-12)». Reading this as a rule solely on the
structured `customers.phone` field was a proposed interpretation, NOT an authorized policy decision. The manager
explicitly permits no new interpretation widening phone display. A1 does not settle this point. The raw comment
is customer free text: `ratingComment` rejects links, markup and
control characters but not digit runs. Synthetic counterexample (not run): `'اتصلوا بيا 99887766'` — 19 code points
< 1000; no control character; no `LINK_OR_MARKUP_PATTERNS` match; in `containsBareDomain` the run `99887766` has one
label and is skipped (`rating-comment.ts:157–158`). It is a valid comment, and the lossless in-app comment (RT-Q9, the
manager's no-redaction rule) would show it to comment readers. **If the manager reads S-12/RT-23 as a universal ban,
this is a proven conflict between the lossless comment and that ban; it is surfaced here, not assumed resolved.** No
redaction, no new owner question, RT-Q8/Q9 not reopened. The comment also sits in the outbox payload of the comment group
(unstripped), readable by the dispatcher role like every other outbox payload.

### 3.7 Team label

RT-Q12 (PP-18.20, «ولو أكتر من 3: «فريق صالون الأميرة»») answers the customer rating-request message (D-B6), not the
alert; RT-23 lists "performers' first names" with no team rule. The alert therefore carries every name and no team label,
consistent with manager point 4. No additional interpretation question about RT-Q12 is being raised.

### 3.8 Recipients and partition

- Alert eligibility is `rule.enabled && rule.channels.includes('IN_APP')`. Otherwise, including `channels: []`,
  emit no notice and perform no alert-only identity/place/performer-name/customer reads; consume/rating work is unchanged.
- Candidates: `RatingAlertRecipientsPort.managers` → identity `readBranchRoleHolders` with the `LOW_RATING` rule's roles
  (default RT-Q8: the four managers of the visit branch scope); deduplicated, sorted by `userId`.
- If the stored comment is `null` (omitted/empty submission), all candidates get `low_rating`; do not call
  `commentReaders`. The with-comment schema stays non-nullable; no valid non-null comment is dropped.
- For a non-null comment, `commentReaders(candidates)` → identity `readRatingCommentReaders` (§6.2); an INTERSECTION of the
  candidates, so `comment group ⊆ candidates` and `no-comment group = candidates − readers`; disjoint by construction.
- No candidates ⇒ no event (and no outbox row), with no further alert-only reads.
- Groups: build the appropriate per-user variants first, concatenate the disjoint groups, then batch that SINGLE
  recipient list into groups of ≤100. ONE event may carry both ACL variants when a non-null comment exists;
  only R>100 adds events. Append every group in one `appendOutboxEvents` call.

## 4. U3 — runtime validation boundary

**Design.** The customers composition root `apps/api/src/modules/customers/customers.module.ts` builds a closure
`validateLowRatingNotice = (draft) => lowRatingNotificationRequest.parse(draft)` (value import of a proposed
strict low-rating-only request schema from `@pospay/contracts` in the
root only) and injects it into `createRatingSubmitTransactions(db, ids, timeoutMs, deps)` — the same factory-injection
shape `createRatingViewTransactions(db, timeoutMs, names)` already uses. The new scope method
`appendLowRatingNotices(groups)` calls the closure for EVERY group, then passes the RETURNED parsed groups to one
`appendOutboxEvents`; raw pre-parse drafts are never serialized. The low-rating request requires the request's business
and branch UUIDs and 1..100 strict low-rating recipients. An invalid draft throws inside the transaction, so the whole
rating rolls back. This is a validation failure, not evidence that a valid source comment can be silently discarded.

| Layer | Imports (new) | Rule source |
|---|---|---|
| `domain/` low-rating composer | none beyond `@pospay/domain` | §3.1 matrix |
| `ports/` `LowRatingNoticeValidator`, `RatingAlertRecipientsPort<Transaction>`, `PerformerNamePort<Transaction>` | own plain domain types only; generic `Transaction`, no `Tx` | §3.1 matrix |
| `use-cases/submit-rating` | own ports/domain; no new contracts value | §3.1 (contracts types only) |
| `persistence/` adapters + factory | own ports/domain, `@pospay/db`, other modules' `index.ts` | §3.1 matrix |
| `customers.module.ts` | `@pospay/contracts` value, `@pospay/i18n` labels, own layers | §5.2 (binding place); no matrix row |

Legality evidence (config read, NOT lint-tested): `boundaries.js` lets `module-root` import every same-module layer;
`@pospay/contracts` is a package, not a `boundaries/elements` entry, so `boundaries/dependencies` does not judge it; the
only `no-restricted-imports` blocks target `domain/**` and `use-cases/**`. Precedents that are NOT authorizations: the
submit use case's existing `submitRatingInput` value import (line 1) and the worker repository's `notificationResult`
value import. The commissions PP-108.1 rows are not borrowed. The advisor's `events/low-rating-notice.ts` location is
REJECTED: the matrix row is `events/handlers/` only. If the A1 review finds the root closure illegal, the conflict is
reported, no file is moved to bypass the matrix.

## 5. U2 — liveness inside the 1000 ms transaction

### 5.1 Safe failure (closed)

`withTenant(companyId, work, {timeoutMs: 1000})` (`RATING_TRANSACTION_TIMEOUT_MS`, `customers.module.ts:42`):
- `beforeCommit` checks `performance.now()` against the deadline; late work throws `TimeoutError` and rolls back, so
  either the consume, rating, attributions and every outbox group commit together, or none does.
- A COMMIT sent before the deadline answers for itself even if it lands later; if no reply arrives within another
  `timeoutMs`, `CommitOutcomeUnknownError` (→ 503) is raised and the caller must not claim the link is unconsumed.
- The view state `submitted` is authoritative afterwards; a retry with the same token cannot duplicate (atomic consume
  UPDATE; a second submit returns `UNAVAILABLE`). Expiry can later make the view unavailable; indefinite retry is not
  promised. No new response code, policy or timeout.

### 5.2 Work count (lower bound, statements on one tx)

Baseline design count when IN_APP is selected, the rule is on, candidates exist and the comment is non-null:
tenant context setup (1) + lock (1) + consume UPDATE (1) +
rating INSERT (1) + performers SELECT (1) + **P** attribution INSERTs (60-1 loop, unchanged) + rule (1) + candidates
(2) + comment readers (1 planned set-based read) + performer names (1) + `describeWorkspaces` (2: current tenant then
tree) + customer row (1) + bulk outbox (2) = **P + 15 SQL statements**, excluding driver BEGIN/COMMIT. This is a proposed
query plan, not a measured count. A null comment skips the one ACL statement: **P + 14** under the same baseline.
Rule off or no IN_APP (including empty channels) stops alert work after the rule: **P + 6**, using the listed
tenant/lock/consume/rating/performers/attributions/rule operations only. No-candidate and empty-input paths may use fewer
than the full alert baseline. U4's eventual mechanism is NOT counted or selected here; its additional statements,
locks or coordination work must be accounted for before E. These estimates do not establish latency or resolve U2.
`appendOutboxEvents` is O(1) statements, NOT O(1) payload: its INSERT parameter is
`JSON.stringify` of every entry whose `payload` is already a JSON string, so every `"` and `\` of every payload is
escaped once more on the wire (`outbox.ts:85–89`).

### 5.3 Byte arithmetic (payload only; lead-computed with plain JS JSON, re-checked by hand here)

H = 134 B (event header with empty recipients and two 36-byte UUIDs). Rc = recipients assigned the with-comment variant
(0 for a null comment), R0 = R − Rc, K = ⌈R/100⌉; no IN_APP means no notice payload. The examples assume a non-null comment;
n, c = encoded bytes of one recipient without/with the comment (all names replicated per recipient).
**Total outbox = R0·n + Rc·c + K·H + (R − K)** (the last term is the commas inside each group).

| P | R | Rc | names | K | A n | A c | A outbox | A max group | A inbox | B n | B c | B outbox | B max group | B inbox |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | 4 | 4 | short | 1 | 515 | 2545 | 10 317 | 10 317 | 9 520 | 468 | 2494 | 10 113 | 10 113 | 9 316 |
| 80 | 100 | 100 | api-utf16 | 1 | 85 931 | 89 961 | 8 996 333 | 8 996 333 | 8 979 600 | 85 268 | 89 294 | 8 929 633 | 8 929 633 | 8 912 900 |
| 1000 | 205 | 103 | api-utf16 | 3 | 1 053 771 | 1 057 801 | 216 438 749 | 105 780 333 | 216 405 646 | 1 045 748 | 1 049 774 | 214 793 622 | 104 977 633 | 214 760 519 |

Hand check of the formula: row 1 A = 4·2545 + 134 + 3 = 10 317; row 2 B = 100·89 294 + 134 + 99 = 8 929 633; row 3 A =
102·1 053 771 + 103·1 057 801 + 3·134 + 202 = 216 438 749; row 3 A max group = 100·1 057 801 + 134 + 99 = 105 780 333.

Inputs: row 1 — label ar `اسم` (6 B), en `Name` (4 B); branch `فرع` (6 B) / `Branch` (6 B); customer `عميلة` (10 B);
comment `ج`×1000 (2000 B); date 2026-11-07; stars 2; last3 `123`. Rows 2–3 ("api-utf16") — every name is 127
supplementary code points = 254 UTF-16 units (legal for `nameEn`/`nameAr` max 255) = 508 UTF-8 B per language; customer
100 emoji = 200 UTF-16 = 400 B; comment 1000 emoji = 2000 UTF-16 = 4000 B. All ids valid 36-byte UUIDs; locale `ar`.
Repeated names are distinct staff. These are arithmetic examples, not caps and not speed results.
Envelope: the lead's n/c use the two exact keys `low_rating` and `low_rating_with_comment`, revision 1 and one details
tuple. The lead restored these exact keys after the isolated planner renamed one. The byte table already includes
the longer comment key; no speculative key-length adjustment is needed. These are JSON payload text sizes only.

Bulk INSERT values are a second JSON envelope. Let L/Q/S be the summed byte lengths, quote counts and backslash
counts of the event payload JSON strings. The exact INSERT values parameter length is
`V = L + Q + S + Σ bytes(JSON.stringify(entryWithEmptyPayload)) + (K−1) + 2`.
Entry fields are the existing `position,id,aggregate_type,aggregate_id,event_type,payload`; all aggregate/id UUIDs
are 36 bytes and aggregate type is `rating`. The empty-payload entry includes its two quotes, so replacing it adds
L+Q+S, not another per-entry pair of quotes. For the same three examples:

| P / R / Rc | A bulk INSERT values parameter UTF-8 B | B bulk INSERT values parameter UTF-8 B |
|---|---|---|
| 3 / 4 / 4 | 11,057 | 10,637 |
| 80 / 100 / 100 | 9,133,329 | 8,999,629 |
| 1000 / 205 / 103 | 219,736,559 | 216,445,690 |

These are pure synthetic JSON-size calculations, not a test, benchmark, measured SQL traffic, driver/network framing
or physical JSONB storage. The sorted-lock collection is a separate parameter; all groups share one rating aggregate.
The payload and inbox totals above already include per-recipient duplication; counting only K copies would be wrong.

Encoding notes: `"` and `\` cost 2 JSON bytes (4 in A's inner string); LF/CR/tab cost 2; a non-BMP code point is 4
UTF-8 bytes; raw UTF-8 ≠ serialized JSON; conservative bound J(s) ≤ 6·codepoints(s) + 2 (a `\uXXXX` escape). 255 chars
is never 255 bytes. Stored inbox bytes replicate per R, not per K. Physical jsonb, on-disk and network sizes are UNKNOWN.

### 5.4 The conflict (proven)

No source bounds P (snapshot performers; evidence F22–F24 carried forward, not re-read) or R (role holders in scope).
Statement count grows with P, payload with P·R, serialization and `jsonb_to_recordset` parsing with payload. For any
fixed 1000 ms and fixed hardware there exist source-valid P, R whose work exceeds it; the transaction then rolls back
(safe). Retrying unchanged inputs does not itself reduce work, so safe retry is not a liveness guarantee before expiry.
Row 3 puts 214,793,622 B of B payload text, before bulk-wire escaping, through the transaction. No external JSONB size
ceiling or measured failure threshold is asserted. **Unconditional liveness is not established; U2 is recorded as SAFE-FAILURE DESIGN CLOSED /
UNBOUNDED-LIVENESS CONFLICT.** The latest manager decision makes this an explicit design/readiness blocker for E,
not a deferred measurement or permission to implement E first. No cap, chunking, truncation, data loss or timeout
change is proposed.

### 5.5 Manager disposition: E remains blocked

The earlier recommendation to accept U2 as a verification limit and implement E before measuring is WITHDRAWN and
explicitly rejected by the manager. Safe failure is not liveness. Before E, a reviewable plan must address the load
within the existing contract or present a specific architectural contract change for review. This A1 neither selects
an ids-only worker redesign nor authorizes moving recipient/ACL decisions away from the emitter. No cap, truncation,
timeout increase or reinterpretation of rating success is implied. There is no current Waleed card on this point.

## 6. A1 — authorized documentation delivery and deferred runtime contract

ADR0010/module-map markdown are now applied in the working tree and YAML is generated from the markdown.
The signatures below remain documentation for future E code: no production port, reader or executable test is added.

### 6.1 Ports (API customers)

```ts
export interface RatingAlertRecipientsPort<Transaction> {
  /** المديرين اللي في نطاق فرع الزيارة لحظة التقييم؛ فاضي = مفيش حدث. */
  managers(tx: Transaction, companyId: string, businessId: string, branchId: string,
           roles: readonly AlertRecipientRole[], at: Date): Promise<readonly { userId: string; owner: boolean }[]>;
  /** مين من المرشحين يقرا الملاحظة (BR-B4)؛ تقاطع مرتب بلا تكرار. */
  commentReaders(tx: Transaction, companyId: string, businessId: string, branchId: string,
                 userIds: readonly string[], at: Date): Promise<readonly string[]>;
}
export interface PerformerNamePort<Transaction> {
  /** الأسامي المخزنة للمنفّذين المتصوّرين، من غير فلترة deleted_at. */
  firstNames(tx: Transaction, companyId: string, employeeIds: readonly string[]):
    Promise<readonly { employeeId: string; nameAr: string | null; nameEn: string | null }[]>;
}
export interface LowRatingNoticePlacePort<Transaction> {
  forBranch(tx: Transaction, companyId: string, businessId: string, branchId: string):
    Promise<{ readonly branchNameAr: string | null; readonly branchNameEn: string } | null>;
}
```

`commentReaders` returns `readonly string[]` (sorted, unique) everywhere; the composer builds its own Set. The signatures
are unchanged. For E, the supplied `at` must be part of a reviewed BR-B4 emission-time authorization decision (U4),
not assumed to be established by the request-lock clock sample. The existing `consumeAndRate` clock/token-expiry
contract stays unchanged. Empty `userIds`/`employeeIds` return `[]` with no query. `AlertRulesPort.rule` stays on API
`settings.readAlertRule` (same tx); no role holders in it.
`firstNames` returns display-safe first names after the API customers adapter applies its own pure domain function.
The staff public reader returns raw stored names; it never imports customers domain or a worker helper.

### 6.2 Identity public API (API `apps/api/src/modules/identity/index.ts`)

- Existing `readBranchRoleHolders(tx, companyId, businessId, branchId, roles, at)` — 2 queries (scope UNION, canonical
  owners); system roles only; NO company-activation check (evidence F-I2).
- Proposed new `readRatingCommentReaders(tx, companyId, businessId, branchId, userIds, at): Promise<readonly string[]>`:
  empty → `[]`; on the caller's validated tenant/place context (§6.4), ONE
  set-based read with TWO distinct sets: eligible users have a current active manager-role membership covering the
  visit branch, while their permission decision considers grants/overrides from ALL their active memberships that
  the existing API policy allows. In particular, a covering DENY from a sibling non-manager membership must not be
  discarded merely because that membership cannot qualify the user as a manager. A pure identity-domain decision applies
  the API `evaluateAccess`/`protectOwnerAccess` semantics (ALLOW at a covering scope, no covering DENY, canonical owner
  ignores DENY but does not fabricate an ALLOW) per user. One planned statement regardless of R, binding the candidate
  ids as a collection rather than executing once per user. This is the baseline query design, not a selected U4 mechanism.
  **U4 is OPEN DESIGN/READINESS BLOCKER before this reader lands:** the decision instant, clock source and coordination
  with permission writers must be reviewed without weakening BR-B4. Same transaction alone proves no serialization,
  resampling a clock alone proves no writer ordering, and no complete historical as-of snapshot is claimed. No clock,
  lock, isolation, cross-module company-read exception or new port is chosen in A1.
  Precedent only: worker `businessPermissionHolders` (worker file,
  not imported). Unlike `readAccessTransaction` (per user: company check + memberships + grants), there is no per-user loop.

### 6.3 Staff and tenancy public API (API)

- New API staff `readEmployeeDisplayNames(tx, companyId, employeeIds)` → `{employeeId, nameAr, nameEn}[]`; same company,
  ids from `rating_performers`, no `deleted_at` filter (the person who served keeps their name), mirroring the worker
  reader. Not imported from the worker.
- Branch names through the existing public API tenancy `describeWorkspaces(tx, scopes: readonly WorkspaceScope[])`:
  `Promise<WorkspaceCompanyNames | null>`. Call with exactly `{scope: 'BRANCH', scopeId: branchId}` on the caller's tx;
  verify returned company id, enclosing business id and the exact branch id against the consumed request before using
  that branch's `name_ar/name_en`. It already reads only a company with `deleted_at IS NULL`. The exact future adapter
  is `customers/persistence/low-rating-names.adapter.ts`; it adds its own reads row. No cross-module join or worker import.

### 6.4 Existing tenant/place precondition, not a third public API

After the enabled-and-IN_APP guard and a nonempty candidate result, composing a notice requires §6.3's tenancy
metadata read. Its current result is null for a
soft-deleted company or an absent tenant, and the caller must also find the request's business/branch in its tree.
No `companyAcceptsAlerts` symbol is proposed and identity gains no new read of tenancy tables.

The existing public submit path is NOT claimed to reject a deleted company already. In the proposed selected-IN_APP
path, missing mandatory context is an availability failure: raise the existing bounded-submit availability error
(`RatingSubmissionBusyError`, mapped to `NOT_READY`) inside the transaction. Do not silently omit the required alert
and commit a successful low rating. This check fails before append/COMMIT, so the consume/rating/attributions roll back.
The separate COMMIT-outcome uncertainty is §5.1. With the rule off or IN_APP absent, no alert context is required.
This error-path extension must be documented and tested in E;
it neither revokes tokens nor changes a feature flag. Same-tx reads are not a claim of serializable isolation or a
company-row lock. A1 defines this caller precondition; direct role readers do not promise a separate company check.

### 6.5 A1 ADR-0010 addendum (applied as documentation)

> **Addendum proposed 2026-11-07 — A-1 API low-rating recipients and names.** `customers` gains the arrow `customers →
> identity` for `RatingAlertRecipientsPort` (`readBranchRoleHolders`, `readRatingCommentReaders`), read on the rating
> transaction after the existing tenancy metadata precondition. `PerformerNamePort` in API customers reads API `staff.readEmployeeDisplayNames`.
> Both readers use a fixed number of round trips, not bounded result rows or bytes. The worker arrow `customers → staff` of the
> 2026-10-31 addendum is separate and unchanged. Supersedes the line "Not in this addendum: customers'
> RatingAlertRecipientsPort (docs PR A-1, postponed …)".

### 6.6 Applied documentation diff and retained proposal

The retained pre-authorization proposal is `F:/Dev/Temp/pospay-61-1-planning/a1-review/a1-proposed.patch`.
After verifying live main/context, its ADR and map-markdown hunks were applied; its generated-YAML hunk was NOT
applied by hand. `pnpm module-map:generate` produced the matching one-line YAML change. Virtual before/after copies
remain historical review artifacts, not a checkout or deployment. The current Git diff is the delivery authority.

Proposed A1 policy-doc delta: ADR **+46/−0**, map **+11/−2**, total **+57/−2 docs**, plus generated
`docs/module-map.yaml` **+1/−1**: all categories combined **+58/−3**, prod/tests **0/0**.
The real generated file was produced by `pnpm module-map:generate`, not hand-edited. Its delta matches the expected
one-line projection. These counts are not a CI receipt; generation/check/review receipts are recorded separately.
If this plan/evidence also ship in A1, their full additions count
on top of that delta; they cannot be excluded silently from the approved brief size.

```diff
 §2 (API arrows table)
-    | customers | tenancy, settings, staff |
+    | customers | tenancy, settings, staff, identity |
 §3  customers ports
+    | API customers | RatingAlertRecipientsPort | API identity | scoped managers and effective comment readers on the caller's tx |
+    | API customers | PerformerNamePort | API staff | snapshotted employees' current display-safe first names |
+    | API customers | LowRatingNoticePlacePort | API tenancy | exact request branch names and mandatory tenant/place context |
 YAML imports
-  customers: [tenancy, settings, staff]
+  customers: [tenancy, settings, staff, identity]
 Planned reads comments in A1; active YAML entries land WITH their adapters in E
+  # Planned E: customers -> settings.readAlertRule @ apps/api/src/modules/customers/persistence/alert-rules.adapter.ts
+  # Planned E: customers -> identity.readBranchRoleHolders @ apps/api/src/modules/customers/persistence/rating-alert-recipients.adapter.ts
+  # Planned E: customers -> identity.readRatingCommentReaders @ apps/api/src/modules/customers/persistence/rating-alert-recipients.adapter.ts
+  # Planned E: customers -> staff.readEmployeeDisplayNames @ apps/api/src/modules/customers/persistence/performer-name.adapter.ts
+  # Planned E: customers -> tenancy.describeWorkspaces @ apps/api/src/modules/customers/persistence/low-rating-names.adapter.ts
```

The E map diff removes each `# Planned E:` comment and adds the same exact row as `  - customers -> …` when that
adapter exists. This respects the existing map's "each reads line lands with its adapter" rule; A1 claims no source
file exists. Its ADR/allowed-arrow/port declaration is independent of P1's permission FK and E's implementations.

Acyclic: identity imports only tenancy; no module imports customers back on these paths. The applied A1 map passed
`pnpm module-map:check`; this checks declared topology, not the legality of unimplemented runtime adapters.

### 6.7 Consumers and test protocol (later, not now)

Consumers: `readRatingCommentReaders` → customers recipients adapter only; `readEmployeeDisplayNames` (API) → customers
performer adapter only; `readBranchRoleHolders` keeps its staff consumer unchanged plus the new one.

Later CI integration tests on the pipeline-authorized isolated database are specific to each contract:

- **Identity recipients:** other company/branch scope and expired memberships do not qualify; expired overrides
  cease applying; covering DENY excludes a manager except existing canonical-owner protection. A custom/non-manager
  role with a historic ALLOW does not qualify; role changes use the current role at the decision time. A covering
  DENY on a sibling non-manager membership still counts. Owner inclusion still requires effective ALLOW.
- **U4 ordering controls (future):** revoke, DENY, ALLOW, expiry and current-role changes on both sides of the
  authorization decision, plus application/database clock skew. Expected outcomes and decision ordering must come
  from the later approved U4 design before E's readers land; no concurrency guarantee or test execution is claimed here.
- **Routing controls (future):** omitted/empty submissions become a null stored comment and send `low_rating` to
  every eligible candidate without an ACL read; non-null comments keep the disjoint permission partition. An enabled
  rule with empty channels or no IN_APP emits no notice and does no alert-only reads while consume/rating stays intact;
  selected IN_APP is the positive control. Preserve unique recipients and the non-null with-comment schema.
- **Staff names:** other-company ids return no rows; requested snapshot ids from BOTH branches of the same business
  and request day are valid and all stay named (D-B3). Soft-deleted staff remain included. No role/membership or
  visit-branch filter is invented for this company-and-ids reader. Equal names of different employees remain distinct.
- **Place adapter:** the exact request company/business/branch must be present in the returned tenancy tree;
  mismatch/null is an availability failure in the enabled-alert transaction, with no partial consume or outbox.
- **Shared transaction/scale:** each read uses the supplied tx (including a same-tx uncommitted-data control);
  no new connection and no query per user/performer. Fixed planned query count is not bounded payload or latency.

The A1 delivery runs documentation/static gates (evidence §E10), then exact-head CI per PP-113. The executable
integration cases above belong to E and remain unrun; no benchmark or application test is claimed for A1.

## 7. Candidate split, graph and compatibility

### 7.1 Steps (candidate, NOT approved PRs; one open PR per session)

| Step | Content | Inert until | Migration |
|---|---|---|---|
| P1 | ratings-read permission catalog, role defaults, seed, grant refusal (only the four roles), current-role policy — moved from 61-2 | E | future decision before generation; no migration number allocated or reserved |
| A1 | AUTHORIZED docs only: §6 interface approval, ADR/module-map declarations/generated YAML and proposed reader/adapter contracts; no readers or tests implemented | E | no |
| T | spec 060 FR-B13 update BEFORE contracts variants, then notifications validator/definitions/copy, worker input/handler branch, API response union, admin renderer + i18n | E | no |
| K | `LOW_RATING` kind in rules storage/contracts; NOT added to the listed kinds until E | E | TBD (evidence F7–F16 carried forward) |
| E | ports, adapters, composer, root closure, use-case wiring (replaces the TODO at `submit-rating.usecase.ts:65`), listing the kind | — | no |

Graph: P1 → E; A1 → E; T → E; K → E; E → 61-2 averages (61-2 no longer creates the permission). A1 is docs only,
so P1 is not its predecessor. P1 precedes the eventual E reader integration tests because the real grants use the
new permission's FK. No permission parameterization or fixture for an unrelated code is proposed. This is a proposed
dependency update, not a spec patch. Same owning session delivers one approved PR at a time.

Source scope per step (anything outside its row is a hidden expansion and stops the step):

| Step | Allowed paths (prod, tests and docs of the same paths) |
|---|---|
| P1 | identity access catalog and role defaults, seed, the grant use case's refusal rule, `packages/db` migration + snapshot + journal (TBD), spec/ADR notes for the moved rows |
| A1 | `docs/adr/0010-phase-1-ports-and-events.md`, `docs/module-map.md`, its generated `docs/module-map.yaml`, and the dependency/spec documentation approved for this prerequisite; NO production readers or test implementations |
| T | FIRST: `docs/specs/060-ratings-and-staff-app/spec.md` (FR-B13 names both revision-1 template keys), in the same PR and before any contract change; then `packages/contracts` (in-app + notification unions, details schemas, OpenAPI output), `packages/notifications/src/templates/*` (two definitions, validator), worker `notifications/{domain,events/handlers}`, API `notifications` response typing only, `apps/admin/src/notifications/*`, `packages/i18n` catalogs |
| K | `packages/domain` alert kinds, `packages/contracts` alert-rules, settings persistence/tests for the kind (listing excluded) |
| E | API `customers/{domain,ports,persistence,use-cases/submit-rating}`, `customers.module.ts`; approved API identity reader/domain decision + index export and API staff reader + index export; corresponding tests; listed-kinds file; error-path documentation |

### 7.2 Adjacent versions and the rollback floor

| Pair | Compatible? | Why |
|---|---|---|
| T over pre-T | yes | additive union variants; legacy rows unchanged |
| pre-T API + any low-rating row | **no** | strict page parse fails the whole inbox |
| pre-T worker + E event | **no** | `NOTIFICATION_REQUEST_INVALID` → retry → park |
| E over T | yes | producer after consumer |
| E → T (code rollback) | yes | rows and queued events remain readable — **code floor = T** |
| below T after rows exist | **no** | **T is a hard code floor**; forward to T or later only. A1 authorizes no below-floor recovery, SQL delete/reverse or DB restore recipe. Any future recovery needs a separately reviewed post-snapshot-write/data-loss plan and applicable decision; production/data decisions belong to Waleed (PP-117/PP-124). PP-129 governs staging pre-migrate snapshot timing, not restore authority |
| K old admin vs new kind | settings only | an old settings view ignores the future kind; the inbox is keyed by template, not kind |
| A1 versus either adjacent code version | yes, docs-only | no runtime change; future reads must be recorded without falsely claiming existing adapter files |
| P1 rollback after defaults | BLOCKED pending G/S plan acceptance and evidence | proposed code floor G; never below its guard/read policy while defaults remain, and never an automatic SQL reverse |

**P1 rolling-version gate (source-derived, not an executed reproduction or a shipped-leak claim):**

- Runtime override writer: `identity/persistence/permission-override-transactions.ts`; SAVE expires/replaces rows,
  REVOKE expires a row. Company/business controllers share the grant/revoke use cases. Other writer classes:
  onboarding's fixed owner membership; `packages/db/src/seed.ts` global catalog/defaults; privileged historical
  migrations; `operator/staging-staff.ts` fixed staff membership; test/demo `seed-e2e-membership.ts` (not runtime).
  Platform grants are separate; discount-limit writes change only `limit_bps`. No runtime role/default CRUD was
  found in API/worker source. Live custom-role presence and operator invocations remain UNKNOWN, not assumed absent.
- Catalog insertion alone supplies no ALLOW. The editor must hold the code; approved defaults in `role_permissions`
  bootstrap that access. `protectOwnerAccess` removes DENY, not creates ALLOW. Other privileged writes/restores must
  also be inventoried before grantability. Old compiled `systemRolePolicy` refuses unknown ALLOW on system-role
  targets, but custom targets have `allowedPermissions = null`; old custom-role read filters admit that ALLOW.
  After defaults, an authorized old-code editor can therefore grant the code outside the four eligible roles.
- **Proposed G then S (requires manager acceptance; no extra PRs approved):** G contains only the SAVE refusal and
  current-role read policy. SAVE ALLOW checks the target's current eligible system role inside the transaction before
  expiring/inserting anything. The read policy makes historic/custom-role ALLOW inert in every applicable reader.
  Keep the code OUT of G's compiled catalog/default seed lists; otherwise running its seed could activate S early.
  S later adds the catalog/default/seed entries, only after the guard deployment proof. No migration number reserved.
- Do not blanket-refuse REVOKE: ending a disallowed ALLOW must remain possible cleanup. Ending DENY must not resurrect
  an ineligible ALLOW; G's current-role read policy is a prerequisite, not an assumption that no such rows exist.
  Identify every applicable reader before approving G, including API access/editor views and worker permission readers.
- **Before grantability anywhere:** DEP-1 must attest immutable image SHA/digest for EVERY serving API writer includes
  G, old writers drained, operator/seed/migration/restore invocation inventory, and no pending old writer. Compose's
  migrate-before-new-api start is not proof of draining. No live inspection/deploy/config is authorized now; evidence
  is UNKNOWN. No acceptance of an unverified rolling window is proposed. P1 remains independently BLOCKED.
- **Rollback floor after S = G**, retaining its read policy. Below-G code is unsafe while defaults remain. No SQL
  reverse; catalog deletion also breaks cleanup's catalog check. A1 authorizes no below-floor recovery. The verified
  `deploy/backup/restore-check.sh` restores only into its own scratch database, never over the live one; that check
  grants no live-restore authority. Any future recovery needs its own reviewed post-snapshot-write/data-loss plan
  and applicable decision, without extending PP-129 to production. G without S is inert; A1 depends on neither G nor S.
- **Future tests, heavy suites CI-only:** current-role/time SAVE and REVOKE for four eligible roles, other system and
  custom roles; old-version custom-role counterexample; historic ALLOW inert after role change and DENY revocation;
  permitted ALLOW cleanup; tenant negatives; refused writes leave override/audit rows and invalidation unchanged.

Rollout rule: merge T inert, roll it out to EVERY API and worker node, then deploy E. No claim is made that every future
prior version is compatible.

## 8. Counting (all categories, added and deleted)

| Item | Prod | Tests | Docs | Generated | Total |
|---|---|---|---|---|---|
| This planning change (2 new docs vs baseline) | 0 | 0 | +see evidence §E9 | 0 | see §E9 |
| P1 | TBD | TBD | TBD | TBD unmeasured (migration SQL, snapshot, journal) | TBD |
| A1 policy projection | +0/−0 | +0/−0 | +57/−2 (ADR, module map) | +1/−1 (`module-map.yaml`) | +58/−3 before any plan/evidence additions |
| T | TBD | TBD | TBD | TBD unmeasured (OpenAPI) | TBD |
| K | TBD | TBD | TBD | TBD unmeasured | TBD |
| E | TBD | TBD | TBD | TBD unmeasured (OpenAPI if any) | TBD |

TBD is not 0 and nothing is excluded. B has been selected as design only. The current authorized A1 brief is 1000
total added/deleted lines including generated output, with refusal above 2000 and a three-round correction cap;
future production briefs remain unapproved. The actual A1 diff size is recorded after gates, not inferred from estimates.

The fresh independent design review examined the pre-correction artifacts recorded in evidence §E5. It confirmed
U1/U3 and the explicit U2/P1 gates, but required these two corrections: count/include the generated YAML, and scope
the reader tests by contract. The lead fixed both in this single documentation batch. That review is not represented
as a clean approval of the changed hashes; the corrected A1 proposal is submitted for manager review only.

## 9. What waits on whom

- **A1:** apply only the approved documentation scope on verified live main, generate YAML from markdown, run the
  allowed documentation gates and fresh independent final-diff review, then open one PR. Merge waits on exact-head
  gates and coordinated order. Previous review receipts are not reused as final approval.
- **P1:** planning only: inventory every actual writer, prove guard-before-seed deployment on all writers and its
  rollback floor. No migration generation, seed, deployment/config change or reserved 0217. This is independent of A1.
- **U2 / U4 / T / K / E:** implementation remains blocked; load and emission-time authorization designs must be reviewed
  before E's readers land. No clock/locks/isolation or same-transaction guarantee is selected. No success
  semantics, timeout, performer cap, name policy or privacy expansion is silently adopted.
  T's FR-B13 spec update is a prerequisite of T, not A1 work; T/G are hard floors with no below-floor procedure authorized here.
- **Privacy:** §3.6 remains a condition to resolve separately in the final T/E plan. A1 neither changes the policy nor
  reopens RT-Q8/RT-Q9. No Waleed card now. Eventual migration approval remains required before generation.
- This is the manager's technical decision under existing authority, not a new verbatim Waleed decision. Existing
  deferrals and activation blockers, the #888 worktree and all backups remain intact.
