# 14 · Private files — الملفات الخاصة

**Status / الحالة:** shipped in #82 (PR 12). API only (no screen yet); this journey does not claim staging deployment.
Employee document metadata/UI belongs to PR 13. Owner decisions of 2026-10-03: PDF/JPEG/PNG only, 10 MiB maximum;
abandoned uploads removed after 24 hours, rejected files after seven days; employee documents for owner, general manager
and the business's business manager; private-file access audited, inaccessible files indistinguishable from unknown files.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), with migrated database, seeded permission catalog, API and worker running,
  Redis reachable and private object storage configured through `STORAGE_*` in `.env.example`.
  Without complete storage settings, file capabilities return 503 `STORAGE_NOT_CONFIGURED`; API/worker readiness stays independent.
- Use an authenticated admin session cookie and selected company (`x-company-id`). Employee-document uploads need
  `manage:files:business` and `read:files:business` covering the recorded business and optional branch.
  Owner and general manager are intended to upload/read company-wide; business manager within their own business.
  PR 7a supplies those default grants; #82 does not grant them. Prepare explicit grants for local fixtures.
- Prepare a synthetic employee reference in that business, a valid PDF/JPEG/PNG and its exact byte length
  (1–10,485,760 bytes). A fake extension is not enough: the worker checks the content.
- Commands below are curl-like Bash examples; on Windows use `curl.exe` with your shell's quoting/continuation syntax.
  Replace every `<...>` placeholder locally, including `<EXACT_SIZE_BYTES>` with an unquoted integer.
  `<SESSION_COOKIE>` is the complete cookie header value. Never put real cookies, signed URLs or contact data in docs/logs.

## العربي

1. اطلب تصريح رفع لمستند موظف. الطلب ما فيهش اسم ملف ولا مفتاح تخزين ولا رابط؛ النظام بيرجعهم بالقدر المطلوب بس.
   حط نوع الملف الحقيقي (`application/pdf` أو `image/jpeg` أو `image/png`) وحجمه بالبايت. المثال PDF؛
   `owner_module` يبقى `staff` و`required_permission` لازم `read:files:business`.

   ```bash
   curl -i -X POST 'https://<API_HOST>/v1/businesses/<BUSINESS_ID>/files/uploads' \
     -H 'Cookie: <SESSION_COOKIE>' \
     -H 'x-company-id: <COMPANY_ID>' \
     -H 'Content-Type: application/json' \
     --data '{"owner_module":"staff","owner_entity_id":"<EMPLOYEE_ID>","content_type":"application/pdf","size_bytes":<EXACT_SIZE_BYTES>,"required_permission":"read:files:business"}'
   ```

   لازم 201 مع `id`, `upload_url`, `expires_in: 120` و`headers` فيها `content-type` و`content-length`.
   احتفظ بـ `id` كـ `<FILE_ID>`؛ لو المستند مربوط بفرع، زوّد `branch_id` بمعرّف فرع من نفس النشاط.
2. ارفع نفس البايتات مباشرة لرابط `upload_url` خلال 120 ثانية، باستخدام الهيدرز الراجعة بالظبط؛
   ما تبعتش cookie أو `x-company-id` لرابط التخزين. ده PUT موقّع، ولسه مش ملف جاهز للقراءة.

   ```bash
   curl -i -X PUT '<UPLOAD_URL_FROM_TICKET>' \
     -H 'Content-Type: <TICKET_CONTENT_TYPE>' \
     -H 'Content-Length: <TICKET_CONTENT_LENGTH>' \
     --data-binary '@<LOCAL_FILE_PATH>'
   ```

   لازم التخزين يقبل الرفع برد نجاح 2xx. لو التصريح انتهى، اطلب تصريح جديد وكمّل بمعرّفه الجديد.
3. بنفس المستخدم اللي طلب الرفع، أكّد بعد نجاح الـ PUT:

   ```bash
   curl -i -X POST 'https://<API_HOST>/v1/files/<FILE_ID>/confirm' \
     -H 'Cookie: <SESSION_COOKIE>' \
     -H 'x-company-id: <COMPANY_ID>'
   ```

   لازم 202 مع `id` و`status: "QUEUED"`. ده اتضاف لطابور الفحص، مش موافقة على المحتوى؛ التأكيد المتكرر آمن.
4. تابع الحالة بنفس الجلسة لحد ما العامل يخلص:

   ```bash
   curl -i 'https://<API_HOST>/v1/files/<FILE_ID>' \
     -H 'Cookie: <SESSION_COOKIE>' \
     -H 'x-company-id: <COMPANY_ID>'
   ```

   200 مع `PENDING` أو `VERIFYING`، وبعد الفحص `READY` أو `REJECTED`.
   `storage_key` يظهر بس مع `READY`، ومفيش رابط موقّع في قراءة الحالة. PDF بيتفحص نوعه وحجمه؛ JPEG/PNG بيتفكّوا
   ويتعاد ترميزهم من غير metadata. معرفة إن الملف PDF مش فحص malware.
5. بعد `READY`، اطلب رابط تنزيل، وبعدين نزّل من الرابط خلال 60 ثانية:

   ```bash
   curl -i -X POST 'https://<API_HOST>/v1/files/<FILE_ID>/download' \
     -H 'Cookie: <SESSION_COOKIE>' \
     -H 'x-company-id: <COMPANY_ID>'
   curl -f '<DOWNLOAD_URL_FROM_RESPONSE>' -o '<LOCAL_DOWNLOAD_PATH>'
   ```

   أول طلب لازم 200 مع `download_url` و`expires_in: 60`، والتدقيق يتسجل قبل ما الرابط يرجع.
   التنزيل المباشر بيرجع الملف كمرفق؛ ما تبعتش بيانات جلسة الـ API للتخزين.
6. جرّب التنزيل قبل `READY` أو بعد رفض المحتوى ← **الملف لم يجتز التحقق بعد** (`FILE_NOT_READY`، 409).
   نوع كاذب يخلّي الحالة `REJECTED` مع `FILE_TYPE_INVALID`: **نوع المحتوى لا يطابق نوع الرفع المسموح**؛
   حجم كاذب مع `FILE_SIZE_INVALID`: **حجم الملف لا يطابق التصريح أو يتجاوز الحد المسموح**؛ محتوى غير قابل للفحص
   مع `FILE_CONTENT_INVALID`: **تعذر التحقق من محتوى الملف**. طلب تصريح أكبر من 10 MiB أو لنوع غير مسموح
   يترفض من البداية بـ 400 **البيانات المرسلة غير صحيحة** (`VALIDATION_FAILED`).
7. كرّر طلب رابط التنزيل بجلسة **صاحب الشركة** أو **مدير عام** أو **مدير نشاط** للنشاط ده، مع الصلاحيات الصريحة المطلوبة
   ← ينجح للملف الجاهز. مدير نشاط تاني، أو صلاحية اتسحبت/انتهت، أو منع على فرع الملف ← نفس الرد بالظبط زي معرّف مجهول:
   404 **الملف غير موجود** (`FILE_NOT_FOUND`). قارن الـ envelope كله؛ قراءة الحالة كمان ما تكشفش الملف غير المتاح.
   التأكيد مسموح للرافع بس، حتى لو شخص تاني يقدر يقرأ المستند.
8. سيب رفع من غير تأكيد ← يبقى مؤهل للحذف بعد 24 ساعة من إنشائه. سيب ملف اترفض ← يبقى مؤهل للحذف بعد سبعة أيام
   من الرفض. شغل التنظيف كل ساعة، فمش شرط يختفي في نفس ثانية انتهاء المدة؛ بعد التنظيف الطلب يرجع 404
   **الملف غير موجود**. رفع مؤكَّد مستني العامل أو إعادة المحاولة ما يتحذفش كرفع مهجور، والملف `READY` ما يتحذفش بالمدد دي.
9. كل طلب فتح ملف عبر إصدار رابط تنزيل بيتسجل: السماح، وكمان المنع على ملف معروف في الشركة. راجع هوية الفاعل والملف
   والنتيجة في التدقيق، من غير محتوى أو مفتاح أو رابط موقّع. الرفض يفضل 404 قدام المستخدم؛ سجل التدقيق بيتحفظ بعد التنظيف.
   سحب الصلاحية يمنع إصدار رابط جديد، والرابط الصادر قبل السحب يفضل شغال لحد انتهاء الـ 60 ثانية.

**ممنوع يحصل:**
- ملف يتقرأ قبل `READY`؛ امتداد أو نوع معلن كاذب يعدّي الفحص؛ نوع غير PDF/JPEG/PNG أو حجم فوق 10 MiB يتقبل.
- مستخدم يفتح مستند موظف من نشاط/شركة خارج صلاحياته؛ رد الملف غير المتاح يختلف عن المجهول.
- رابط تنزيل يصدر من غير تدقيق؛ رابط أو مفتاح أو محتوى مستند يدخل التدقيق أو اللوجات.
- رفع مؤكَّد يتشال كأنه مهجور؛ ملف جاهز يتحذف بتنظيف المهجور/المرفوض؛ انتهاء المدة يمسح سجل التدقيق.

## English

1. Request an employee-document upload ticket. Send no filename, storage key or URL. Use the real MIME type
   (`application/pdf`, `image/jpeg` or `image/png`) and exact byte length. This example is PDF;
   `owner_module` is `staff` and its stored `required_permission` must be `read:files:business`.

   ```bash
   curl -i -X POST 'https://<API_HOST>/v1/businesses/<BUSINESS_ID>/files/uploads' \
     -H 'Cookie: <SESSION_COOKIE>' \
     -H 'x-company-id: <COMPANY_ID>' \
     -H 'Content-Type: application/json' \
     --data '{"owner_module":"staff","owner_entity_id":"<EMPLOYEE_ID>","content_type":"application/pdf","size_bytes":<EXACT_SIZE_BYTES>,"required_permission":"read:files:business"}'
   ```

   Expect 201 with `id`, `upload_url`, `expires_in: 120` and `headers` containing `content-type` and `content-length`.
   Keep `id` as `<FILE_ID>`; optionally add `branch_id` for a branch of this business.
2. PUT the identical bytes directly to `upload_url` within 120 seconds, using the returned headers exactly.
   Send no API cookie or `x-company-id` to storage. This is a signed PUT; the file is not ready to read yet.

   ```bash
   curl -i -X PUT '<UPLOAD_URL_FROM_TICKET>' \
     -H 'Content-Type: <TICKET_CONTENT_TYPE>' \
     -H 'Content-Length: <TICKET_CONTENT_LENGTH>' \
     --data-binary '@<LOCAL_FILE_PATH>'
   ```

   Expect a successful storage 2xx. If the ticket expires, request another and continue with its new identifier.
3. After a successful PUT, confirm using the same user who requested the upload:

   ```bash
   curl -i -X POST 'https://<API_HOST>/v1/files/<FILE_ID>/confirm' \
     -H 'Cookie: <SESSION_COOKIE>' \
     -H 'x-company-id: <COMPANY_ID>'
   ```

   Expect 202 with `id` and `status: "QUEUED"`. This queues verification; it does not accept the content yet.
   Repeated confirmation is safe.
4. Poll status with the same session until the worker finishes:

   ```bash
   curl -i 'https://<API_HOST>/v1/files/<FILE_ID>' \
     -H 'Cookie: <SESSION_COOKIE>' \
     -H 'x-company-id: <COMPANY_ID>'
   ```

   Expect 200 with `PENDING` or `VERIFYING`, then `READY` or `REJECTED`. `storage_key` appears only for `READY`;
   status contains no signed URL. PDF type/size are checked; JPEG/PNG are fully decoded and re-encoded without metadata.
   Detecting PDF type is not malware scanning.
5. After `READY`, request a download URL and fetch it within 60 seconds:

   ```bash
   curl -i -X POST 'https://<API_HOST>/v1/files/<FILE_ID>/download' \
     -H 'Cookie: <SESSION_COOKIE>' \
     -H 'x-company-id: <COMPANY_ID>'
   curl -f '<DOWNLOAD_URL_FROM_RESPONSE>' -o '<LOCAL_DOWNLOAD_PATH>'
   ```

   The first request returns 200 with `download_url` and `expires_in: 60`, after the audit commits.
   Storage serves the download as an attachment; do not send API session credentials to storage.
6. Download before `READY` or after content rejection → "The file has not passed verification" (`FILE_NOT_READY`, 409).
   A false type produces `REJECTED` with `FILE_TYPE_INVALID`: "The detected file type does not match an allowed upload type";
   a false size produces `FILE_SIZE_INVALID`: "The file size does not match the upload or exceeds its limit";
   unverifiable content produces `FILE_CONTENT_INVALID`: "The file content could not be verified".
   A ticket request above 10 MiB or for an unsupported type is refused immediately with 400 "The request is not valid"
   (`VALIDATION_FAILED`).
7. Repeat download issuance as **Owner**, **General Manager**, or this business's **Business Manager**, with the required
   explicit grants → success for a ready file. Another business's manager, removed/expired access, or a DENY on the file's
   branch → exactly the same response as an unknown identifier: 404 "File not found" (`FILE_NOT_FOUND`). Compare complete
   envelopes; metadata also hides inaccessible files. Only the uploader can confirm, even if someone else can read the document.
8. Leave an upload unconfirmed → eligible for removal 24 hours after creation. Leave a rejected file → eligible seven days
   after rejection. Cleanup runs hourly, so removal need not happen at the exact expiry second; after cleanup, requests give
   404 "File not found". Confirmed uploads waiting/retrying verification are not abandoned; `READY` files are not removed by
   these retention windows.
9. Every file-open request through download issuance is audited: ALLOW and also DENY for a known file in the company.
   Check actor, file and outcome, without content, keys or signed URLs. Denials still appear as 404 to the caller;
   audits survive cleanup. Permission revocation blocks new URL issuance; a URL issued earlier remains usable until its
   60-second expiry.

**Must NOT happen:**
- Reading before `READY`; lying MIME/extension accepted; types outside PDF/JPEG/PNG or files above 10 MiB accepted.
- Opening employee documents outside authorized business/company scope; inaccessible responses differing from unknown ones.
- Unaudited download issuance; signed URLs, keys or document content in audits/logs.
- Confirmed uploads treated as abandoned; READY files removed by abandoned/rejected cleanup; retention removing audits.

## For an agent

- There is no screen or browser selector for this slice. Replay the API sequence above with placeholders substituted locally.
  Run uploads as the uploader; test other readers only after `READY`. Do not execute these examples against real documents.
- Local API base is `http://localhost:3000/v1` ([00](00-local-setup.md)); use the configured API host for other environments.
  Requests to `/v1` carry the session cookie and `x-company-id`; signed storage requests carry only their capability and required headers.
- Alternative download command: `POST /v1/files/download` with strict
  `{ "storage_key": "<VERIFIED_STORAGE_KEY_FROM_READY_STATUS>" }` → the same `{ download_url, expires_in: 60 }`,
  authorization and audit as download by id. Stored employee-document permission is always `read:files:business`.
- Audit assertions cover every successful download capability and a denied attempt on a known tenant file,
  in both `file_access_audit` and canonical `audit_log`. Status polling is metadata; it does not issue an audited download capability.
  A direct storage fetch reuses the already-audited short-lived capability. Unknown/cross-tenant IDs expose no audit data.
- Worker rejection codes in status are `FILE_TYPE_INVALID`, `FILE_SIZE_INVALID`, `FILE_CONTENT_INVALID`;
  status polling itself returns 200 for an accessible rejected row. Their catalog HTTP mappings are 415, 413, 422;
  downloading a rejected row returns 409 `FILE_NOT_READY`.
- Retention tests use synthetic timestamps/worker jobs: abandoned 24 hours, rejected seven days, hourly batches up to 50;
  confirmed/READY objects preserved, removed objects inaccessible, audit tombstones retained. This slice has no READY-file
  deletion/replacement endpoint.
- Missing storage → 503 "Private file storage is not configured" / **تخزين الملفات الخاصة غير مُعدّ**
  (`STORAGE_NOT_CONFIGURED`). Envelope shape: `{ code, message_ar, message_en, details? }`.
- Sources: `docs/specs/014-files-presigned-access/spec.md`, `apps/api/src/modules/files/http/files.controller.ts`,
  its upload/confirm/download use cases and status query, `packages/contracts/src/files.ts`,
  and the `errors`/`roles` entries in `packages/i18n/src/{ar,en}.ts`.
