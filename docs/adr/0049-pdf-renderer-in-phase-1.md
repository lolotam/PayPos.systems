# ADR-0049 — The PDF renderer comes into Phase 1

- **Status:** Accepted — Waleed answered PP-6.1…PP-6.3 with the recommended options on 2026-10-20
  ([owner questions](../specs/056-documents-pdf-renderer/owner-questions.ar.md))
- **Date:** 2026-10-19
- **Slice:** Phase 1 row 27i ([spec 056](../specs/056-documents-pdf-renderer/spec.md)), for row 27g (the official attendance
  statement)
- **Design advisors:** Codex astra 6 (medium) and Claude Fable 5.1, read-only, 2026-10-19. Both chose the same transport,
  job shape, image and lifecycle; where they differed, the choice and the reason are written below.

## Context

`06` §2 places PDF rendering in the worker ("Playwright headless, HTML→PDF, Arabic fonts", still marked "to review"), and
the Phase 0 plan (T13) kept Chromium out of the worker image until Phase 5 (P5-T2). Abu Salem's pick AB-Q10 brings the
official attendance statement into Phase 1 (row 27g), so the renderer must come first.

Four rules meet here:

1. Anything over 200 ms is a BullMQ job, and the API never waits on it (`CLAUDE.md` §6, `06` §5).
2. Plan row 27i: the PDF is streamed to the requester as a download and **not stored**; no cross-module write.
3. Job payloads carry ids only; the worker reads every other fact inside `withTenant` (ADR-0018 §1, `files-verify`,
   the staff jobs).
4. Every image is `node:24-alpine` (ADR-0002, ADR-0022). Playwright does not support musl, and a Chromium from `apk`
   floats with the Alpine index instead of the revision `playwright-core` was released against.

The module map's prose already lets "worker jobs" import `packages/documents`, but its YAML (the list the checker
enforces) names only `reporting`.

## Decision

### 1. Transport: request, poll, collect once

1. A consumer module's use case (27g: `staff`) creates a render: it generates `render_id` (UUID v7 through the injected
   `IdGenerator`), writes its own request record if it needs one (27g's download audit row), and enqueues a BullMQ job
   on the `documents-render` queue. The endpoint answers **202** `{ render_id }`. The API never awaits the job.
2. The job payload is `{ company_id, render_id, kind }` only (`z.strictObject` in `packages/contracts`). `kind` selects
   a registered **document source** in the worker; the source reads its data under `withTenant(company_id)`, closes the
   transaction, and only then renders. Tenant data never enters the job. `jobId = render_id`, `attempts: 2`,
   `removeOnComplete`/`removeOnFail: true`.
3. The worker keeps two Redis keys, both prefixed with the tenant:
   - `documents:status:{company_id}:{render_id}`: a small hash `{ state, requested_by, error_code?, filename }`,
     TTL 15 minutes. Written `QUEUED` by the API **before** it enqueues the job (`HSET` + `EXPIRE`, then `Queue.add`); the worker skips a
     job whose status is missing. `RENDERING`, `READY` or `FAILED` are written by the worker, each by one atomic script
     guarded by the current state.
   - `documents:bytes:{company_id}:{render_id}`: the PDF, written `SET NX` with a TTL of **120 seconds** from `READY`.
4. The requester polls `GET …/{render_id}` (status only: `QUEUED | RENDERING | READY | FAILED | EXPIRED | CONSUMED`
   and a safe `error_code`; `Cache-Control: no-store`). It then collects the file with **`POST …/{render_id}/download`**,
   which `GETDEL`s the bytes, so exactly one request receives them. The reply is `application/pdf`,
   `Content-Disposition: attachment` with an RFC 5987 file name and an ASCII fallback, `Cache-Control: no-store` and
   `X-Content-Type-Options: nosniff`. POST, not GET, because collecting consumes the file and (in 27g) writes an
   audit row; ADR-0022 made file download a POST for the same reason, and a one-shot GET is eaten by link prefetch and
   download-manager retries.
5. Binding: the status hash records the requesting user. Another user, another company, an unknown id and an expired
   id all answer the same `404`; permissions are checked again on status and on collect.
6. Bytes that vanished before collection (TTL or Redis eviction) read as `EXPIRED`, never a 500. A broken connection
   during collection needs a new request; nothing is retried from a consumed key.
7. **What "not stored" means here (PP-6.1).** No PDF byte is written to Postgres, R2, the BullMQ job (`returnvalue`
   included), a log line or any cache. Redis holds the bytes only as a **transport buffer**, in exactly this keyspace:

   | Key | Holds | TTL | Removed |
   |---|---|---|---|
   | `documents:bytes:{company_id}:{render_id}` | the PDF | 120 s from `READY` (`SET … EX 120 NX`) | on the first collection (`GETDEL`) or at expiry |
   | `documents:status:{company_id}:{render_id}` | `state`, `requested_by`, `error_code`, `filename`; no document data | 900 s | at expiry |
   | `documents:renderer-alive` | `1` | 3 s, refreshed while Chromium is up | at expiry |

   **Residual risk accepted:** the shared Redis may run AOF or RDB persistence. If it does, a PDF can reach that Redis's
   disk for up to its snapshot or fsync interval (and stay in an RDB file until the next snapshot overwrites it), behind
   the Redis password. A separate memory-only Redis would close this, at the cost of a new container on the shared
   server. Storing a copy for later remains a separate decision that needs a `files`-owned handoff and its own ADR
   (plan row 27i).

Rejected: holding the request open with `waitUntilFinished` (a synchronous wait in the API, one extra Redis connection
per request); an SSE "ready" signal (realtime is outside Phase 1, and polling is enough); returning the PDF through
BullMQ's `returnvalue` (it stays in the job hash after the download, and `removeOnComplete` would race the collection).

### 2. The renderer and its templates

1. `packages/documents` exports a `DocumentRenderer` (`render(html, options) → Uint8Array`) with one Playwright adapter,
   and the template kit: an `html` tagged template that escapes every interpolation, `raw()` only for fragments the
   code itself built (data URIs), and an ar/en base layout (`<html lang dir>`, A4 `@page`, logical CSS properties,
   `<bdi>` around Latin runs in Arabic text, a footer in the body). No template library: a tagged template is enough,
   and an engine would need its own ADR and bring triple-brace escaping holes.
2. Templates receive typed data (Zod in `packages/contracts`) and never raw HTML, CSS or URLs from a request.
3. **Font:** IBM Plex Sans Arabic (OFL 1.1, Arabic and Latin in one family), the face the admin and POS screens already
   use, from the same pinned `@fontsource/ibm-plex-sans-arabic` 5.3.0 package. Its woff2 files are embedded as base64
   `@font-face` rules, so the PDF looks the same on Windows and Linux and no font is fetched at render time.
4. Size caps: HTML at most 4 MiB, PDF at most 8 MiB (a larger result fails with `DOCUMENT_TOO_LARGE`).

### 3. Browser lifecycle and hardening

1. One Chromium per worker process, launched at start; a fresh context and page per job, closed in `finally`. On
   `disconnected` the capability is marked unavailable and relaunched with backoff; the job in flight fails and BullMQ
   retries it once. Concurrency 2 on the queue; BullMQ `lockDuration` at least 45 s so a slow render is never picked up
   twice.
   Playwright's own signal handlers are off, so the worker's ordered shutdown closes the queue first and the browser
   last; a start that fails or is slow retries with backoff instead of closing the capability for good.
2. Each context runs with `javaScriptEnabled: false`, `offline: true`, service workers blocked and every route aborted.
   All CSS, fonts and images are inline. Timeouts: `setContent` 10 s, `pdf` 20 s, 30 s for the whole job; a timeout
   closes the context (and the browser if it hangs), it does not just stop waiting.
3. **Sandbox off (PP-6.3)** (`chromiumSandbox: false`, Playwright's default). Turning the sandbox on needs seccomp or
   user-namespace changes on the shared server; Codex preferred it on, and this is the recorded trade-off, to be revisited
   if a template ever renders HTML it did not build. Four compensating controls replace it, each a test that runs with no
   server:
   - **C1 escaped HTML:** every value interpolated by the `html` template is escaped; a payload with `<script>`, quotes,
     `&` and `</style>` comes out inert, and `raw()` cannot be built from request text.
   - **C2 JavaScript off:** a fixture page with an inline script that would change the document renders a PDF without
     that change.
   - **C3 every request aborted:** a fixture page that references an external image, stylesheet and font produces a PDF,
     and the route handler records each request as aborted; nothing reaches the network.
   - **C4 non-root:** the worker image's final `USER` is `node` (a test reads `deploy/Dockerfile.worker`), and the image
     build's smoke prints a non-zero uid.

4. `--disable-dev-shm-usage` (Docker's 64 MB `/dev/shm`) and `--disable-gpu`. No traces, HAR files or downloads.
5. The liveness key is one key per Redis, which fits the single worker instance staging runs today; a second worker
   instance needs a per-instance key first.
6. The renderer is an **optional capability**: `/ready` does not wait for Chromium, so the outbox dispatcher, files and
   notifications keep running if it fails. While the browser is up, the worker refreshes a 3-second liveness key in
   Redis (the `staff-otp:worker-capability` pattern); the API refuses a new render with `503 RENDERER_UNAVAILABLE` when
   the key is missing, so no job is queued with nothing to run it.

### 4. The worker image moves to Debian; the API stays on Alpine

1. `deploy/Dockerfile.worker` moves **both** stages to `node:24-bookworm-slim`. The build stage must move too: `pnpm
   deploy --prod` copies the native `sharp` binary of the stage that installed it, so a glibc runtime with a musl build
   would fail the ADR-0022 sharp smoke. That smoke stays, now on glibc.
2. `playwright-core` is pinned to **1.63.0**, the version `@playwright/test` uses in admin and POS (they move together),
   and its matching Chromium headless shell is installed at image build with its system libraries
   (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, readable by `node`). Nothing is downloaded at runtime.
3. A second smoke at image build renders an Arabic fixture to PDF and checks the `%PDF-` header.
4. Debian slim has no `wget`; the worker healthcheck runs `node -e` instead.
5. The worker memory limit rises from 384 MB to 1 GB in `docker-compose.staging-shared.yml`. The API image and its
   dependencies are unchanged: `packages/documents` is never a dependency of `apps/api`.

This amends ADR-0002 and ADR-0022 for the worker image only.

### 5. Module map

`packages/documents` is created once, in `apps/worker/src/main.ts`, and handed to the worker's `documents`
infrastructure folder (beside `outbox/`). Business modules never import it; they register a document source by `kind`.
The map declares `composition_roots: documents: [apps/worker/src/main.ts]` and keeps `packages_restricted: documents:
[reporting]`. The API side of a render (enqueue, status, collect) is a port in the consuming module with a BullMQ/Redis
adapter in its `persistence/`, built with that module's first use (27g). No new business import arrow.

### 6. The logo bytes reader moves to 27g (PP-6.2)

ADR-0046 §5 put the `files`-owned logo bytes reader in 27i. It writes a `file_access_audit` row for the statement's
requester, and its first caller is 27g's statement source. It is built with 27g, beside the `staff → settings` and
`staff → files` arrows that row adds, so 27i stays free of database changes and cross-module calls. ADR-0046 §5 is
amended to say so.
ADR-0051 (27g) later settles those arrows: no `staff → settings` import (the identity read moves to `@pospay/db`) and
no `staff → files` call for the logo either: the documents source calls the worker `files` logo reader directly.

## Consequences

- One new dependency, `playwright-core` 1.63.0, in `packages/documents` only; it reuses an existing font package.
- The worker image grows by the Chromium headless shell and its libraries (measured in the PR); the API image does not
  change.
- Tenant names and attendance figures pass through Redis for at most 120 s inside a PDF. Like every Redis key, they
  are protected by the Redis password and are not logged.
- A Chromium crash costs one retry of the job in flight, never the worker's readiness.
- `06` §2's "PDF/Excel" row becomes confirmed for PDF; Excel is still Phase 5.
- 27g adds the first real template and source, the API endpoints, the download audit and the logo bytes reader.
