# ADR-0043 — Patch postgres.js 3.4.9 so a closed-socket write rejects the query

- **Status:** Accepted
- **Date:** 2026-10-16
- **Decided by:** Waleed (2026-10-16), option (a) on issue #241

## Context

Issue #241: postgres.js 3.4.9 (the pin in ADR-0006; still the current release) can throw
`TypeError: Cannot read properties of null (reading 'write')` outside any promise. `connection.js`
`write()` arms `setImmediate(nextWrite)`, and `nextWrite` calls `socket.write` after `closed()` has set
`socket` to null. api and worker have no `uncaughtException` handler, so the throw crashes the process.
Upstream reports the same crash (porsager/postgres #1066 and #1154) and neither has a landed fix, so a
version bump is not available.

The path that produces it is an abandoned deadline transaction. `withDeadline` (`packages/db/src/with-tenant.ts`)
returns `TimeoutError` while the inner transaction keeps running (`work.catch`). If the session then sits idle
past `idle_in_transaction_session_timeout`, the server closes it. postgres.js `begin()` (`src/index.js`) still
sends `rollback` from its `catch`, and that write hits the null socket. Four call sites pair a JavaScript
deadline with that server timeout:

- `packages/db/src/platform-whatsapp-database.ts` `withGlobal` (200 ms)
- `packages/db/src/with-tenant.ts` `withTenant({ timeoutMs })`
- `packages/db/src/bounded-tenant.ts` `boundedTenant`
- `packages/db/src/staff-otp-runtime.ts` `createOtpRuntime().run`

`boundedTenant` and `createOtpRuntime().run` use `boundedPostgres`, which already skips its own `ROLLBACK`
when its socket is dead. `withGlobal` and `withTenant` go through Drizzle `db.transaction` → postgres.js
`begin()`, which does not.

## Decision

Patch `postgres@3.4.9` with `pnpm patch` (pnpm 12.5.1 registers it under `patchedDependencies` in
`pnpm-workspace.yaml`). Both builds this repo can load are patched the same way: ESM `src/connection.js`
(what `import` resolves, including `drizzle-orm/postgres-js`) and CJS `cjs/src/connection.js` (`require`).
The workerd and bun builds are not loaded here and are not patched.

`execute` rejects a query with `Errors.connection('CONNECTION_CLOSED', ...)` before the query is queued when
`socket` is already null, and returns `true` so the pool does not treat the closed socket as backpressure.
`write` and `nextWrite` use the same error through the existing `error()` path if a write is still attempted
after `closed()`. No new error shape.

## Consequences

- Remove this patch when upstream rejects the closed-socket write inside the query promise. Until then, any
  upgrade of `postgres` must re-apply and re-check the patch; pnpm will not carry it onto another version.
- Report the patch upstream against #1066 / #1154 rather than carrying it quietly.
- The patch does not cancel the abandoned transaction earlier. It only stops the late `rollback` from escaping
  as an uncaught exception.
