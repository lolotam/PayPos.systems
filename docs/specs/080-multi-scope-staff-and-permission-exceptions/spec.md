# 080 — Multi-scope memberships, additional roles & inline permission overrides on user creation (`PR-Q9`)

**Status:** Draft specification (docs only — **do not implement yet**; opens sequentially after `spec 079` completes).  
**Source:** Owner decision batch `PR-Q9` (Waleed, card responses on 2026-11-26 ~09:30 Kuwait — [`owner-questions.ar.md`](./owner-questions.ar.md)), separated from `spec 079` (`PR-a`/`PR-b`/`PR-c1`/`PR-c2`) by Project Manager decision (2026-11-26 14:00 Kuwait) to respect `PP-273` (`≤1,500` prod lines per PR).  
**Partner Review:** `PR-Q9` (`079-Q9`, Batch 106) confirmed by **Abu Salem** (`2026-11-27T13:51:28.130Z`, `verdict: "ok"`, `choice: 0`, `text: ""` — **«الأربعة كلهم.»**), matching Waleed's choices in full; `TQ-080-1` (`owner`-only multi-scope + inline overrides) confirmed by **Waleed** (`2026-11-27 17:05`, «YES , YES , YES», `PP-280`).

---

## 1. Context & Problem Statement

Under `spec 076` (`FR-F1-3`, `FR-G1-2`), back-office member invitations (`G1`) and employee staff access grants (`F1`) are constrained to a single role and a single scope:
- Member invitation (`G1`): assigns one system role (`general_manager`, `business_manager`, `branch_manager`, or `accountant`) with one matching single scope (`COMPANY`, one `BUSINESS`, or one `BRANCH`).
- Employee staff access (`F1`): assigns `staff` or `cashier` at the employee's single primary `BRANCH` (`employees.primary_branch_id`).
- Fine-grained per-membership permission adjustments (`ALLOW` / `DENY` overrides via `permission_overrides`) exist only post-creation on the dedicated permissions screen (`spec 009`), not during the initial member/user creation flow.

Waleed (`PR-Q9`) explicitly requested expanding user/member creation so owners (and authorized managers where permitted) can grant:
1. **More than one branch** («أكتر من فرع»),
2. **More than one business within the same company** («أكتر من نشاط»),
3. **More than one role for the user/employee** («أدوار أكتر للعامل»), and
4. **Extra/inline permission exceptions above their role during creation** («صلاحيات زيادة فوق دوره» / «استثناء صلاحية»), reusing existing `permission_overrides` semantics rather than inventing a parallel authorization system.

---

## 2. User Scenarios & Functional Requirements (Draft)

### 2.1 Multi-Branch & Multi-Business Scope Assignment (`PR-Q9-1`, `PR-Q9-2`)

- **FR-080-1 (Scope model reuse — `memberships`):** Multi-branch and multi-business access for a user within one company SHALL be represented through multiple `memberships` rows (or a verified transactional batch write of active `memberships` via `packages/db` & `identity` ports) within the same company (`company_id`), keeping `memberships`'s existing single-scope constraint (`COMPANY` | `BUSINESS` | `BRANCH`) and existing `ADR-0003` RLS / permission evaluation intact.
- **FR-080-2 (Same-company containment & caller authority):** Every selected `business_id` and `branch_id` MUST belong to the caller's target `company_id` inside the write transaction, and the caller MUST hold authority over every target scope (for back-office member creation/invitations: canonical `owner` via `manage:memberships:company`; for branch staff extensions: only branches covered by the caller's `manage:staff-access:branch` or company owner — fail-closed `403` otherwise).
- **FR-080-3 (`076 D8` boundary preservation):** Staff users (`user.staffAccessOperationId !== null`, synthetic email) MAY receive multiple `BRANCH` memberships or allowed additional staff roles within their **single owning company**, and MUST still be refused any membership in a second company (`076 AC-F1-7` / `ADR-0063`).

### 2.2 Multiple Roles (`PR-Q9-3`)

- **FR-080-4 (Role set during creation):** The creation/invitation form allows attaching one primary role plus zero or more additional roles (each paired with a compatible scope: e.g. `accountant`/`general_manager` at company/business, `business_manager` at business, `branch_manager`/`cashier`/`staff` at selected branches).
- **FR-080-5 (Role catalog & server validation):** Role codes come exclusively from server-defined `platform_roles` (excluding `owner` and `device`), validated against a server-side allowed role-to-scope policy matrix (`.strict()` Zod contract). Duplicate `(user_id, role_code, scope)` pairs are rejected or deduplicated deterministically inside the write transaction.
- **FR-080-6 (Staff vs Back-office separation):** Selecting any back-office credential role (`general_manager`, `business_manager`, `branch_manager`, `accountant`) requires an email + password invitation/account (never a PIN-only synthetic `staff-*@staff.pospay.invalid` account); synthetic staff accounts stay limited to device-PIN roles per `076 D8` unless explicitly upgraded via a future dedicated owner flow.

### 2.3 Inline Permission Exceptions («استثناء صلاحية») (`PR-Q9-4`)

- **FR-080-7 (Inline overrides UI & mechanics):** During user/member creation in Admin, after selecting roles and scopes, the creator sees an expandable «استثناء صلاحية» panel (reusing the `spec 009` permission catalog, grouped by module, showing effective defaults from the chosen roles and allowing toggling `ALLOW` or `DENY` overrides before submitting).
- **FR-080-8 (Transactional override application):** Inline `ALLOW`/`DENY` overrides are written into the existing `permission_overrides` table inside the **same tenant creation transaction** via `identity` ports, enforcing every existing `system-role-policy.ts` rule (e.g., `manage:staff-access:branch` / `OWNER_DERIVED` / owner-only restrictions cannot be escalated by non-owners; a caller cannot grant a permission exception they are forbidden to grant under `ADR-0003` / `019`).
- **FR-080-9 (Audit & cache invalidation):** Every created membership and every applied `permission_overrides` row writes a structured `audit_log` entry in the same transaction (`actor`, target memberships, role codes, permission codes — never secrets/emails) and invalidates grant caches atomically after commit.

---

## 3. Open Design Questions (To Resolve Before Planning Implementation)

1. **`TQ-080-1` (Caller eligibility for multi-scope + inline exceptions):** Should inline «استثناء صلاحية» and multi-business/multi-branch assignment during creation be restricted to canonical `owner` (`manage:memberships:company` + override authority), or should a delegated `general_manager` / `business_manager` ever see a filtered subset? *(Recommended: `owner` only for `G1` multi-scope + inline overrides, aligned with `076 IM-Q1` and `spec 009`; branch/staff multi-branch follow-up confirmed separately.)*
2. **`TQ-080-2` (Effective combination when an employee works multiple branches with different roles, e.g., `cashier` in Branch A + `staff` in Branch B):** Confirm whether existing membership evaluator + POS branch selector (`076` personal/device routes & `/v1/me/workspaces`) already handle multiple active branch memberships for one `user_id` cleanly or whether `staff-access` unique constraints (`employee_staff_access.membership_id`) need expansion to a join table.
3. **`TQ-080-3` (Role ceiling for staff accounts on POS devices vs Admin login):** Confirm that a synthetic `staff-*@staff.pospay.invalid` user cannot receive `general_manager`/`accountant` (back-office email+TOTP roles) via «أدوار أكتر» without a real back-office email invitation.

---

## 4. Explicit Out-of-Scope / Constraints

- **No code changes until `spec 079` (`PR-b`, `PR-c1`, `PR-c2`) completes** and `TQ-080-1..3` are resolved with Waleed (and Abu Salem's decision-page response if applicable).
- **No parallel permission engine:** Must reuse `memberships`, `permission_overrides`, `system-role-policy.ts`, and existing `identity` evaluation rules (`ADR-0003` §4).
- **PP-273 PR size cap:** Split implementation cleanly into bounded PRs (`≤1,500` prod lines each, `≤1` migration per PR) when authoring the final execution `plan.md`.
