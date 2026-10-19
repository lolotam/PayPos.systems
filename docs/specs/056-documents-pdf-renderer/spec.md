# Spec 056 — The PDF renderer (Phase 1 row 27i)

> **Status:** Draft · 2026-10-19. Foundation only: no screen, no endpoint, no database change.
> **Decision record:** [ADR-0048](../../adr/0048-pdf-renderer-in-phase-1.md) (design advisors Codex astra 6 and Claude
> Fable 5.1, 2026-10-19).
> **Needed by:** row 27g (the official attendance statement PDF, Abu Salem's pick AB-Q10).
> **Depends on:** row 27 and 27h-4 (merged).
> **Owner questions:** none. This slice moves no money and sets no business rule; its technical choices are routed to
> Waleed through the PosPay manager (`CLAUDE.md` §1 5b) and recorded in ADR-0048.

## 1. What and why

Row 27g prints an official attendance statement as a PDF, in Arabic or English, with the business logo and its official
name. Rendering a PDF takes seconds, so it cannot run inside an API request (`CLAUDE.md` §6). This slice builds the
renderer and the way its result travels back to the person who asked for it, and proves both with a test-only fixture
document. 27g then adds the first real document.

## 2. Scope

| In 27i | In 27g |
|---|---|
| `packages/documents`: the `DocumentRenderer` port, its Playwright adapter, the escaping `html` template kit, the ar/en base layout, the embedded font | the attendance statement template and its data |
| `packages/contracts`: the render job schema, the status states, the Redis key names and limits | the statement request/status/download endpoints and their contracts |
| `apps/worker`: the `documents-render` queue processor, the source registry by `kind`, the browser lifecycle, the liveness key | the `attendance-statement` source in the staff worker module |
| `deploy/Dockerfile.worker` on `node:24-bookworm-slim` with Chromium; the worker memory limit; the PDF smoke | the API port and its BullMQ/Redis adapter in `staff/persistence/` |
| module map: the `documents` composition root | `staff → settings`, `staff → files` arrows; the logo bytes reader (ADR-0046 §5, amended) |
| ADR-0048; ADR-0046 §5 amended; `06` §2 "PDF" confirmed | the download audit row (ST-Q5) |

## 3. Requirements

- **FR-001** A render is a BullMQ job on the `documents-render` queue whose data is exactly
  `{ company_id, render_id, kind }`; any other key, or a missing one, fails the job without rendering.
- **FR-002** The worker sets the status hash to `RENDERING`, asks the source registered for `kind` for the HTML, renders it,
  writes the PDF bytes with `SET NX` and a 120-second TTL, then sets `READY`. An unknown `kind` sets `FAILED` with
  `DOCUMENT_KIND_UNKNOWN`.
- **FR-003** A source reads its data inside `withTenant(company_id)` and returns before rendering starts; no database
  transaction is open while Chromium runs.
- **FR-004** HTML over 4 MiB or a PDF over 8 MiB sets `FAILED` with `DOCUMENT_TOO_LARGE`; nothing is written to the bytes
  key.
- **FR-005** A render that exceeds its timeouts (`setContent` 10 s, `pdf` 20 s, 30 s overall) sets `FAILED` with
  `DOCUMENT_RENDER_TIMEOUT` after its context has been closed.
- **FR-006** A failure on the first attempt is retried once (`attempts: 2`); `FAILED` is written only after the last
  attempt. A retry never overwrites bytes that are already written (`SET NX`).
- **FR-007** No PDF byte, HTML, template data, Redis key value or tenant field is written to a log line, the job's
  `returnvalue`, Postgres or object storage. Logs carry `company_id`, `render_id`, `kind`, the state and the duration.
- **FR-008** Every interpolated value in a template is HTML-escaped. `raw()` accepts only fragments built by the
  template kit itself (data URIs, the font CSS).
- **FR-009** The rendered page loads nothing from the network: JavaScript is off, the context is offline, every route is
  aborted, and fonts and images are inline.
- **FR-010** The base layout sets `lang` and `dir` from the language (`ar` → `rtl`, `en` → `ltr`), uses logical CSS
  properties only, prints on A4, and embeds IBM Plex Sans Arabic from `@fontsource/ibm-plex-sans-arabic` 5.3.0.
- **FR-011** One Chromium per worker process. When it disconnects, the renderer is marked unavailable and relaunched
  with backoff; the job in flight fails its attempt.
- **FR-012** While Chromium is up, the worker refreshes `documents:renderer-alive` with a 3-second TTL. The worker's
  `/ready` does not depend on the renderer.
- **FR-013** The worker image renders an Arabic fixture to a valid PDF at build time (the `%PDF-` header), next to the
  existing sharp smoke.

## 4. Acceptance criteria

| # | Given / when / then |
|---|---|
| AC-01 | A job `{company_id, render_id, kind: 'fixture'}` with the fixture source registered: the status ends `READY` and the bytes key holds a PDF that starts with `%PDF-`, is at most 8 MiB, and names the embedded font. |
| AC-02 | The same job in Arabic and in English: the HTML has `dir="rtl" lang="ar"` and `dir="ltr" lang="en"`. |
| AC-03 | A job with an extra key, or without `kind`: no render, the job fails. |
| AC-04 | An unknown `kind`: `FAILED` / `DOCUMENT_KIND_UNKNOWN`, no bytes key. |
| AC-05 | A source that returns HTML over 4 MiB: `FAILED` / `DOCUMENT_TOO_LARGE`, no bytes key. |
| AC-06 | Data containing `<script>`, `"`, `'`, `&` and `</style>`: the HTML carries them escaped; no `src`, `href` or `url(` in the output points anywhere but `data:`. |
| AC-07 | The bytes key expires 120 s after `READY`; a second `GETDEL` returns nothing. |
| AC-08 | A browser that disconnects mid-job: the attempt fails, the renderer relaunches, the retry succeeds. |
| AC-09 | Log lines of a successful and a failed render contain no HTML, no PDF byte and no template data. |
| AC-10 | `docker build -f deploy/Dockerfile.worker .` passes both smokes (sharp and PDF). |
| AC-11 | `pnpm module-map:check` passes with `@pospay/documents` imported only by `apps/worker/src/main.ts` and the worker `documents/` folder; a business module importing it fails. |
| AC-12 | `apps/api`'s production dependencies do not include `playwright-core` or `@pospay/documents`. |

## 5. Design

See ADR-0048 for the reasons. In short:

- **Transport:** 202 + poll + `POST …/download` that `GETDEL`s the bytes (the API half is 27g's). The PDF lives only in
  Redis, for at most 120 s, and only until the first collection.
- **Job:** ids and `kind` only; the worker's source reads the data.
- **Image:** the worker moves to `node:24-bookworm-slim` with `playwright-core` 1.63.0 and its headless shell; the API
  stays on Alpine.
- **Module map:** `composition_roots: documents: [apps/worker/src/main.ts]`; the processor lives in
  `apps/worker/src/documents/`, beside `outbox/`.

## 6. Tests

- `packages/documents`: unit tests for escaping, `raw()`, the base layout (`lang`, `dir`, logical properties only, no
  external URL) and the size caps; one renderer test that renders the Arabic and the English fixture with the local
  Chromium and checks the PDF header, size and font name. No pixel or byte comparison.
- `apps/worker`: the processor against the T2 compose Redis with a fake renderer (states, `SET NX`, TTL, retries, unknown
  kind, size cap, no-leak logs) and one end-to-end run with the real renderer.
- Image: the build-time PDF smoke.

## 7. Out of scope

The attendance statement itself, every API endpoint, the download audit, the logo bytes reader, storing any PDF, Excel
export.
