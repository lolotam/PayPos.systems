# 28 · Document expiry alerts — تنبيه انتهاء الوثائق

**Status / الحالة:** shipped in #110 (PR 15, merged). Local only (admin not deployed, issue #54). This is a **background
job with no new screen**. It notices that an employee document is about to expire and records it once. **Nobody is
notified yet:** the alert carries no recipients until alert rules ship (PR 62), and WhatsApp and email are off. What
you can see today is the existing **Expiring soon** status on the employee's documents ([14](14-private-files.md),
PR 13) and, for an agent, the audit row and the outbox event the job writes. No alert is lost by waiting: PR 62 sends
each notice that is still current and inside its window once, with recipients.

**Before you start / قبل ما تبدأ:**
- `pnpm db:migrate` (the notice ledger and its scan index), then the API, the **worker** and Redis running.
- A business with a timezone, a document type with **Alert days before expiry** set (for example 30), and an employee
  with a **current** document of that type whose **Expires on** falls inside the window. Synthetic data only.
- The job for a company starts only after that company records a document **after** this release (the
  `EmployeeDocumentRecorded` event registers it). Companies whose documents were all recorded earlier need the one-time
  replay listed as a launch task before the pilot (spec 033, MO-Q4).

## العربي

1. **النافذة:** من **أنواع الوثائق** حدد لكل نوع **أيام التنبيه قبل الانتهاء (٠–٣٦٥)**. الوثيقة الحالية تدخل النافذة
   لما يكون الباقي على **تاريخ الانتهاء** من صفر لحد عدد الأيام ده، محسوب بتاريخ اليوم في **توقيت النشاط** مش توقيت
   السيرفر. `0` معناها يوم الانتهاء نفسه بس؛ اليوم اللي بعده الوثيقة **منتهية** ومفيش تنبيه.
2. **اللي بتشوفه:** في **وثائق الموظف** الوثيقة دي حالتها **تقترب من الانتهاء**. ده نفس الحساب اللي بيستخدمه الـ job.
3. **التسجيل مرة واحدة:** كل 6 ساعات الـ job بيفحص وثائق الشركة نشاط نشاط، ولكل وثيقة جوه النافذة بيسجّل تنبيه
   **واحد بس** لكل (وثيقة، تاريخ انتهاء)، في نفس المعاملة مع سجل التدقيق والحدث. لو اشتغل تاني، أو اتعمله restart، أو
   اشتغل اتنين workers مع بعض، أو غيّرت **أيام التنبيه**، مفيش تنبيه تاني لنفس الوثيقة ونفس التاريخ.
4. **الاستبدال:** لو رفعت وثيقة جديدة من نفس النوع (استبدال)، القديمة مبقتش حالية ومش بتتفحص؛ الجديدة وثيقة مختلفة
   وليها تنبيه واحد خاص بيها لو دخلت النافذة. وثيقة **بلا انتهاء** مش بتتفحص أبدًا.
5. **مفيش إشعار لسه:** التنبيه بيتسجل من غير مستلمين، فطبقة الإشعارات بتستلمه وما بتبعتش حاجة. ده مقصود لحد PR 62.
   ساعتها كل تنبيه اتسجل من غير مستلمين ووثيقته لسه حالية وجوه النافذة هيتبعت **مرة واحدة** للمستلمين الصح، فمفيش تنبيه
   بيضيع بسبب إنه اتسجل بدري.
6. **العزل:** الـ job بيشتغل لكل شركة لوحدها جوه حدودها، وما بيقراش ولا يكتبش بيانات شركة تانية.

**ممنوع يحصل:**
- تنبيهين لنفس الوثيقة ونفس تاريخ الانتهاء، مهما اتكرر التشغيل أو اتغيرت أيام التنبيه.
- تنبيه لوثيقة منتهية، أو مستبدلة، أو من غير تاريخ انتهاء.
- حساب "النهارده" بساعة السيرفر بدل توقيت النشاط.
- رسالة WhatsApp أو إيميل حقيقية، أو ادعاء إن حد اتبلّغ.
- اسم الموظف أو محتوى الوثيقة أو مفتاح الملف في الحدث أو في سجل التدقيق.
- تنبيه اتسجل قبل PR 62 يمنع وصول التنبيه الحقيقي بعده.

## English

1. **The window:** in **Document types** set **Alert days before expiry (0–365)** for each type. A current document
   enters the window when the days left until its **Expires on** date are between zero and that number, counted from
   today's date in the **business timezone**, not the server's. `0` means the expiry day itself only; the day after,
   the document is **Expired** and gets no alert.
2. **What you see:** in **Employee documents** that document shows **Expiring soon**. The job uses the same rule.
3. **Recorded once:** every 6 hours the job scans the company's documents business by business. For each document
   inside the window it records **exactly one** notice per (document, expiry date), in one transaction with the audit
   row and the event. A re-run, a restart, two workers at once or an edited **Alert days** never record a second
   notice for the same document and date.
4. **Replacement:** uploading a new document of the same type (a replacement) makes the old one non-current, so it is
   no longer scanned. The new one is a different document and gets its own single notice when it enters the window.
   A document with **No expiry** is never scanned.
5. **No notification yet:** the notice is recorded with no recipients, so the notifications layer accepts it and sends
   nothing. That is intended until PR 62. Then every notice recorded without recipients whose document is still current
   and inside its window is sent **once** to the right people, so no alert is lost by having been recorded early.
6. **Isolation:** the job runs for one company at a time inside that company's boundary and never reads or writes
   another company's data.

**Must NOT happen:**
- Two notices for the same document and expiry date, however often the job runs or the alert days change.
- A notice for an expired document, a replaced one, or one without an expiry date.
- "Today" computed from the server clock instead of the business timezone.
- A real WhatsApp message or email, or any claim that someone was notified.
- The employee's name, the document content or its file key in the event or the audit row.
- A notice recorded before PR 62 preventing the real alert after it.

## For an agent

- No HTTP route. The worker queue is the document-expiry queue (`apps/worker/src/modules/staff/jobs/document-expiry.processor.ts`),
  one repeatable schedule per company (`every` 6 hours, id-only data `{ companyId }`), registered when
  `EmployeeDocumentRecorded` is delivered. Concurrency 1.
- Assertions (owner role, synthetic data): one row in `employee_document_expiry_notices` per
  `(company_id, document_id, expires_on)` with `recipients_attached_at IS NULL`; one `audit_log` row
  `entity='employee_document'`, `action='document_expiring.notified'`, actor null; one `outbox` row
  `event_type='DocumentExpiring'` whose payload has `document_id, employee_id, business_id, type_code, expires_on,
  days_remaining, alert_days, today, detected_at` and no `notification_recipients`. A second run adds nothing.
  `pospay_app` cannot UPDATE or DELETE the ledger.
- Window boundaries to check: `alert_days = 0` on the expiry day (notice) and the day after (none); a business whose
  local date differs from UTC; a document without `expires_on` (ignored); a replaced document (ignored, its replacement
  noticed separately); another tenant untouched.
- Sources: `docs/specs/033-staff-document-expiry-job/spec.md` (including the PR 62 contract and MO-Q1–Q5),
  `apps/worker/src/modules/staff/{domain/document-expiry.ts,persistence/document-expiry.transactions.ts,use-cases/detect-document-expiries/}`,
  `packages/db/schema/staff-documents.ts`, migrations `0081`/`0082`.
