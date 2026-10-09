# docs/module-map.md — the declared dependency graph

> **This file is executable documentation.** A script compares the real import graph of
> `apps/api` and `apps/worker` against the tables below and **fails CI on any arrow that is
> not declared here** (`CLAUDE.md` §10, `CLAUDE.architecture.md` §10.3).
>
> Adding an arrow means editing this file, which means writing an ADR. That friction is the point.
>
> **Version:** M1.4 — 2026-10-05 (PR 23: staff clock-by-card reads one identity access helper and reuses employee-management access). M1.3 — 2026-10-04 (ADR-0031: staff reads files for employee documents). M1.2 — 2026-10-02 (ADR-0010). Derived from `06_Tech_Stack_Architecture_EN.md` §3.

---

## 1. There are three kinds of arrow — they are not interchangeable

| Kind       | What it looks like in code                                           | When to use it                                                                 | Cost                                                                                       |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **Import** | `import { X } from '../tenancy'` — the module's `index.ts` only      | Shared _types_ and NestJS module wiring. Almost always `import type`.          | Creates a hard compile-time edge. Keep these to a minimum.                                 |
| **Port**   | Consumer defines `ports/<x>.port.ts`; an adapter implements it       | "I need an answer **now**" — a price, a credit limit, a membership             | No compile-time edge between the two modules. The adapter is the only file that sees both. |
| **Event**  | Producer appends to `outbox`; consumer has `events/handlers/on-*.ts` | "This **happened**, react to it" — the default for anything that changes state | Zero coupling. The producer does not know the consumer exists.                             |

**Rule of thumb:** if you are about to add an Import arrow, check whether it is really a Port (a read) or an Event (a write). Nine times out of ten it is.

---

## 2. Import arrows (compile-time edges) — the complete allowed list

Anything not in this table is a CI failure. Every arrow points **down** this list — `tenancy` is the root and imports nothing.

| Module          | May import            | Why                                                                            |
| --------------- | --------------------- | ------------------------------------------------------------------------------ |
| `tenancy`       | —                     | Root. Company / business / branch / plans.                                     |
| `identity`      | `tenancy`             | A membership is scoped to a company/business/branch.                           |
| `settings`      | `tenancy`, `identity` | Per-business config; identity adapter reads only (ADR-0023). |
| `files`         | `tenancy`             | Storage keys are `{companyId}/{businessId}/…`.                                 |
| `platform`      | `tenancy`             | Super-admin over tenants.                                                      |
| `catalog`       | `tenancy`             |                                                                                |
| `customers`     | `tenancy`             |                                                                                |
| `expenses`      | `tenancy`             |                                                                                |
| `inventory`     | `tenancy`             |                                                                                |
| `staff`         | `tenancy`, `identity`, `files` | An employee may be linked to a user; a document binds a verified file (ADR-0031). |
| `realtime`      | `identity`            | Channel scope is resolved from the session.                                    |
| `notifications` | —                     | Deliberately root-level: it is a service, it knows nothing about the business. |
| `orders`        | `tenancy`             | Catalog and customer data arrive by **port**, not import (§3).                 |
| `payments`      | `tenancy`             | Order totals arrive by **port**.                                               |
| `cash`          | `identity`            | Payment tenders arrive by **port**.                                            |
| `appointments`  | `tenancy`             | Catalog / staff / customers arrive by **port**.                                |
| `commissions`   | `staff`               | Order data arrives by **event** only.                                          |
| `loyalty`       | `customers`           | Order data arrives by **event** only.                                          |
| `channels`      | `tenancy`             | Order and expense effects are **events**.                                      |
| `kitchen`       | —                     | Fed entirely by events from `orders`.                                          |
| `reporting`     | —                     | **Imports nothing.** Read-only SQL across contexts (§5).                       |

**Every module may import:** `packages/domain`, `packages/contracts`, `packages/db` (from `persistence/` and `queries/` only), `packages/observability`.
**Only the owning module may import:** `packages/auth` (→ `identity`), `packages/payments` (→ `payments`), `packages/storage` (→ `files`), `packages/notifications` (→ `notifications`), `packages/documents` (→ `reporting`, `worker` jobs).

Application composition roots (`apps/api/src/{app,main}.ts`, `apps/worker/src/{main,worker}.ts`) may wire
notifications and restricted auth facades for ADR-0019 staff OTP. This is wiring
only: identity/staff/customers still cannot import `packages/notifications`; worker notifications owns the adapter.
The platform phone-binding CLI root (`apps/api/scripts/bind-phone.ts`) injects the public phone-lock strategy into the audited auth facade; auth itself imports no notifications implementation.

ADR-0013 Part A: notification persistence alone uses the restricted global messaging DB facade
for intake, inbox maintenance and manual additions. API/worker main roots create that facade;
all other modules/packages are forbidden. Authorization uses the boolean function on its existing Tx.
ADR-0019 auth uses createStaffOtpDatabase only inside packages/auth; application code may not import that facade, including alias/namespace/re-export forms. API identity outer Redis/BullMQ adapters implement auth-owned OtpRates/OtpSender, binding id-only transport at the API root. Worker notifications defines OtpExecution and receives the narrow auth execution facade at the worker root; its OTP adapter owns transient rendering/Channel. These auth transport/ledger capabilities are separate from business cross-module writes: no tenant event, new dispatcher privilege or auth-internal import is permitted.

This adds no tenant exception, business import/write arrow, notifications → identity or staff → notifications.

---

## 3. Port arrows (runtime reads, no compile-time edge)

ADR-0020 attendance QR reads the paired branch name and effective timezone through the existing tenancy
`describeWorkspaces` surface; staff owns the read port. It adds no attendance write or clocking endpoint.

PR 4b personal inbox/bell uses event-supplied user recipients and session/company/recipient authorization
(ADR-0018 §6). In-app storage/results stay inside the notification consumer transaction; no new import,
port or event arrow. The admin composes its notification business area in `app/(dashboard)/_frame`.

The consumer owns the interface. The adapter lives in the consumer's `persistence/` folder and is the **only** file that knows both modules exist. This is what keeps the graph acyclic (`CLAUDE.architecture.md` §6.2).

| Consumer                            | Port it defines                                                                         | Reads from  | What it needs                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders`                            | `CatalogReaderPort`                                                                     | `catalog`   | price for item × branch × channel, item name snapshot, tax rule id; Phase 1 adds: service names, commission rule, threshold flag, package-type components (ADR-0010) |
| `orders`                            | `CustomerCreditPort`                                                                    | `customers` | credit limit, current balance, block status                                                                                                                          |
| `payments`                          | `OrderTotalsPort`                                                                       | `orders`    | order total + currency to charge                                                                                                                                     |
| `cash`                              | `ShiftPaymentsPort`                                                                     | `payments`  | tenders belonging to a shift, incl. `PENDING_GATEWAY` ones                                                                                                           |
| `appointments`                      | `ServiceCatalogPort`                                                                    | `catalog`   | service duration, resource type, requires-staff flag                                                                                                                 |
| `appointments`                      | `StaffAvailabilityPort`                                                                 | `staff`     | schedule + leave for a resource                                                                                                                                      |
| `commissions`                       | `EmployeePlanPort` — retired in Phase 1: plan versions live in `commissions` (ADR-0010) | `staff`     | the employee's active commission plan                                                                                                                                |
| `channels`                          | `ChannelFeePort`                                                                        | `expenses`  | how an aggregator commission is booked                                                                                                                               |
| `realtime`                          | `ChannelScopePort`                                                                      | `identity`  | which channels this session may subscribe to                                                                                                                         |
| `staff` | `PersonalMemberships` | `identity` | active membership read and locked recheck; no grants in a personal session (ADR-0027) |
| `staff` | `EmployeeCreationScope` | `identity` | locked employee-management access and active company membership eligibility for user links (ADR-0021, PR #79) |
| `settings` | `BusinessDiscountAccess`, `DiscountSubjectReader` | `identity` | locked discount-management authority and scoped personal limit/active owner metadata (ADR-0023) |
| `settings` | `DiscountSubjectReader` | `tenancy` | business and branch scope confirmed before identity membership read (ADR-0023) |
| `staff` | `EmployeeDetailAccess` (read-side interface beside the query) | `identity` | effective grants at the persisted business/primary branch and staff feature; never global user existence (ADR-0021, PR #79) |
| `staff` | `ScheduleScope`, `ScheduleReadAccess` | `identity` | schedule permissions and staff feature; writes retain company and ordered membership locks (ADR-0024) |
| `staff` | `ScheduleScope`, `ScheduleReadAccess` | `tenancy` | branch ownership and effective timezone through describeWorkspaces, using PR 19 fallback (ADR-0024) |
| `orders`                            | `CustomerLookupPort`                                                                    | `customers` | `exists(customerId)` — reception finds or creates the customer first through `customers`' own endpoint (ADR-0010)                                                    |
| `orders`                            | `PerformerCheckPort`                                                                    | `staff`     | employee active and attached to the branch on the date (ADR-0010)                                                                                                    |
| `commissions`                       | `EmployeeDirectoryPort`                                                                 | `staff`     | employee names — statements, live estimate (ADR-0010)                                                                                                                |
| `customers`                         | `PerformerNamePort`                                                                     | `staff`     | performer's first name, in the rating message (ADR-0010)                                                                                                             |
| `customers`                         | `DaySessionsPort`                                                                       | `orders`    | the customer's active lines and performers for a business day — read at claim time, the authoritative boundary for rating attribution (ADR-0010)                     |
| `staff` | `EmployeeDocumentScope.file` | `files` | a READY file uploaded by the recorder for this employee and business, read in the same tenant transaction; staff keeps the verified key only (ADR-0031) |
| `staff` | `EmployeeDocumentReadAccess`, document-type authority | `identity`, `tenancy` | locked read/manage files and manage:document-types:company; business timezone for the expiry badge (ADR-0031) |
| worker `staff` | `DocumentExpiryTransactions.timeZone` | worker `tenancy` | business timezone for the expiry window, reusing ADR-0031's staff-to-tenancy read; discovery stays on outbox delivery (ADR-0032) |
| worker `staff` | `BranchManagerRecipients.forBranch` | worker `identity` | active system-role managers whose scope covers the shift branch, at the injected instant; caller checks company eligibility through tenancy (ADR-0037); PR 62 does not remove this read |
| worker `staff` | `BranchManagerRecipients.companyOpen` | worker `tenancy` | company eligibility before candidate paging and again under the employee lock, on the caller's tenant transaction (ADR-0037) |
| worker `staff` | `BranchPlaceReader` | worker `tenancy` | both branch names and the effective timezone (branch, otherwise business) on the caller's tenant transaction; adapter bound at the staff composition root (ADR-0037) |
| `staff`, `customers`, `commissions` | `AlertRulesPort`, `StaffColumnsPort`                                                    | `settings`  | alert rules (recipients, channels) and staff-app columns — reads (ADR-0010)                                                                                          |

### 3.1 The one synchronous cross-module write (ADR-0003 §5.3)

| Consumer   | Port it defines   | Writes to                                                       | Why not an event                                                                                                                             |
| ---------- | ----------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity` | `CompanyRegistry` | `tenancy` (`registerCompany`, exported from `tenancy/index.ts`) | `onboard-company` creates the company and its first owner membership in one transaction; a company without an owner must never be observable |

No other port may write. A second synchronous write needs its own ADR and a row here.

> `payments → orders` and `orders → catalog` exist as ports in **both directions of the list** without creating a cycle, because neither module imports the other — the adapters do. If a new port would create a cycle **between adapters**, use an event instead.

---

PR 20 (ADR-0013 §9, ADR-0027) injects the auth-owned restricted passkey facade at
`apps/api/src/app.ts` into staff's registration/attendance verification port. It changes only
identity challenge/credential counters; staff owns the binding, audit and outbox. Staff never
imports auth. Personal-session eligibility comes from staff's exported reader, using the identity
membership read port, and runs again on every request. No business permission is attached.
The main root also injects staff's active-binding reader into auth for registration exclusions.
Identity lists the verified user's membership company ids with `withUser`; staff reads bindings
inside each `withTenant` and supplies only opaque passkey ids. Auth reads no tenant table and
retains inert orphan credentials without excluding them or implicitly activating them.

PR 23 card clocking reads the operator's `clock:attendance:branch` grant through identity's
existing access reader, and card issue/revoke reuse identity's employee-management read/lock
helpers. Staff owns the card domain, persistence, endpoints and audit; no new import arrow and
no event consumer is added.

PR 33 package types remain catalog-owned master data. Creation and full replacement publish no event;
orders will read their components through the existing CatalogReaderPort at sale (ADR-0010).
Catalog and orders own separate definition validators (spec 037 TD-1, ADR-0035 precedent), checked
against the data-only cases in `apps/api/test/package-definition-cases.ts`; no new import arrow.

## 4. Event arrows (the default for state changes)

The producer appends to the outbox inside its own transaction and knows **none** of its consumers. Adding a consumer changes zero lines in the producer.

| Event                                                                       | Produced by     | Consumed by                                                                                       |
| --------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `OrderCreated`                                                              | `orders`        | `kitchen`, `realtime`, `channels`                                                                 |
| `OrderCompleted`                                                            | `orders`        | `inventory` (deduct), `commissions` (entries), `loyalty` (points), `realtime`                     |
| `OrderCancelled`                                                            | `orders`        | `inventory`, `commissions` (reverse), `kitchen`, `realtime`                                       |
| `ServiceCompleted` — replaced in Phase 1 by `ServiceLineChanged` (ADR-0010) | `orders`        | `commissions`, `appointments`                                                                     |
| `ReturnPosted`                                                              | `orders`        | `inventory`, `commissions` (negative entries), `loyalty`                                          |
| `PaymentCaptured`                                                           | `payments`      | `orders` (status), `cash` (tender), `loyalty`, `realtime`                                         |
| `PaymentRefunded`                                                           | `payments`      | `orders`, `cash`, `commissions`                                                                   |
| `PaymentFailed`                                                             | `payments`      | `orders`, `realtime`, `notifications`                                                             |
| `CashShiftClosed`                                                           | `cash`          | `reporting`, `notifications` (manager summary)                                                    |
| `AttendanceClockedIn` / `AttendanceClockedOut` / `AttendanceMissedOut` (ADR-0028) | `staff` (API scan; worker missed-out job also emits `AttendanceMissedOut`, ADR-0032) | No business consumer; attendance never changes commission. Worker `staff` upserts the company's missed-out and not-clocked-in schedules on `AttendanceClockedIn` delivery (ADR-0032/0037) |
| `AppointmentBooked`                                                         | `appointments`  | `notifications` (reminder schedule), `realtime`                                                   |
| `AppointmentCompleted`                                                      | `appointments`  | `orders`, `commissions`                                                                           |
| `StockPosted`                                                               | `inventory`     | `reporting`, `notifications` (low-stock alert), `realtime`                                        |
| `DeviceRegistered` / `DeviceRevoked`                                        | `identity`      | `realtime`, `notifications`                                                                       |
| `GatewayAccountConnected`                                                   | `payments`      | `notifications`, `platform`                                                                       |
| `NotificationDelivered` / `NotificationFailed`                              | `notifications` | `reporting`                                                                                       |
| `NotificationSendAuthorized` (internal, ADR-0018)                           | `notifications` | worker transport publisher → `notifications-send` BullMQ queue, outside database-effect consumers |
| `DocumentReady`                                                             | `reporting`     | `notifications`, `realtime`                                                                       |
| `SalaryChanged` | `staff` | No consumer yet; known to the dispatcher. PR 50 will register `commissions.project-inputs` and backfill previously published rows (ADR-0012 amendment, Waleed 2026-10-08); publication alone never satisfies commission approval |
| `LeaveRequested` / `LeaveCancelled` / `LeaveApproved` / `LeaveRejected` / `LeaveRevoked` | `staff` | No consumer yet; known to the dispatcher. Phase 1 leave screens poll; PR 26 does not read leave (CA-Q13); staff in-app delivery remains deferred by DL-Q3 in spec 025 |
| `EmployeePasskeyBound` | `staff` | None in Phase 1; known to the dispatcher, binding history is read directly under the polling exception (ADR-0029) |
| `EmployeePasskeyUnbound`                                                    | `staff`         | None in Phase 1; known to the dispatcher, admin polls binding history (ADR-0029)                     |
| `EmployeeDocumentRecorded` | `staff` | No business consumer. Worker `staff` registers the company's document-expiry schedule on delivery (PR 15, ADR-0032 pattern); the job reads `expires_on` and `alert_days` from the tables (ADR-0031) |
| `EmployeeImported` | `staff` | None in Phase 1; known to the dispatcher (ADR-0034) |
| `EmployeeImportCommitRequested` | `staff` | `staff` worker registers per-company employee-import-recovery sweep (PR 24 / ADR-0022 discovery), then transports employee-import-commit after outbox claim commits (ADR-0034, ADR-0018) |
| `ImportCommitted` | `staff` | None in Phase 1; known to the dispatcher (ADR-0034) |
| `CompanyCreated` | `identity` | `staff` (worker seeds the recommended document types, ADR-0031, and registers the not-clocked-in schedule, ADR-0037) |
| `ServiceLineChanged`                                                        | `orders`        | `commissions`, `customers`                                                                        |
| `PackageSaleChanged`                                                        | `orders`        | `commissions`                                                                                     |
| `SessionTipsChanged`                                                        | `orders`        | `commissions`                                                                                     |
| `RatingRequestReady`                                                        | `customers`     | `notifications`                                                                                   |
| `LowRatingReceived`                                                         | `customers`     | `notifications`                                                                                   |
| `AttendanceExceptionRaised`                                                 | `staff` (worker missed-out job, ADR-0032) | `notifications` (no recipients until alert rules ship)                                            |
| `ShiftNotClockedIn` | `staff` (worker not-clocked-in job, ADR-0037) | `notifications` (in-app managers by the interim rule; PR 62 replaces the rule) |
| `DocumentExpiring`                                                          | `staff`         | `notifications`                                                                                   |
| `StatementAwaitingReview`                                                   | `commissions`   | `notifications`                                                                                   |
| `StatementAwaitingApproval`                                                 | `commissions`   | `notifications`                                                                                   |

**Two consumers by default.** Every event has its business handler **and** the `realtime` publisher (`06` §5.10). That is what guarantees a screen never shows something that didn't actually commit.

> The Phase 1 rows (ADR-0010) are the exception: realtime is out of scope this phase — screens poll (the PRD's Phase 1 exception, closed by P2-T8) — so they list their business consumers only, and the `realtime` publisher joins them when it ships. Payload identities and per-row `revision` convergence live in ADR-0010 and SPEC §3.

PR #128 recovery migration re-queues only unpublished `SalaryChanged`, `LeaveRequested`, `LeaveCancelled`, `LeaveApproved`, `LeaveRejected`, `LeaveRevoked` and `EmployeePasskeyBound` rows that are parked or have attempts >= 10 (the dispatcher's default maximum), including rows whose final claim lease is still held. It resets retries and the lease so known events publish without effects and release later events for the same aggregate.

**Consumers are idempotent**, deduped by `event_id`. Redelivery is harmless, and replay is a supported recovery tool.

---

## 5. The `reporting` exception

`modules/reporting/queries/sql/*.sql` is the **only** place allowed to join across bounded contexts (orders × staff × inventory in one statement).

This is a deliberate trade, fenced into one folder so the cost stays visible (`CLAUDE.architecture.md` §7.3):

- It is what makes the owner dashboard fast.
- It is also the thing that would have to be rebuilt as a separate read database if the monolith is ever split.

Rules for that folder: read-only, never writes, imports no module, and every file has an `EXPLAIN ANALYZE` test plus its indexes documented in `docs/reporting-queries.md`.

---

## 6. Machine-readable source (what the CI script reads)

<!-- prettier-ignore -->
```yaml
# docs/module-map.yaml — keep in sync with the tables above; the script reads THIS.
imports:
  tenancy: []
  notifications: []
  kitchen: []
  reporting: []
  identity: [tenancy]
  settings: [tenancy, identity]
  files: [tenancy]
  platform: [tenancy]
  catalog: [tenancy]
  customers: [tenancy]
  expenses: [tenancy]
  inventory: [tenancy]
  orders: [tenancy]
  payments: [tenancy]
  appointments: [tenancy]
  channels: [tenancy]
  staff: [tenancy, identity, files]
  realtime: [identity]
  cash: [identity]
  commissions: [staff]
  loyalty: [customers]

packages_restricted:
  auth: [identity]
  payments: [payments]
  storage: [files]
  notifications: [notifications]
  documents: [reporting]

# Application composition roots may wire restricted packages (ADR-0018); never a business-module permission.
composition_roots:
  auth: [apps/api/src/app.ts, apps/api/src/main.ts, apps/worker/src/main.ts, apps/worker/src/worker.ts]
  staff-otp-db: [packages/auth/src/staff-otp/api.ts, packages/auth/src/staff-otp/execution.ts, packages/auth/src/config.ts, packages/auth/src/personal-sessions.ts, packages/auth/src/approve-phone-binding.ts]
  platform-whatsapp-db: [apps/api/src/main.ts, apps/worker/src/main.ts]
  notifications: [apps/api/src/app.ts, apps/api/src/main.ts, apps/api/scripts/bind-phone.ts, apps/worker/src/main.ts, apps/worker/src/worker.ts]

# Every VALUE a module imports from another module's index.ts is one of these (type-only imports need only the
# arrow above). §3.1: the one synchronous write. A read port's adapter calling another module's exported read is
# added under reads, one line per symbol, in the PR that introduces it.
sync_writes:
  - identity -> tenancy.registerCompany @ apps/api/src/modules/identity/persistence/tenancy-company-registry.adapter.ts
reads:
  - staff -> identity.personalMemberships @ apps/api/src/modules/staff/persistence/attendance-context.adapter.ts
  - staff -> tenancy.attendanceBranch @ apps/api/src/modules/staff/persistence/attendance-context.adapter.ts
  - staff -> identity.lockPasskeyAccess @ apps/api/src/modules/staff/persistence/manager-passkey-access.adapter.ts
  - staff -> identity.readPasskeyAccess @ apps/api/src/modules/staff/persistence/manager-passkey-access.adapter.ts
  - staff -> tenancy.describeWorkspaces @ apps/api/src/modules/staff/persistence/manager-passkey-access.adapter.ts
  - staff -> identity.lockLeaveAccess @ apps/api/src/modules/staff/persistence/leave-context.adapter.ts
  - staff -> identity.readLeaveAccess @ apps/api/src/modules/staff/persistence/leave-context.adapter.ts
  - staff -> identity.lockAttendanceExceptionAccess @ apps/api/src/modules/staff/persistence/attendance-exception-context.adapter.ts
  - staff -> identity.readAttendanceExceptionAccess @ apps/api/src/modules/staff/persistence/attendance-exception-context.adapter.ts
  - staff -> identity.lockAttendanceExceptionAccess @ apps/api/src/modules/staff/persistence/attendance-correction-context.adapter.ts
  - staff -> identity.readAttendanceCorrectionAccess @ apps/api/src/modules/staff/persistence/attendance-correction-context.adapter.ts
  - staff -> tenancy.describeWorkspaces @ apps/api/src/modules/staff/persistence/leave-context.adapter.ts
  - staff -> identity.personalMemberships @ apps/api/src/modules/staff/persistence/personal-employee.ts
  - staff -> tenancy.describeWorkspaces @ apps/api/src/modules/staff/persistence/personal-employee.ts
  - staff -> identity.scheduleAccess @ apps/api/src/modules/staff/persistence/schedule-context.adapter.ts
  - staff -> tenancy.describeWorkspaces @ apps/api/src/modules/staff/persistence/schedule-context.adapter.ts
  - staff -> identity.lockEmployeeSalaryAccess @ apps/api/src/modules/staff/persistence/employee-salary-access.adapter.ts
  - staff -> identity.readEmployeeSalaryAccess @ apps/api/src/modules/staff/persistence/employee-salary-access.adapter.ts
  - staff -> identity.lockEmployeeSalaryAccess @ apps/api/src/modules/staff/persistence/employee-iban-access.adapter.ts
  - staff -> identity.readEmployeeSalaryAccess @ apps/api/src/modules/staff/persistence/employee-iban-access.adapter.ts
  - staff -> identity.readEmployeeBranchAccess @ apps/api/src/modules/staff/persistence/employee-iban-access.adapter.ts
  - settings -> identity.lockBusinessDiscountAccess @ apps/api/src/modules/settings/persistence/business-discount-access.adapter.ts
  - settings -> identity.readBusinessDiscountAccess @ apps/api/src/modules/settings/persistence/business-discount-access.adapter.ts
  - settings -> identity.lockMembershipDiscountSubject @ apps/api/src/modules/settings/persistence/discount-subject-reader.adapter.ts
  - settings -> identity.readMembershipDiscountSubject @ apps/api/src/modules/settings/persistence/discount-subject-reader.adapter.ts
  - settings -> tenancy.businessDiscountScope @ apps/api/src/modules/settings/persistence/discount-subject-reader.adapter.ts
  - staff -> tenancy.describeWorkspaces @ apps/api/src/modules/staff/persistence/employee-detail-access.adapter.ts
  - staff -> identity.readEmployeeBranchAccess @ apps/api/src/modules/staff/persistence/employee-context.adapter.ts
  - staff -> identity.readEmployeeBranchAccess @ apps/api/src/modules/staff/persistence/employee-detail-access.adapter.ts
  - staff -> tenancy.employeeWorkplace @ apps/api/src/modules/staff/persistence/employee-context.adapter.ts
  - staff -> identity.lockEmployeeCreationAccess @ apps/api/src/modules/staff/persistence/employee-context.adapter.ts
  - staff -> identity.employeeUserLinkAvailable @ apps/api/src/modules/staff/persistence/employee-context.adapter.ts
  - staff -> identity.readEmployeeDetailAccess @ apps/api/src/modules/staff/persistence/employee-detail-access.adapter.ts
  - identity -> tenancy.describeWorkspaces @ apps/api/src/modules/identity/persistence/workspace-names.adapter.ts
  - staff -> tenancy.describeWorkspaces @ apps/api/src/modules/staff/persistence/tenancy-attendance-branch.adapter.ts
  - staff -> identity.lockDocumentAccess @ apps/api/src/modules/staff/persistence/document-access.adapter.ts
  - staff -> identity.readDocumentAccess @ apps/api/src/modules/staff/persistence/document-access.adapter.ts
  - staff -> tenancy.businessTimeZone @ apps/api/src/modules/staff/persistence/document-access.adapter.ts
  - staff -> files.documentFileFacts @ apps/api/src/modules/staff/persistence/document-files.adapter.ts
  - staff -> files.documentFileFacts @ apps/api/src/modules/staff/persistence/drizzle-employee-import.ts
  - staff -> identity.readEmployeeManagementAccess @ apps/api/src/modules/staff/persistence/drizzle-employee-import.ts
  - staff -> identity.lockEmployeeManagementAccess @ apps/api/src/modules/staff/persistence/drizzle-employee-import.ts
  - staff -> tenancy.describeWorkspaces @ apps/api/src/modules/staff/persistence/drizzle-employee-import.ts
  - staff -> tenancy.employeeImportBranches @ apps/worker/src/modules/staff/persistence/employee-import.transactions.ts
  - staff -> identity.readAttendanceDeviceAccess @ apps/api/src/modules/staff/persistence/attendance-context.adapter.ts
  - staff -> identity.lockAttendanceDeviceContext @ apps/api/src/modules/staff/persistence/attendance-context.adapter.ts
  - staff -> identity.fenceOperatorSession @ apps/api/src/modules/staff/persistence/card-clock-transactions.ts
  - staff -> identity.staffSessionBinding @ apps/api/src/modules/staff/http/operator-sessions.token.ts
  - staff -> identity.readEmployeeBranchAccess @ apps/api/src/modules/staff/persistence/employee-card-access.adapter.ts
  - staff -> identity.lockEmployeeManagementAccess @ apps/api/src/modules/staff/persistence/employee-card-access.adapter.ts
  - staff -> tenancy.businessTimeZone @ apps/worker/src/modules/staff/persistence/document-expiry.transactions.ts
  - staff -> tenancy.branchPlace @ apps/worker/src/modules/staff/persistence/branch-place.adapter.ts
  - staff -> identity.branchManagerRecipients @ apps/worker/src/modules/staff/persistence/branch-manager-recipients.adapter.ts
  - staff -> tenancy.companyOpen @ apps/worker/src/modules/staff/persistence/branch-manager-recipients.adapter.ts
  - staff -> identity.branchManagerRecipientsStatement @ apps/worker/src/modules/staff/persistence/branch-manager-recipients.adapter.ts
```

The check (`pnpm module-map:check`, plan v4 T12b): `docs/module-map.yaml` is generated from this block and must be
current; for every `import` between `modules/*`, the target is the module's `index.ts` **and** the edge appears in
`imports`; every value (not type-only) import across modules is a `sync_writes` or `reads` entry for exactly that
file; a `packages_restricted` package is imported only by its owners; and the graph of imports actually used is
acyclic.

---

## 7. How to change this file

1. Try a **port** first. Try an **event** second. An import arrow is the last resort.
2. If it must be an import, write `docs/adr/NNNN-<title>.md`: what needed the arrow, why a port or event could not serve, and what future extraction of these modules now costs.
3. Update the table **and** the YAML in the same PR.
4. Re-run `pnpm lint:cycles` — an added arrow is the most common way a cycle appears.
