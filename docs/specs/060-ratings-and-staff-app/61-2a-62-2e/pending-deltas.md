# Pending deltas to tracked documents

Proposed changes to canonical documents for the implementation PR. Recheck against the implementation base.
Section 1 belongs to the manager. Sections 2 to 4 are implementation handoff. The approved scope and review tier are recorded in PP-213.

## 1. Owner question DN-Q1

DN-Q1 is recorded as PENDING in [the canonical owner-question record](../owner-questions.ar.md).
The manager retains responsibility for the product decision and any decisions-page batch.

Rule in the spec: `spec.md` BR-D3 keeps its `[NEEDS CLARIFICATION]` marker until the answer is recorded here verbatim.

## 2. `docs/module-map.md` (then `pnpm module-map:generate`)

**§ port table** — add two rows next to the existing API `customers` rows (after the `LowRatingNoticePlacePort` row):

```markdown
| API `customers` | own rating-summary authority (`OwnRatingReads.context`) | API `staff`, API `identity`, API `tenancy` | the business and its active branches (`describeWorkspaces`), the caller's own eligible employee (`readOwnEmployee`), membership + feature `customers` + `read:ratings:own` (`readOwnRatingsAccess`), and the business timezone (`activeBusinessTimeZone`), all on the read transaction (ADR-0010 addendum 2026-11-21, spec 060 FR-A05/FR-B14, 61-2a) |
| API `customers` | `StaffColumnsPort.allowed` (first use by a route) | API `settings` | the `rating_average` gate of the rating summary; the `reads` line already exists (ADR-0010 addendum 2026-10-21) |
```

**§6 `reads`** — add four lines (API section, beside the other `customers ->` lines), in the commit that adds the
adapter file:

```text
  - customers -> staff.readOwnEmployee @ apps/api/src/modules/customers/persistence/own-rating-context.adapter.ts
  - customers -> identity.readOwnRatingsAccess @ apps/api/src/modules/customers/persistence/own-rating-context.adapter.ts
  - customers -> tenancy.activeBusinessTimeZone @ apps/api/src/modules/customers/persistence/own-rating-context.adapter.ts
  - customers -> tenancy.describeWorkspaces @ apps/api/src/modules/customers/persistence/own-rating-context.adapter.ts
```

The checker reads each line as `{ from, to, symbol, file }` (`scripts/module-map/module-map.mjs`), and today's map
repeats a symbol once per adapter file, so `describeWorkspaces` gets its own line for the new file although
`workspace-names.adapter.ts` already has one.

No `imports:` change: `customers: [tenancy, settings, staff, identity]` already covers all four.
62-2e adds no line: the lookup reuses `staff -> identity.readDocumentAccess`, which is listed.

## 3. `docs/adr/0010-phase-1-ports-and-events.md` — new addendum at the end

```markdown
## Addendum 2026-11-21 — 61-2a: the staff rating summary's own-read authority

Scope: the API read `GET /v1/staff/me/rating-summary` (spec 060 FR-A05, FR-B14; `plan-61.md` §6). It is the part of
`plan-61.md` §2.4 that row 61-2a needs; the worker ports and the two events of that section stay with docs PR 61-1a
(A-2) and are not approved here.

- API `customers` resolves its authority through reads on already-declared arrows, on the read transaction:
  `tenancy.describeWorkspaces` (the business and its active branches), `staff.readOwnEmployee` (the caller's own
  eligible employee), the new `identity.readOwnRatingsAccess` (membership, feature `customers`, `read:ratings:own`)
  and `tenancy.activeBusinessTimeZone` (the month window of D-B12).
- The route accepts the ADR-0027 personal staff session only.
- It is the same shape ADR-0041 records for orders' own-work reads; no interface is shared between the two modules.
- No import arrow is added. `customers → tenancy, settings, staff, identity` are already declared.
- The `rating_average` column gate is read through customers' existing `StaffColumnsPort` and stays off until 61-3.
- No event is added or changed.
```

## 4. `docs/specs/060-ratings-and-staff-app/spec.md` — notes on two rows (append, do not rewrite)

- Row **62-2e**: append «**As planned (2026-11-21, `61-2a-62-2e/`):** there is no document edit route on `main`, so
  the number is accepted on record/replace only (DN-Q1 asks about an in-place edit); the record response does not
  carry the number; the bell reads it through `GET /v1/businesses/:businessId/employee-document-numbers`. Size
  re-estimated in that folder's `plan.md` §7.»
- Row **61-2** (or the 61-x table when 61-1a replaces it): append «61-2a is planned together with 62-2e in
  `61-2a-62-2e/`; its ports are documented by the ADR-0010 addendum of 2026-11-21.»

## 5. After merge (manager; not part of the PR)

`public/roadmap.json` in `lolotam/plan`: rows 61-2a and 62-2e (`git pull` first, edit in place). Not done here.
