# ADR-0028 — Attendance serialization and operation challenges

Status: Accepted technical decision; product rules AT-Q1–AT-Q7 settled 2026-10-04 (owner decision, recommended options — spec 027).
Date: 2026-10-04. Scope: spec 027, Phase 1 PR 22.

## Context and decision

First scans and later jobs need the same always-existing employee lock. Personal
sessions establish identity; a separate fresh UV proof authorizes each clock operation.

AttendanceState is backfilled and inserted by an invoker employee-insert trigger,
using the employee UUID v7 as its id. This guarantees a lockable row even for the
first clock and future jobs without a FK-lock-before-state lazy insertion race.
The RLS migration locks employees against concurrent inserts until its backfill
and trigger installation commit together, including between separate migration files.
All attendance writers lock State first, then identity's company/ordered membership
locks, employee, active binding and branch. Binding locks fence future manager unbind.
The injected Clock is sampled exactly once after State and all eligibility-context
locks are acquired. Membership time windows are rechecked then, so a membership
expiring while waiting for company/employee/binding/branch cannot authorize a clock.

A fourth tenant table stores short-lived clock challenge metadata, not assertions.
It binds the server-resolved user/session/employee, operation and binding revision to
a digest of the QR and location. Clients resubmit the scan; the digest must match.
This permits independent concurrent challenges and dedupe after a different accepted
scan without trusting client-selected operation or persisting WebAuthn assertions.
Auth retains the actual challenge, single-use consumption and credential counters.
Restricted facade calls are injected by the existing application root.

Tenancy publishes attendanceBranch on the existing transaction for active branch
ownership, geo and timezone under a branch lock. Identity's existing personalMemberships
accepts an optional sampled instant; clock requests use that instant everywhere.
These are read ports, no cross-module business write. Add their declared map entries.
QR verification reuses PR 19's window/domain, daily-secret port and HMAC signer
with the branch timezone already locked in this transaction. It opens no second
tenant transaction, avoiding pool starvation when other scans wait for State.

Lateness is snapshotted on clock-in, preserving the schedule fact if it is later edited.
It has no commission consumer. AttendanceClockedIn/Out/MissedOut replace the obsolete
AttendanceClocked deduction arrow for this slice; no realtime consumer ships in Phase 1.
Challenge rows are append-only for now; later retention maintenance may purge expired
metadata in a separately approved slice. No new optional setting is added.

POS adds `jsqr@1.4.0` (exact pin) to decode camera frames locally across browsers,
including browsers without BarcodeDetector. Camera images never leave the browser;
capture stops before the passkey prompt. No external scanning service or second UI kit.

## Consequences

Employee inserts also create State in their transaction; app INSERT privilege on State
is required by the invoker trigger, and runtime callers cannot execute the trigger function
directly. One tenant transaction serializes attendance while auth separately consumes the
single-use assertion; rollback therefore requires a new assertion. Challenge metadata has
a future retention cost. Schedule facts remain stable when schedules are later edited;
owner-question defaults are explicitly provisional, without commission effects.
