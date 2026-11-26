# Implementation Plan (Draft): `spec 080` — Multi-Scope Memberships, Additional Roles & Inline Permission Overrides (`PR-Q9`)

**Date:** 2026-11-26  
**Spec:** [`spec.md`](./spec.md) · **Owner Decisions:** [`owner-questions.ar.md`](./owner-questions.ar.md)  
**Status:** Draft held on `main` (docs only — opens sequentially **after** `spec 079` `PR-b`, `PR-c1`, `PR-c2` finish and `TQ-080-1..3` are answered).

---

## 1. Planned Scope Split (Target `≤1,500` Prod Lines per PR, `PP-273`)

1. **`080-a` — Multi-Branch, Multi-Business & Additional Roles for Back-Office Member Invitations (`G1` Extension):**
   - Contracts (`@pospay/contracts`): extend member invitation creation payload cleanly (via new v2 or backward-compatible schema) to accept an array of `{ role_code, scope_kind, scope_id }` entries and an optional array of `{ permission_code, effect: 'ALLOW' | 'DENY', scope }`, `.strict()`.
   - Domain & `identity` use case: validate server role-to-scope rules, caller `owner` authority, target company ownership of every `business_id` and `branch_id`, and `system-role-policy.ts` permission override rules; persist `member_invitations` + memberships + `permission_overrides` + audit atomically.
   - Admin UI (`apps/admin`): multi-branch / multi-business picker, extra-roles builder, and reusable inline «استثناء صلاحية» accordion inside the Invite Member flow (`packages/i18n`, `packages/ui`, logical RTL CSS).
2. **`080-b` — Multi-Branch & Allowed Extra Roles for Employee Profiles / Staff Access (`F1` Extension):**
   - Schema / migration evaluation: inspect `employees.primary_branch_id`, `employee_staff_access.membership_id`, and `attendance` / `commissions` assumptions before touching any table (keep 1 primary branch vs secondary assigned branches via join/membership model).
   - Admin UI (`apps/admin`): expose multi-branch / extra-role selector on employee management while respecting `076 D8` synthetic account isolation.

---

## 2. Pre-Implementation Gates

1. Wait until `spec 079` (`PR-b`, `PR-c1`, `PR-c2`) is merged on `origin/main`.
2. Resolve `TQ-080-1..3` with Waleed (and check Abu Salem's response on the `PR-Q9` decisions-page batch).
3. Perform full codebase investigation (DB constraints on `employee_staff_access`, `memberships` unique indexes, `permission_overrides` policy guards, `POS` multi-branch switcher behavior) and run a multi-model plan review before creating any feature branch or migration.
