# 45 plan — extend a sold or imported package (`extend-package`)

Slice: spec 058 §5 row 45 (FR-040…FR-044, EX-01…EX-05), PK-Q1 (free), PK-Q16 (permission and limits),
PK-Q21 (imported rows extend like sold ones), TD-4 (branch-local today), TD-7 (no event), TD-9 (idempotency),
TD-15 (45 opens the `expires_on` guard). API only: the admin dialog and the extension history read
(FR-071) are a follow-up row (45-ui). No owner question is open: PK-Q1, PK-Q16 and PK-Q21 are answered and the
spec has no `TODO(spec)`. Base: `origin/main` 848080ca8. PR #956 (43-3) is still open, so `packageUsableOn` does
not exist yet; this slice does not need it (a redemption reads `expires_on`; an extension writes it).

## 1. Rules (spec map)

| # | Rule | Spec |
| --- | --- | --- |
| 1 | `POST /v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/extensions`, body `{ new_expires_on, expected_expires_on, reason }`, header `Idempotency-Key`; guard `extend:packages:branch` on `branchId`; feature `orders`; no device | FR-040, EX-05 |
| 2 | The entitlement must belong to the route business and company; otherwise 404 `PACKAGE_NOT_FOUND` (same code for unknown and foreign, no oracle). A `SOLD` and an `IMPORTED` entitlement are treated alike | FR-040, PK-Q21 |
| 3 | `expected_expires_on` must equal the locked stored `expires_on`, else 409 `PACKAGE_EXPIRY_STALE` (checked first: a stale caller never gets a rule error computed against a date it did not see) | FR-041, EX-02 |
| 4 | `new_expires_on > expires_on` else 422 `PACKAGE_EXTENSION_NOT_LATER`; `new_expires_on <= addTwoCalendarYears(today)` else 422 `PACKAGE_EXTENSION_TOO_LONG`. Today is the acting branch's local date at the use-case clock instant, in the branch's effective timezone (`packageSalePlace`). 29 February + 2 years is 28 February when the target year is not leap; 21 Oct 2026 -> 21 Oct 2028 accepted, 22 Oct refused | FR-041, EX-02, TD-4 |
| 5 | An expired entitlement can be extended (no expiry check); extension is repeatable; each extension moves only the date | PK-Q16, EX-03 |
| 6 | `reason` trimmed (space, tab, CR, LF only), 1..500 **code points**, no NUL, no lone surrogate: the shared `normalizeWrittenReason` (the 054 rule) is the only validator and the contract does not cap its length (a UTF-16 `.max(500)` would refuse valid astral text); bad -> `ApiError('VALIDATION_FAILED')`, HTTP 400 (the `SessionError` it throws is mapped by this controller, not by the sessions filter) | FR-041 |
| 7 | One transaction: idempotency claim -> access lock -> access read (acting membership, permission, feature) -> branch place -> entitlement `FOR UPDATE` -> CAS check -> domain rule -> insert `package_extensions` row -> `UPDATE package_entitlements SET expires_on` (the trigger needs the row of the same transaction) -> audit entry | FR-042, TD-9 |
| 8 | No amount, no payment, no slot or value change, **no outbox event**, `revision` unchanged (TD-7) | FR-043, EX-04 |
| 9 | The reason lives only in the `package_extensions` row. The audit entry `package.extended` carries `entity 'package_entitlement'`, `before {expires_on}`, `after {expires_on, extension_id}`; the actor comes from the context. Never the reason (054 D-8) | FR-044 |
| 10 | Replay of the same key + same fingerprint returns the original response (status 201, same body) and writes nothing; same key + different fingerprint -> 422 `IDEMPOTENCY_KEY_REUSED`; in flight -> 409. The fingerprint is a sha256 over method, route, company, actor, business, branch, entitlement and the canonical body (the sessions controller helper shape); the reason is never stored in clear anywhere but the extension row. A failure (403/409/422) rolls the claim back, so the key stays reusable. A replay after the caller lost the permission is stopped by the `@Require` guard (403) before the use case runs | TD-9 |
| 11 | Access semantics: the line-access reader returns `denied`, `feature`, `can_read` and `eligible`; here `denied` or no eligible membership -> 403 `FORBIDDEN`, feature off -> 403 `FEATURE_DISABLED`, `can_read` is ignored, `extended_by_membership_id` is the eligible membership with the lowest id | PK-Q16 |

Response body (201): `{ id, entitlement_id, previous_expires_on, new_expires_on, extended_at }`. No reason echo,
no money.

## 2. Layers in CLAUDE.md §1 order

| Layer | File(s) | Lane | Est. lines |
| --- | --- | --- | --- |
| Migration draft (unnumbered, lane not granted) | `docs/specs/058-packages-sell-redeem/45-extension-migration.draft.sql` (two new constraint-trigger functions, each with `REVOKE ... FROM PUBLIC` and `GRANT EXECUTE ... TO pospay_app` as 0205 does): permission seed `extend:packages:branch` (owner, general_manager, business_manager, branch_manager); 3 new columns on `package_entitlements`; table `package_extensions` with RLS, FORCE, policies, grants `SELECT, INSERT`, `CHECK new > previous`, reason `CHECK`, FKs and child-side indexes as the spec table lists; `CREATE OR REPLACE` of `package_entitlements_insert_guard` (forces the 3 new columns NULL) and `package_entitlements_update_guard` (opens `expires_on`, keeps every other refusal, jsonb-immutability list gains the 3 columns); two deferred constraint triggers (entitlement-side and extension-side, spec §6 "Extension history") | Agy | ~230 |
| Schema TS | `packages/db/schema/orders-packages.ts`: the 3 columns, `packageExtensions` table | Agy | ~70 |
| Permission catalog | `packages/db/src/access-catalog.ts`, `role-defaults.ts` (four managers), `system-role-policy.ts` | Agy | ~12 |
| DB test fixtures | `packages/db/test/package-grants.ts`, `tenant-table-inventory.ts`, `function-inventory.ts` (two new functions), `package-fk-indexes.spec.ts` list | Agy | ~25 |
| Domain (pure) | `packages/domain/src/packages/package-extension.ts` (`packageExtensionLimit`, `assertPackageExtensionAllowed`), `errors.ts` gains `PACKAGE_EXTENSION_NOT_LATER`, `PACKAGE_EXTENSION_TOO_LONG`, `index` export | Kimi | ~70 |
| Contract | `packages/contracts/src/orders/package-extension.ts` + `package-extension-openapi.ts`; export in `index.ts`, path in `openapi.ts`, schema names; regenerate `openapi.json` and the three `schema.d.ts` with the repo scripts | Kimi | ~110 |
| Error codes | `apps/api/src/shared/errors.ts` (+ a small `package-extension-error-statuses.ts` like `package-read-error-statuses.ts`), i18n ar/en catalog, `packages/i18n/src/permission-name.ts` | Kimi | ~40 |
| Identity | `apps/api/src/modules/identity/persistence/package-extension-access.ts` (lock + read of the acting membership, built on the existing line-access reader, which gains one `export`), `identity/index.ts` (2 add-only lines) | Kimi | ~40 |
| Port + use case | `orders/ports/package-extension.port.ts`, `orders/use-cases/extend-package/extend-package.usecase.ts` | Kimi | ~140 |
| Persistence | `orders/persistence/package-extension.transactions.ts`, `package-extension-records.ts` (locked read, insert, CAS update) | Kimi | ~170 |
| Http | `orders/http/package-extension.controller.ts`; `orders.module.ts` (add-only providers/controller lines); `docs/module-map.md` + `module-map.yaml` (orders -> identity symbol) | Kimi | ~90 |
| Tests | domain unit (~130), db guards + RLS negative (~380), api integration (~480), contract spec (~60), permission specs (~30) | Agy | ~1080 |
| Docs | this plan, brief receipts, `owner-questions` untouched (no question) | me | n/a |

Production code estimate: ~690 lines; tests ~1080; migration + schema ~300. A delivery above twice its category
estimate is refused (PP-112 / §14).

## 3. Migration design (draft; renumbering and `db:generate` wait for «lane granted»)

* `expires_on` opens by `CREATE OR REPLACE` of the same function (same name and signature). The new update guard
  keeps the closed `refunded_amount` and `revision` refusals and the immutability check, and for `expires_on`:
  acts only when `NEW.expires_on IS DISTINCT FROM OLD.expires_on` (an UPDATE that leaves it alone, such as row 46's `refunded_amount` and `revision`, must keep working): a decrease is refused (`23514`, constraint `package_entitlements_expires_on_forward_only`), a
  second change in the same transaction (`(expires_on_changed_system_id, expires_on_changed_txid)` equals
  `(pospay_system_id(), pg_current_xact_id())`, constraint `package_entitlements_expires_on_once`), and writes
  `expires_on_changed_system_id`, `expires_on_changed_txid` and `expires_on_before := OLD.expires_on`. The three
  columns are overwritten on every change and copied from `OLD` otherwise. A caller cannot write them on UPDATE at
  all (no column grant: a direct `SET` is a privilege error); on INSERT the insert guard forces them NULL.
  Fail closed (as 0200 lines 242-245): when `pospay_system_id()` is NULL or 0 the update guard and both deferred
  functions raise instead of comparing with NULL.
* Entitlement-side deferred trigger (`AFTER UPDATE OF expires_on`, `WHEN old distinct new`): at commit there is a
  `package_extensions` row of this entitlement with `previous_expires_on = expires_on_before` and
  `new_expires_on = expires_on`. Extension-side deferred trigger (`AFTER INSERT`): the entitlement has
  `(expires_on_changed_system_id, expires_on_changed_txid) = (pospay_system_id(), pg_current_xact_id())`,
  `expires_on_before = previous_expires_on` and `expires_on = new_expires_on`. Dates only increase and
  `UNIQUE (company_id, entitlement_id, previous_expires_on)` (spec addendum, review finding: two identical history
  rows, or a row inserted after `SET CONSTRAINTS ALL IMMEDIATE`, would otherwise both satisfy the check) lets each
  previous date appear once, so an older extension row can never satisfy a later change.
* `package_extensions`: PK `(company_id, id)`; `UNIQUE (company_id, business_id, id)`; reason `CHECK` as
  `service_line_edits_reason`; `CHECK (new_expires_on > previous_expires_on)`; all FKs and indexes of the spec
  table; `ENABLE` and `FORCE` RLS with `SELECT` and `INSERT` policies on `company_id = app_company_id()`;
  `REVOKE ALL` then `GRANT SELECT, INSERT` to `pospay_app` only.
* The three trigger-owned columns are NULL at insert (the insert guard overwrites a supplied value).
* Permission seed copies migration 0136's shape (`INSERT INTO permissions … ON CONFLICT DO NOTHING`, then
  `role_permissions` for the four global roles).
* Expand-only; no data step; no destructive change.

## 4. Tests required

* Domain unit: forward only (equal, earlier, later), the 2-year boundary (21 Oct 2026 -> 21 Oct 2028 ok, 22 Oct
  refused), 29 February -> 28 February, a non-leap target, expired current date still extendable, invalid date
  strings, month/year ends.
* DB guards (private cluster, `pospay_app`): a lowered or equal `expires_on` refused; two changes in one
  transaction refused; an `expires_on` change with no extension row fails at commit; an extension row with no
  change fails at commit; a forged `expires_on_*` column is overwritten; `refunded_amount` and `revision` stay
  closed; the table `CHECK`s; `UPDATE` or `DELETE` of an extension row denied; cross-tenant read 0 rows and insert
  refused (RLS negative); FK-index catalog includes `package_extensions`; privileges allowlist.
* API integration: EX-01 happy path (row, new date, audit `package.extended` without the reason, no outbox row,
  `revision`, price, slots unchanged); EX-02 three refusals; EX-03 expired then extended then redeemable; EX-04 body
  with an unknown `amount` field -> 400; EX-05 no permission 403, device 403, feature off 403, imported entitlement
  extends; CAS conflict (two requests with the same `expected`: one 201, one 409 `PACKAGE_EXPIRY_STALE`); idempotent
  retry (same key: same body, one row, one audit entry); key reuse with a different body 422; foreign-tenant or
  foreign-business entitlement 404; repeatable extension; invalid reason 400; branch-local today (two timezones).
* Permission specs: role defaults, system role policy, i18n permission name.

Added after the debate (all accepted, see `debate-45-advisor.md`): an `UPDATE` that leaves `expires_on` alone
passes; the IMMEDIATE-then-insert case of TD-15(b); a direct `UPDATE ... SET expires_on_changed_txid` is a
privilege error; both replaced guards re-run 42-2's negative tests (`_immutable`, initial `refunded_amount` and
`revision`, import preview, creation seal kept from `OLD`); the CAS race uses two real connections; DENY override
and two eligible memberships; a reason of 500 astral code points accepted and 501 refused; the reason is absent
from `idempotency_keys`, the audit entry and the outbox; no outbox row; a rolled-back 409 or 422 leaves the key
reusable; replay after permission loss is 403; an extension to a still-past date is allowed; `today` and
`extended_at` come from one clock instant taken after the locks. EX-03's refund half waits for row 46 (only the
redemption half is tested here).

## 5. Risks and non-goals

* No admin screen, no history read (FR-071), no notification (PK-Q16: no bell). Row `45-ui` follows; spec row 45 lists the dialog and FR-071 as part 3, so the split needs a roadmap row (CLAUDE.md 5c, the manager's call). The spec row also says 45 lands after 43-3 on the detail file; this slice does not touch that file, so it can merge before #956. 46-1 will `CREATE OR REPLACE` the same update guard: whichever merges second must carry the first's body.
* The guard path stays at one transaction per guard (§6): the route uses `@Require`, and the use case re-reads
  access inside its own transaction with one `withTenant` as every line writer does.
* Locks: access rows first, then the entitlement row `FOR UPDATE`. A redemption locks component and slot rows and
  its FKs point at components and slots, not the entitlement; only a sale or import insert (new components) takes
  `FOR KEY SHARE` on an entitlement, and that never happens on an existing one. `FOR UPDATE` does conflict with
  `FOR KEY SHARE`; an earlier note saying otherwise was wrong.
* An extension racing a redemption that already read the old date is an ordinary serial order, not a defect.
