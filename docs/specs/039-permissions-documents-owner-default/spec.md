# Feature Specification: Employee documents — owner-only by default

**Feature Branch**: `feat/p1-13b-documents-owner-default`

**Created**: 2026-10-09

**Status**: Decided — all six owner questions answered by Waleed on 2026-10-09 (`owner-questions.ar.md`); the partner
Abu Salem (Mohammed Al-Enezi) chose the same on all six. Ready for `/speckit-plan`.

**Input**: User description: "permissions-documents-owner-default — Phase 1 row 13b. Employee-document access
defaults to the owner only (owner review 2026-10-09, DOC-Q2 + S014-GRANTS)."

**Phase 1 row**: 13b (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md`), depends on 7 (permissions screen) and 13
(document types + `record-employee-document`, spec 028). Sources: owner review 2026-10-09
(`docs/specs/phase-1/owner-review-2026-10-09.ar.md`, DOC-Q2 + S014-GRANTS); spec 014 (files), spec 019 / ADR-0025
(stored system-role bundles and personal-ALLOW eligibility), spec 028 / ADR-0031 (employee document ↔ file binding),
spec 033 MO-Q1 (expiry-alert recipients), spec 030 / ADR-0034 (employee import framework).

**The owner's decision:** employee documents belong to the **owner only by default**. The owner gives access to any
person, of any human role. The general manager and the business manager no longer get it automatically. It covers
uploading and opening employee documents, and editing the list of document types. Only the owner can give these
rights to someone else.

### What exists today (research, 2026-10-09)

1. **Role defaults are global rows, not per company.** System-role bundles live in `role_permissions` with
   `role_owner_key = 'global'`, `company_id = NULL` (migrations 0058, 0075; seed `seedRoleDefaults` from
   `ROLE_DEFAULTS` in `packages/db/src/role-defaults.ts`). Every company's memberships resolve them through the role
   FK, so a changed default reaches every existing company at the same moment (OD-Q1 accepts that).
2. **Today's defaults:** `read:files:business` and `manage:files:business` → owner, general_manager,
   business_manager; `manage:document-types:company` → owner, general_manager (business_manager: optional cell,
   personal ALLOW only).
3. **Personal ALLOW is only possible for eligible cells.** `systemRolePolicy` = role defaults ∪ the `optional` table ∪
   always-eligible lists (salaries, schedules, leave). A new ALLOW on an ineligible cell is refused
   (`PERMISSION_ROLE_FORBIDDEN`) and a historical one is ignored (ADR-0025). Today files are not eligible for the
   accountant, kitchen, cashier … — this slice makes them eligible.
4. **There is no role editor.** The owner gives a permission to a *person* (personal ALLOW, business or company scope).
   Custom roles chosen by the owner are a later row (see "Out of scope").
5. **`files:*` also gates employee import.** The import spreadsheet (PR 11, ADR-0034) is uploaded through
   `POST /v1/businesses/:id/files/uploads` (`manage:files:business`) and stamped `read:files:business`, which the
   uploader must also hold. After this slice a manager without a personal files grant gets 403 on that upload, so
   employee import becomes owner-only unless the owner grants files to a person. **The owner chose this knowingly
   (OD-Q4 = B).** Template download, preview and commit stay guarded by `manage:employees:business` as today.
6. **What a manager sees without access:** the employee documents section renders nothing on 403
   (`employee-documents-section.tsx`); the "document types" link stays, and the page answers 403.
7. **Expiry alerts:** PR 15 emits `DocumentExpiring` without recipients; recipients arrive with alert rules (PR 62).

### Design (D1 — the literal one, chosen by OD-Q4 = B)

The three existing codes leave the general_manager and business_manager bundles; the owner keeps them; all three
become eligible for a personal ALLOW on every human role; only the canonical company owner may save such an ALLOW.
No new permission code, no file-row migration. (D2 — separate employee-documents codes — was recommended to keep
import open to managers; the owner declined it.)

### Out of scope / future rows

- **Owner-defined custom roles** (owner direction 2026-10-09, «المهم الصلاحيات مش اسم الدور»): the owner will create
  roles himself and pick their permissions; a "finance & admin manager" role will be built that way. Needs its own
  plan row (role editor per company). Not built here.
- **Expiry-alert recipients** are wired in PR 62; this slice only fixes the rule (OD-Q3).
- Hiding the "document types" link for people without the right (UI polish).

### Documents to update in this PR

- `IMPLEMENTATION-PLAN.md` row 13b — already names the three codes; add the import consequence.
- ADR-0025 amendment (bundles, eligibility, owner-only granting); ADR-0031 amendment (who holds the stored file
  permission by default).
- Spec 028 permission table and DOC-Q2; spec 019 matrix row for files; spec 033 MO-Q1 (recipients = holders of
  `read:files:business` at the employee's business).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Only the owner opens and uploads employee documents by default (Priority: P1)

The salon owner wants employees' residency, passport and contract copies private. After the release, the general
manager and the business manager no longer see, open or upload employee documents unless the owner gives them access.

**Why this priority**: the owner's decision; personal documents are the most sensitive staff data.

**Independent Test**: owner, general manager and business manager of one synthetic company open an employee with a
recorded document.

**Acceptance Scenarios**:

1. **Given** an employee with a recorded residency copy, **When** the owner opens the employee, **Then** the documents
   section lists it and the owner can open the file and upload a new one.
2. **Given** the same employee, **When** the general manager (no personal grant) opens it, **Then** the documents API
   answers 403, the section is not shown, and the download link request answers 403.
3. **Given** the same, **When** the business manager of that business (no personal grant) tries, **Then** the same 403s.
4. **Given** a document recorded before the release, **When** the general manager asks for its link, **Then** 403.
5. **Given** a general manager without a grant, **When** he lists or edits document types, **Then** 403.

---

### User Story 2 - The owner gives document access to a chosen person (Priority: P1)

The owner gives one accountant (or a trusted manager) access from the permissions screen: "view files" only, or
"view and upload files", for one business or the whole company, and/or "manage document types".

**Why this priority**: the right stays grantable (OD-Q6); today it is not grantable to an accountant at all.

**Independent Test**: as owner, add a personal ALLOW of `read:files:business` (then `manage:files:business`) for an
accountant membership; repeat for a general manager.

**Acceptance Scenarios**:

1. **Given** an accountant with a personal ALLOW of `read:files:business` for business X, **When** she opens an employee
   of X, **Then** she sees and opens documents but cannot upload (`can_manage = false`).
2. **Given** she also gets `manage:files:business` for X, **When** she uploads a contract, **Then** it is recorded; for
   business Y she still gets 403.
3. **Given** a general manager with a personal ALLOW of `manage:document-types:company`, **When** he adds a type,
   **Then** it succeeds.
4. **Given** the owner revokes the grant, **When** the accountant reloads, **Then** access is gone (live recheck).
5. **Given** any of the 13 human roles, **When** the owner saves an ALLOW of any of the three codes, **Then** it is
   accepted; for a Device membership it is refused with `PERMISSION_ROLE_FORBIDDEN`.
6. **Given** a business manager who holds files through a grant and was delegated `manage:memberships:business`,
   **When** he tries to give `read:files:business` to a cashier of his business, **Then** it is refused with
   `PERMISSION_OWNER_ONLY` (OD-Q5); a DENY or a revoke by him follows the existing rules.

---

### User Story 3 - Employee import follows the files right (Priority: P2)

**Why this priority**: regression guard for the consequence the owner accepted (OD-Q4 = B).

**Independent Test**: import as the owner, as a general manager without files, and as a general manager granted files.

**Acceptance Scenarios**:

1. **Given** a general manager with default bundles only, **When** he uploads the import spreadsheet, **Then** 403.
2. **Given** the owner, **When** he uploads, previews and commits, **Then** it works as before.
3. **Given** a general manager granted `read:files:business` + `manage:files:business` for the business, **When** he
   uploads, previews and commits, **Then** it works (he still needs `manage:employees:business`, which he has).

### Edge Cases

- Existing personal ALLOWs or DENYs of the three codes stay untouched; an ALLOW given earlier to a now-eligible role
  starts to count (it was ignored before — expected to be none in the pilot).
- A personal ALLOW saved earlier by a non-owner editor stays valid; OD-Q5 applies to new saves only.
- The owner's own historical DENY cannot reduce the owner's authority (ADR-0025, unchanged).
- A business manager given a COMPANY-scope ALLOW reaches every business — the owner chose that scope.
- Device: forbidden for all three, new and historical ALLOWs (spec 022, unchanged).
- Rollback of code alone does not restore manager access; that needs a new reviewed migration (ADR-0025).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: By default only the company owner MAY list, open, upload and record employee documents, upload files
  through the files endpoint, and manage document types.
- **FR-002**: The general manager and the business manager MUST lose `read:files:business`,
  `manage:files:business` and (GM) `manage:document-types:company` in every existing and new company at the release
  (OD-Q1 = A). No grandfathering grants.
- **FR-003**: The accountant gets none of them by default (OD-Q2 = A).
- **FR-004**: The three codes MUST be eligible for a personal ALLOW on all 13 human system roles, at business or
  company scope as the owner picks; Device never (OD-Q6 = A).
- **FR-005**: Only the canonical active company owner MAY save a personal ALLOW of any of the three codes; any other
  editor gets `PERMISSION_OWNER_ONLY` (403) (OD-Q5 = A). DENY and revoke keep the existing rules.
- **FR-006**: A manager without the files rights sees nothing about documents; expiry-alert recipients (PR 62) are the
  holders of `read:files:business` at the employee's business — the owner by default (OD-Q3 = A).
- **FR-007**: Employee import upload requires the files rights like any upload (OD-Q4 = B).
- **FR-008**: The permissions screen no longer lists the codes under the managers' role defaults.
- **FR-009**: No personal decision, membership or history row is changed by the migration.

### Key Entities

- **System role bundle** (`role_permissions`, global): loses 5 rows (GM files ×2, BM files ×2, GM document types).
- **Personal override**: the only way to give the rights to someone else; saved only by the owner for these codes.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: Defaults of `read:files:business`, `manage:files:business`, `manage:document-types:company` = owner only.
- **BR-002**: The three codes are eligible for a personal ALLOW on every human system role; Device ❌.
- **BR-003**: An ALLOW of the three codes is saved only when the editor is the canonical active company owner.
- **BR-004**: Upload/record of a document still requires read and manage files at the employee's business (spec 028).

### Schema changes

No table, column, RLS policy, grant or index change. One reference-data migration
`NNNN_2026-10-09_documents-owner-default.sql` (number assigned at merge; currently 0096), idempotent:

```sql
DELETE FROM role_permissions WHERE role_owner_key = 'global' AND company_id IS NULL
  AND role_id IN ('01920000-0000-7000-8000-000000000102','01920000-0000-7000-8000-000000000104')
  AND permission_code IN ('read:files:business','manage:files:business','manage:document-types:company');
```

The seed follows `ROLE_DEFAULTS`. Rollback: old code reads the same rows; restoring manager defaults needs a new
reviewed migration (ADR-0025 rule).

### API contract

No new endpoint, no contract change. New error `PERMISSION_OWNER_ONLY` → 403 on
`POST /v1/permissions/memberships/:id/overrides` and the business-scoped equivalent; `message_ar`
«صاحب الشركة فقط يقدر يمنح الصلاحية دي», `message_en` "Only the company owner can grant this permission".
Unchanged guards: files upload `manage:files:business`; documents via `readDocumentAccess`; document types
`manage:document-types:company`.

### Permissions

| Code | Default | Eligible (personal ALLOW) | Who may grant | Device |
|---|---|---|---|---|
| `read:files:business` | owner | all 13 human roles | owner only | ❌ |
| `manage:files:business` | owner | all 13 human roles | owner only | ❌ |
| `manage:document-types:company` | owner | all 13 human roles | owner only | ❌ |

Code touch points: `packages/db/src/role-defaults.ts` (`ROLE_DEFAULTS`, new exported `OWNER_GRANTED_PERMISSIONS`
list), `packages/db/src/system-role-policy.ts` (eligible for every human role; drop the BM `optional` entry),
`apps/api/src/modules/identity/domain/permission-edit.ts` (+ `editorIsCompanyOwner` in `PermissionEditContext`),
`apps/api/src/modules/identity/persistence/permission-editor-context.ts` (reads the editor's canonical owner status in
the same locked transaction), `apps/api/src/shared/errors.ts`, `packages/i18n/src/{ar,en}.ts`.

### Events

None. `DocumentExpiring` recipients (PR 62) follow FR-006.

### Test plan

- **Domain unit**: `permissionEditFailure` — non-owner editor + ALLOW of each of the three codes →
  `PERMISSION_OWNER_ONLY`; owner editor → null; non-owner DENY/REVOKE → unchanged result; other codes unchanged.
- **Reference unit** (`packages/db`): `role-defaults.spec.ts` (GM/BM lose the codes); `system-role-policy.spec.ts`
  (13 human roles eligible for the three codes, Device not; `kitchen / manage:files:business` flips to true);
  `seed.spec.ts` if it counts rows.
- **Integration** (`ODOC-01…09`):
  `ODOC-01` owner lists/opens/uploads ✅ · `ODOC-02` GM default → 403 documents list, record, download ·
  `ODOC-03` BM default → 403 · `ODOC-04` GM → 403 on document types · `ODOC-05` accountant read ALLOW (business X) →
  list/open ✅, upload 403, business Y 403; + manage → upload ✅ · `ODOC-06` GM `manage:document-types:company` ALLOW →
  ✅ · `ODOC-07` non-owner editor ALLOW → `PERMISSION_OWNER_ONLY`; Device ALLOW → `PERMISSION_ROLE_FORBIDDEN` ·
  `ODOC-08` import: GM default → upload 403; owner → upload/preview/commit ✅; GM granted files → ✅ ·
  `ODOC-09` migration: stored global rows equal `ROLE_DEFAULTS`; overrides, memberships, custom-role rows unchanged.
  Update `identity/__tests__/role-default-grants.spec.ts` (append the migration to `applyReferenceMigrations`),
  `files/__tests__/owner-decisions.spec.ts` (6 → 2 rows; GM/BM uploads 403), `staff/__tests__/employee-documents-http.spec.ts`
  (BM actor now needs a grant), and any test that relies on manager file defaults.
- **RLS negative**: no new table; existing negatives unchanged.
- **Admin**: `role-defaults.spec.tsx` fixture; no new UI.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a fresh and an upgraded company, 0 general manager / business manager memberships without a personal
  grant can open, upload or list any employee document, or manage document types.
- **SC-002**: The owner can give or remove the rights for one person in under one minute, for any of the 13 human roles.
- **SC-003**: 0 non-owner editors can give the three rights.
- **SC-004**: No existing personal decision is lost or rewritten.

## Owner answers (2026-10-09, Waleed; partner chose the same)

- **OD-Q1 — Existing companies:** A — removed from all managers at once in every company; the owner re-grants.
- **OD-Q2 — Accountant default:** A — nothing by default. Partner note (no scope change): finance/admin positions in
  small businesses need their own rights → covered later by owner-defined custom roles.
- **OD-Q3 — Managers and expiry:** A — managers without the right see nothing; alerts go only to holders of document
  read. Partner note: the finance/admin manager and a PRO should receive them, with status updates on the procedure —
  later rows (custom roles; PR 62 alert rules).
- **OD-Q4 — Employee import:** B — design D1; import becomes owner-only unless the owner grants files to a person.
- **OD-Q5 — Who can grant:** A — only the owner.
- **OD-Q6 — Role vs person:** A — per person; the three codes eligible on all 13 human roles, never the Device.
  Partner note: per-user grants are organised enough.

## Assumptions

- The permissions screen keeps listing the codes for every editor; a non-owner editor's save is refused by the API
  with a clear message (no screen change).
- The pilot has no real manager depending on documents yet; the owner re-grants where needed after the release.
