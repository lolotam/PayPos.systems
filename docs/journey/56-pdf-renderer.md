# 56 · The PDF renderer — محرّك ملفات الـ PDF

**Status / الحالة:** shipped in #413 (row 27i, merged). Two test-only fixes followed, also merged: #425 (issue #424) and #426 (issue #423).
**Nothing to click yet.** This is a worker capability with no screen and no API route. What exists:
- the `documents-render` queue in the worker;
- one Chromium per worker process;
- the worker image moved to Debian (`node:24-bookworm-slim`) with the Chromium headless shell. The API image is unchanged.

**No document kind is registered yet**, so any job today would end `FAILED` with `DOCUMENT_KIND_UNKNOWN`. The first real document, the
official attendance statement with the logo and official name of [55](55-business-identity.md), comes in row 27g. 27g also adds the request,
status and download endpoints.

The worker runs on staging, but there is nothing to test there. The only thing there that could show the renderer is the Redis key
`documents:renderer-alive`. It was not checked live.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) (`pnpm install`). The renderer tests need no database and no `.env`.
- For the real render tests: the Chromium headless shell, installed once with `node packages/documents/scripts/install-headless-shell.mjs`.
  Without it the real render is skipped locally (in CI it fails).
- For the worker tests: the T2 compose stack running (Redis, and Postgres for the shared test setup).

## العربي

1. **مفيش حاجة تدوس عليها.** مفيش شاشة ولا رابط في لوحة الإدارة أو الكاشير بيطلب PDF لسه. اللي بتشوفه دلوقتي اختبارات بس.
2. **اختبارات المحرّك:** ابني اللي الحزمة محتاجاه `pnpm --filter "@pospay/documents^..." build`، وبعدين `pnpm --filter @pospay/documents test`.
   - **لازم تشوف:** كل الاختبارات `passed`. ملف عربي وملف إنجليزي بيترسموا PDF بجد، يبدأوا بـ `%PDF-`، وجواهم خط IBM Plex Sans Arabic.
   - العربي بيطلع `dir="rtl" lang="ar"` والإنجليزي `dir="ltr" lang="en"`.
3. **الأمان جوه الصفحة:** نفس الاختبارات بتثبت إن:
   - أي قيمة فيها `<script>` أو `"` أو `&` بتتكتب كنص عادي؛
   - الجافاسكريبت مقفول، والصفحة ما بتحمّلش أي حاجة من النت (الخط والصور جوه الملف نفسه)؛
   - Chromium ما بيشتغلش بصلاحيات root.
4. **اختبارات الـ worker:** مع الـ compose شغّال (Redis وPostgres): `pnpm --filter @pospay/worker exec vitest run src/documents`.
   - شغلانة بمفتاح زيادة أو ناقص بتفشل من غير رسم.
   - نوع مش معروف ← `FAILED` / `DOCUMENT_KIND_UNKNOWN`.
   - HTML أكبر من 4 ميجا أو PDF أكبر من 8 ميجا ← `DOCUMENT_TOO_LARGE`.
   - رسم أطول من 30 ثانية ← `DOCUMENT_RENDER_TIMEOUT`.
   - المحاولة الأولى لو فشلت لسبب مؤقت (فشل الرسم أو الوقت خلص) بتتعاد مرة واحدة بعد 5 ثواني؛ أما `DOCUMENT_KIND_UNKNOWN` و`DOCUMENT_TOO_LARGE` فمحاولة واحدة بس من غير إعادة.
5. **الملف ما بيتخزنش:** الـ PDF بيتحط في Redis لمدة 120 ثانية بس، وبيتاخد مرة واحدة. حالة الطلب نفسها بتفضل 15 دقيقة.
6. **صورة الـ worker:** `docker build -f deploy/Dockerfile.worker .` بيشغّل فحصين وقت البناء: sharp، وبعده PDF عربي. فحص الـ PDF بيرفض يشتغل بـ root.
7. **المحرّك شغال ولا لأ:** وChromium شغال، الـ worker بيجدد المفتاح `documents:renderer-alive` كل ثانية تقريبًا (عمره 3 ثواني). لو Chromium وقع، المفتاح بيختفي، والـ worker بيرجّع Chromium تاني. `/ready` بتاع الـ worker مش مربوط بيه.

**ممنوع يحصل:**
- محتوى الـ PDF أو الـ HTML أو بيانات الملف يتكتب في اللوجز، أو في Postgres، أو في التخزين.
- الصفحة اللي بتترسم تحمّل أي حاجة من النت أو تشغّل جافاسكريبت.
- المحاولة التانية تنشر ملف تاني بعد ما الأول بقى `READY`.
- الـ API يعتمد على `playwright-core` أو `@pospay/documents`، أو أي module غير مجلد `documents/` في الـ worker يستورد المحرّك.
- طلب يفضل مستني وقاعدة البيانات مفتوحة وChromium بيرسم.

## English

1. **Nothing to click.** No screen or link in the admin or the POS asks for a PDF yet. What you can see today is tests only.
2. **Renderer tests:** build what the package needs with `pnpm --filter "@pospay/documents^..." build`, then run `pnpm --filter @pospay/documents test`.
   - **You must see:** every test `passed`. An Arabic and an English fixture are rendered to a real PDF that starts with `%PDF-` and embeds
     the IBM Plex Sans Arabic font.
   - The Arabic one has `dir="rtl" lang="ar"`, the English one `dir="ltr" lang="en"`.
3. **Safety inside the page:** the same tests prove that:
   - any value with `<script>`, `"` or `&` is written as plain text;
   - JavaScript is off and the page loads nothing from the network (the font and images are inline);
   - Chromium does not run as root.
4. **Worker tests:** with the compose stack running (Redis and Postgres): `pnpm --filter @pospay/worker exec vitest run src/documents`.
   - A job with an extra or a missing key fails without rendering.
   - An unknown kind → `FAILED` / `DOCUMENT_KIND_UNKNOWN`.
   - HTML over 4 MiB or a PDF over 8 MiB → `DOCUMENT_TOO_LARGE`.
   - A render over 30 s → `DOCUMENT_RENDER_TIMEOUT`.
   - A first attempt that fails for a transient reason (a render failure or a timeout) is retried once, 5 s later;
     `DOCUMENT_KIND_UNKNOWN` and `DOCUMENT_TOO_LARGE` run once and are never retried.
5. **The file is not stored:** the PDF sits in Redis for 120 s only and is collected once. The request status itself lives 15 minutes.
6. **Worker image:** `docker build -f deploy/Dockerfile.worker .` runs two smokes at build time: sharp, then an Arabic PDF. The PDF smoke
   refuses to run as root.
7. **Is the renderer up:** while Chromium is up, the worker refreshes the key `documents:renderer-alive` about once a second (3 s TTL). If
   Chromium dies, the key disappears and the worker relaunches Chromium. The worker's `/ready` does not depend on it.

**Must NOT happen:**
- PDF bytes, HTML or template data written to a log line, Postgres or object storage.
- The rendered page loading anything from the network or running JavaScript.
- A retry publishing a second file after the first reached `READY`.
- `apps/api` depending on `playwright-core` or `@pospay/documents`, or any module other than the worker's `documents/` folder importing
  the renderer.
- A database transaction held open while Chromium renders.

## For an agent

- No browser step and no HTTP route. Local admin `http://localhost:3001` and staging `https://app.staging.pospay.systems` have nothing for
  this journey.
- Run the commands of steps 2, 4 and 6; assert exit code 0 and `passed`.
- Queue `documents-render`; job data exactly `{ company_id, render_id, kind }` (`packages/contracts/src/documents-render.ts`), 2 attempts,
  5 s backoff.
- Redis keys: `documents:status:<company>:<render>` (900 s), the bytes key (120 s, `SET NX`, collected with `GETDEL`),
  `documents:renderer-alive` (3 s).
- States: `QUEUED`, `RENDERING`, `READY`, `FAILED`, `EXPIRED`, `CONSUMED`.
- Errors: `DOCUMENT_KIND_UNKNOWN` · `DOCUMENT_TOO_LARGE` · `DOCUMENT_RENDER_TIMEOUT` · `DOCUMENT_RENDER_FAILED`; an invalid job payload
  fails as `DOCUMENT_JOB_INVALID` (worker only).
- Assertions: no HTML, PDF byte or template data in the log lines of a successful or failed render; a second `GETDEL` returns nothing;
  `pnpm module-map:check` passes; `apps/api`'s production dependencies include neither `playwright-core` nor `@pospay/documents`.
- Sources:
  - `docs/specs/056-documents-pdf-renderer/{spec.md,owner-questions.ar.md}`, `docs/adr/0049-pdf-renderer-in-phase-1.md`;
  - `packages/documents/src/**`, `packages/documents/scripts/{install-headless-shell,pdf-smoke}.mjs`;
  - `apps/worker/src/documents/**`, `packages/contracts/src/documents-render.ts`;
  - `deploy/Dockerfile.worker`.
