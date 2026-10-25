# Feature Specification: List a branch's pending devices

**Feature Branch**: `feat/mob-pending-devices-read`

**Created**: 2026-10-25

**Status**: Draft. Decided by the orchestrator with the MOB manager (technical, no owner question): the M-1c iOS
simulator check needs it now, and issue #634 (the admin pairing screens) needs the same list later.

**Input**: A device asks to be paired with `POST /v1/devices/register` and waits as `PENDING` until a manager calls
`POST /v1/branches/{branchId}/devices/{deviceId}/approve`. That call needs the device id. Today no route lists pending
devices, and the back office has no approval screen, so the id can only be read from the database by hand. The M-1c
iOS check (spec 065, plan row M-1c (a)) runs unattended on a GitHub runner, so it must find the device it just
paired through the API.

**Scope.** One guarded read route. Out of scope: an approval screen in `apps/admin` (issue #634), listing active or
revoked devices, and any change to pairing, approval or claim.

## Requirements

- **FR-001** `GET /v1/branches/{branchId}/devices?status=pending` returns the branch's devices whose `status` is
  `PENDING`, newest first, as `{ items: [{ id, label, created_at }] }`: at most 50, a bounded list with no cursor,
  since a branch has a handful of devices waiting at a time.
- **FR-002** Guarded by `@Require('manage:devices:branch', { branch: 'branchId' })`, the same permission as approve
  and the pairing code. The company comes from `x-company-id` as on every tenant route.
- **FR-003** `status` is required and only `pending` is accepted for now; any other value, or none, is a 400
  `VALIDATION_FAILED`. A later slice may add `active` for #634.
- **FR-004** The response never carries the claim hash, token hash, fingerprint, app version or any approver id.
- **FR-005** A branch of another company, or of another business the caller cannot manage, returns what the guard
  returns today for approve (403), never another tenant's rows.

## Implementation notes

- Read path (`CLAUDE.md` §6): a `queries/` file in the `identity` module, its read interface beside it, a thin
  controller, wired in `identity.module.ts`. The query runs under `withTenant` and projects straight into the DTO.
- Index: the `(company_id, branch_id)` indexes (`devices_company_id_branch_id_idx`, and the unique
  `devices_company_branch_id_key` the planner picks) already serve the filter; no migration.
- Contract: a Zod schema in `packages/contracts` plus its OpenAPI path, regenerated into `openapi.json` and the two
  frontends' `schema.d.ts`.

## Tests

- Query: the result shape, newest first, only `PENDING` rows of that branch, the 50 cap, a cross-tenant read returns no
  rows (RLS), and an `EXPLAIN ANALYZE` assertion that uses one of those indexes, never a sequential scan.
- HTTP: 200 for a manager with `manage:devices:branch`, 403 without it, 400 for a missing or unknown `status`, and no
  forbidden field in the body.
