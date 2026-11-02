# Plan 57-1 — own access and the reception-device private view (spec 060 §A.5)

Spec 060 §A.5 row **57-1** is delivered as three PRs, one use case each (`CLAUDE.md` §1; the project manager approved
the split on 2026-11-01):

| PR | Result | Migration | Depends on |
|---|---|---|---|
| **57-1a** | The four own codes of D-A4 with their defaults, catalog, names and inventory tests; the ADR-0027 addendum of D-A5 | yes | 42-2 merged first (it edits the same catalog files) |
| **57-1b** | The auth-owned private-view window store of the ADR-0019 addendum of 2026-10-21 (this plan's design) | no | — |
| **57-1c** | The API: the identity PIN step-up use case, the open, touch and close routes, the `SessionGuard` private-view marker (FR-A06b), `PRIVATE_VIEW_EXPIRED`, contracts and OpenAPI, tests MY-09…MY-12 and MY-13b | no | 57-1b |

57-1b does not need 57-1a: the window is bound to the session, the operator and the device, never to a permission code.

## 57-1b design

Advice from the two design advisors (Codex astra 6 and Claude Fable 5.1, 2026-11-01), reconciled by the orchestrator.
Where the ADR-0019 addendum of 2026-10-21 decides a point, it is cited, not repeated.

### 1. The PIN proof

- Auth mints the proof where the PIN is compared. `privateView.provePin({ pin, hash, scope })` runs `verifyCashierPin`
  itself. On a match it returns a `PrivateViewProof`, and on a mismatch it returns `null`. The proof carries
  `verifiedAt` from the injected Clock and the frozen scope `{ sessionId, userId, deviceId }`.
- The proof copies the `AttendanceProof` pattern in `passkeys.ts`. It is a brand on a module-private `unique symbol`,
  and its state lives in a module-private `WeakMap`. A cast, a copy or a hand-built object therefore fails the check at
  run time. Only the type is exported.
- The identity module (57-1c) keeps what it owns today in `sign-in-staff-pin`:
  - it reserves the Redis PIN attempt and records it as failed or succeeded;
  - it reads the tenant hash for the session's own user under `withTenant`, never for an employee the client names;
  - it writes the actor audit.
  On a refusal it drops the proof and never calls `open`.
- `open` consumes the proof synchronously before its first `await`, and a failed opening never restores it. The age
  rule `0 ≤ now − verifiedAt ≤ 60 000 ms` is checked again under the session-row lock. A proof whose scope differs
  from the opening's session, user or device opens nothing. The proof lives inside one server request: it never
  crosses HTTP and is never persisted.
- The PBKDF2 compare never runs inside the session-row lock.

### 2. Storage in `verification`

ADR item 3 decides the table: no migration and no grant. `pospay_auth` already holds full DML on `verification` and
`UPDATE` on `session` (migration 0008).

- **The identifiers belong to `packages/db`.** A new module `packages/db/src/staff-private-view.ts` builds them and
  holds the one shared delete. It is used by `otpRotate` and `otpApprovePhone` and exported to `packages/auth`, so the
  identifier format has one owner and no `db → auth` import appears.
  - Window: `staff-private-view:v1:<sessionId>`.
  - Counter: `staff-private-view-seq:v1:<sessionId>`.
- **The window row.**
  - `value` is JSON `{ window_id, window_seq, user_id, device_id }`.
  - `created_at` is `opened_at`, `updated_at` is `last_activity_at`, and `expires_at` is `opened_at` + 300 000 ms.
  - All three are written explicitly from the one Clock sample. Database defaults (`now()`) are never relied on.
- **The counter row.**
  - `value` is the decimal text of a `bigint`, and `expires_at` is the session's absolute deadline.
  - It survives a window close. Only the end or the replacement of the session deletes it.
- **Parameterized SQL only.** Every statement uses the Drizzle `sql` tag through `database.db.execute`. None builds a
  string the way `staff-session-fence.ts` does. The bounds come from the request's single Clock sample `now`, computed
  in TypeScript as `idleFloor = now − 60 s` and `capFloor = now − 5 min` and passed as parameters. SQL never calls
  `now()` and does no interval arithmetic.
- **The check is one statement.** It matches the identifier, `window_id`, `user_id` and `device_id`, requires
  `updated_at >= idleFloor`, `created_at >= capFloor` and `created_at <= now` (a future timestamp never passes), and
  requires the bound session to still be the live one (ADR item 6):

  ```sql
  UPDATE verification SET updated_at = $now
  WHERE identifier = $windowIdentifier
    AND value::jsonb->>'window_id' = $windowId
    AND value::jsonb->>'user_id' = $userId
    AND value::jsonb->>'device_id' = $deviceId
    AND updated_at >= $idleFloor AND created_at >= $capFloor AND created_at <= $now
    AND EXISTS (SELECT 1 FROM session s
                WHERE s.id = $sessionId::uuid AND s.user_id = $userId::uuid
                  AND s.purpose = 'STAFF_POS' AND s.staff_absolute_deadline > $now)
  RETURNING created_at
  ```

- **The remaining times** come from the same sample: `capRemainingMs = 300 000 − (now − created_at)` and
  `idleRemainingMs = min(60 000, capRemainingMs)`. The idle time never runs past the 5-minute cap.

### 3. Locking

- **Opening.** One `pospay_auth` transaction runs, in this order:
  1. `SELECT … FROM session WHERE id = $sessionId FOR UPDATE`;
  2. it refuses when the row is gone, when `purpose ≠ 'STAFF_POS'`, when `user_id` differs from the proof, when the
     device context is not the proof's device (reuse `sameDevice` from `staff-otp/policy.ts`), or when
     `deadline ≤ now`;
  3. it upserts the counter to +1;
  4. it deletes the window by its identifier;
  5. it inserts the new window and commits.

  The opening never takes the device advisory lock.
- **Sign-out and replacement.** They keep their order: the device advisory lock, then `DELETE session … RETURNING id`
  (which row-locks the same session row), then the delete of both identifiers for each removed id, all in the same
  transaction. The lock order is therefore advisory lock, then session row, then `verification`, so no cycle can form.
  An opening that waited on the row lock finds no row after the commit and refuses.
- **Functions that change.**
  - `retireStaffSession`;
  - the `STAFF_POS` branch of `deleteStaffSessionRow` (`staff-session-fence.ts`);
  - `otpRotate`;
  - `otpApprovePhone` (`packages/db/src/staff-otp-database.ts`), which also deletes `STAFF_POS` sessions although the
    ADR does not name it.

  Waiting for expiry alone is not faithful to ADR items 3 and 6.

### 4. Results

The functions return discriminated results, as `SignOutOutcome` does:

- **`open`** returns `{ kind: 'opened', windowId, windowSeq, sessionRef, idleRemainingMs, capRemainingMs }` or
  `{ kind: 'refused', reason: 'proof' | 'session' }`. `windowSeq` is decimal text, and `sessionRef` is the session row
  id.
- **`check`** returns `{ kind: 'passed', idleRemainingMs, capRemainingMs }`, `{ kind: 'expired' }` or
  `{ kind: 'mismatch' }`. When the update matches no row, a conditional delete runs:

  ```sql
  DELETE … WHERE identifier = $w AND value::jsonb->>'window_id' = $wid
    AND value::jsonb->>'user_id' = $userId AND value::jsonb->>'device_id' = $deviceId
    AND (updated_at < $idleFloor OR created_at < $capFloor) RETURNING id
  ```

  A deleted row means `expired`, and no row means `mismatch`. A missing or different `window_id` changes nothing, and
  the `window_id` match makes a late delete safe. The user and device predicates keep a wrong-scope check a `mismatch`
  that deletes nothing, even when the window has expired. The touch of ADR item 5 is this same `check`.
- **`close(scope, windowId)`** returns a boolean. Its delete is conditional on the session's identifier and the
  `window_id`.
- **Not here.** There is no background sweep. Past its limits, an expired window row is inert. No check passes it,
  and the next opening replaces it. Sign-out, rotation and phone approval delete both rows. A session that just runs
  out at its deadline leaves its two rows behind; the sweep for those goes with session-row retention (#776). A dead
  session is answered 401 by the guard before any check (57-1c), and a session that dies between the guard and the
  check simply fails the `EXISTS`.

### 5. Entropy, Clock and wiring

- **Entropy.** `AuthOptions` gains an optional `entropy?: { bytes(n: number): Uint8Array }`, defaulting to
  `node:crypto` `randomBytes`, in the same optional-with-default shape as `clock`. `window_id` is 16 bytes encoded as
  base64url. It is never a `packages/ids` id (UUID v7 is time-prefixed) and never derived from the session, the user or
  the time.
- **Wiring.** `AuthService` gains `privateView`. The wiring lives in the new private-view module, not in `config.ts`,
  which is at 394 lines.
- **Exports.** `index.ts` exports the facade, proof, scope and result types as types only.
- **No logging.** A `window_id` is never logged or put in an error message. A database error is rethrown without it.

### 6. Tests (auth level, real Postgres of the test cluster, no HTTP)

They live in `packages/auth/src/__tests__/private-view.spec.ts` and `private-view-boundaries.spec.ts`, on
`privateViewFixture` (`private-view.fixture.ts`, built on `staffAuthFixture`), with a mutable Clock and deterministic
entropy. The concurrency case holds the window's `verification` row `FOR UPDATE` from a second connection
(`holdWindowLock`) and waits on
`pg_locks` (`locktype IN ('transactionid', 'tuple')`), adapting `waitForLockWaiters` from `staff-sign-out-race.spec.ts`.

- **Concurrent openings.** Two concurrent openings leave one window with one `window_id`, and every later opening gets
  a strictly greater `window_seq`.
- **The proof.** A proof at exactly 60 s opens. A proof at 61 s, a reused proof, a forged object and a proof whose
  scope differs from the session open nothing. Two simultaneous openings with the same proof open exactly once. An opening after the session row is gone refuses and inserts nothing.
- **The idle limit.**
  - A check at 60 s passes, extends the window and returns the remaining times.
  - A check at 61 s is `expired` and deletes the window.
  - Touches every 50 s keep the window alive until 4:59, and the touch at 5:01 is `expired` and deleted.
- **Mismatches.** A missing id, a wrong id, or the matching id with the wrong user or device is `mismatch`: the
  timestamps are unchanged and nothing is deleted.
- **Late requests.** A late check, close or cleanup carrying the old `window_id` after a new opening leaves the new
  window unchanged.
- **The counter.** A close removes the window and keeps the counter.
- **Session end.** Sign-out (both delete paths), replacement through `otpRotate` and `otpApprovePhone` remove the
  window and the counter, in both race orders against an opening, with no orphan recreated. Another session's rows are
  untouched.
- **Timestamps.** The stored `created_at` and `updated_at` equal the fixture Clock, not the database's `now()`.

### 7. Files

- **Create:**
  - `packages/auth/src/private-view.ts` (the facade) and `packages/auth/src/private-view/{open,check,options,proof}.ts`
    (the decisions, the limits and the proof). `packages/auth` holds no SQL: it has no `drizzle-orm` dependency;
  - `packages/db/src/staff-private-view/{open,check,close,identifiers,types,timestamp}.ts` (all the SQL, the
    identifiers and the shared delete), re-exported by the surface file `packages/db/src/staff-private-view.ts`;
  - `packages/auth/src/__tests__/private-view.spec.ts`, `private-view-boundaries.spec.ts` and `private-view.fixture.ts`.
- **Change:**
  - `packages/auth/src/config.ts` (the `entropy` option and `privateView` on `AuthService`, wired from the new module);
  - `packages/auth/src/index.ts`;
  - `packages/auth/src/staff-session-fence.ts`;
  - `packages/db/src/staff-otp-database.ts`;
  - `packages/db/src/index.ts` (exports), when the new module needs it.
- **Not touched:** no migration, no grant, no contracts, no API and no browser code.
