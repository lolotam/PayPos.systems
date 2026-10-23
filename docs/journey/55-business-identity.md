# 55 · Business identity — هوية النشاط

**Status / الحالة:** the screen shipped in #397 (row 27h-5, merged). Underneath it, all merged: the owner-only permission in #365 (27h-1a),
the official names in #384 (27h-1), the settings-owned files in #392 (27h-2), the worker that retires a replaced logo in #393 (27h-3) and
the logo bind and remove in #394 (27h-4).

On staging since #533 (2026-10-23): the admin runs at https://app.staging.pospay.systems with demo data only (company «صالون الأميرة
(تجريبي)»). The **names** part can be tried there. The **logo** part probably cannot: neither `deploy/docker-compose.staging-shared.yml`
nor `deploy/staging.env.example` passes any `STORAGE_*` variable, so an upload should answer `STORAGE_NOT_CONFIGURED` (BI-11). This was
not verified live. Locally the logo needs object storage configured.

The identity is for the official attendance statement (row 27g), which prints the logo and the official name in its header. That
statement is not shipped yet, so today nothing else shows the identity.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` and `pnpm db:seed`. For the logo: the `STORAGE_*` variables of `.env.example`
  set, plus the **worker** and Redis running.
- Sign in and select a company and a **business** ([01](01-admin-sign-in-and-totp.md), [02](02-admin-workspace-selector.md)). No branch is needed.
- Who can use it: the **Owner** by default. The owner can give it to another human role with **Allow** on **Manage business identity** /
  «إدارة هوية النشاط» ([12](12-permissions-screen.md)). A paired device never gets it. Holding `manage:settings:business` alone is not enough.
- A logo: a small PNG of your own (under 10 MB). For step 7, a text file renamed to `.png`.
- Synthetic names only, for example «صالون تجريبي» and "Demo Salon".

## العربي

1. **افتح الشاشة:** من القائمة الجانبية دوس **هوية النشاط** ← `/business-identity` ← العنوان **هوية النشاط** وتحته **الأسماء الرسمية والشعار لهذا النشاط.**
   - البند ده بيظهر في القائمة للمالك أو اللي معاه الصلاحية بس.
   - لو مفيش نشاط مختار بيظهر **اختر النشاط**.
2. **الأسماء الرسمية:** اكتب **الاسم الرسمي بالعربي** «صالون تجريبي» و**الاسم الرسمي بالإنجليزي** "Demo Salon"، ودوس **حفظ الأسماء** ← **تم حفظ الأسماء.**
   - الاسم بيتحفظ من غير المسافات اللي في أوله وآخره.
   - الاسمين اختياريين. لو فضّيت اسم كان محفوظ واتحفظ، بيتمسح.
   - لو دوست حفظ من غير ما تغيّر حاجة: **ما فيش تغيير.**
   - اسم أطول من 255 حرف: **اكتب من حرف إلى 255، أو اترك الاسم الذي غيّرته فارغًا لمسحه.** ومفيش حاجة بتتبعت.
3. **رفع الشعار:** في **الشعار** اختار ملفك في **ملف الشعار** ودوس **رفع الشعار**.
   - هتشوف **جارٍ الرفع…** ← **جارٍ الفحص…** (السيرفر بيفحص المحتوى نفسه) ← **جاهز**.
   - الشعار بيظهر فوق كصورة. النص البديل بتاعها هو الاسم الرسمي، ولو مفيش اسم: **شعار النشاط**.
4. **ملف غلط:** ملف مش PNG ولا JPEG، أو أكبر من 10 ميجا ← **اختر ملف PNG أو JPEG بحجم 10 ميجا على الأكثر.** ومفيش رفع.
5. **الاستبدال:** وفيه شعار، الزرار بقى **استبدال الشعار**. اختار صورة تانية ودوسه ← نفس المراحل ← الشعار الجديد بيظهر.
   - الملف القديم ما بيتمسحش في نفس الطلب. الـ worker بيشيله بعدين (الخطوة 8).
6. **الإزالة:** دوس **إزالة الشعار** ← رسالة **إزالة الشعار؟** و**يُزال الشعار من النشاط، والملف السابق يتقاعد بعد ذلك.**
   - **إلغاء** بيقفلها من غير تغيير.
   - **إزالة** ← **تم إزالة الشعار.** والصورة بتختفي، والزرار بيرجع **رفع الشعار**.
7. **ملف متنكّر:** ملف نصي اسمه `.png` بيعدّي من المتصفح، لكن السيرفر بيكشفه ← **الشعار مرفوض.** ومعاها سبب الرفض، مثلًا **نوع المحتوى لا يطابق نوع الرفع المسموح**. الشعار القديم بيفضل زي ما هو.
8. **الـ worker بيشيل الملف القديم:** مفيش حاجة تدوس عليها. بعد الاستبدال أو الإزالة الملف القديم بيتعلّم إنه هيتمسح، وفي خلال ساعة الـ worker بيمسحه من التخزين.
   - لو حد رجّع نفس الملف شعار قبل كده، ما بيتمسحش.
9. **الصلاحية:** مدير معاه إعدادات النشاط بس (من غير «إدارة هوية النشاط») ← البند مش ظاهر في القائمة. ولو فتح `/business-identity` بإيده ← **غير مسموح بهذا الإجراء** ومفيش فورم.
10. **النطاق:** غيّر النشاط من القائمة الجانبية ← الشاشة بتعرض أسماء وشعار النشاط الجديد بس. كل نشاط ليه هويته.

**ممنوع يحصل:**
- حد غير المالك (أو اللي المالك إداله الصلاحية) يغيّر الأسماء أو الشعار، أو جهاز يغيّرهم.
- ملف مش صورة PNG أو JPEG يبقى شعار، أو ملف لسه بيتفحص يتربط.
- ملف حد تاني، أو نشاط تاني، أو وثيقة موظف، يتربط كشعار.
- الملف القديم يتمسح وهو لسه شعار، أو يفضل في التخزين على طول بعد ما اتشال.
- مفتاح تخزين أو رابط موقّع يتكتب في سجل التدقيق أو في الحدث.

## English

1. **Open the screen:** in the sidebar press **Business identity** → `/business-identity` → heading **Business identity** with **Official names and logo for this business.**
   - The sidebar item shows only for the owner or a holder of the permission.
   - With no business selected it shows **Choose a business**.
2. **Official names:** enter **Official Arabic name** «صالون تجريبي» and **Official English name** "Demo Salon", press **Save names** → **Names saved.**
   - Names are saved trimmed.
   - Both are optional. Emptying a saved name and saving clears it.
   - Saving with no change: **Nothing changed.**
   - A name over 255 characters: **Use 1 to 255 characters, or leave a changed name empty to clear it.** and nothing is sent.
3. **Upload a logo:** under **Logo** choose your file in **Logo file** and press **Upload logo**.
   - You see **Uploading…** → **Verifying…** (the server checks the content itself) → **Ready**.
   - The logo appears as an image. Its alt text is the official name, or **Business logo** when there is none.
4. **Wrong file:** not PNG or JPEG, or over 10 MB → **Choose a PNG or JPEG file up to 10 MB.** and nothing is uploaded.
5. **Replace:** with a logo in place the button reads **Replace logo**. Choose another image and press it → the same phases → the new logo shows.
   - The old file is not deleted inside the request. The worker removes it later (step 8).
6. **Remove:** press **Remove logo** → a dialog **Remove the logo?** with **The logo is removed from this business. The previous file is retired afterwards.**
   - **Cancel** closes it with no change.
   - **Remove** → **Logo removed.** The image disappears and the button reads **Upload logo** again.
7. **A disguised file:** a text file named `.png` passes the browser check, but the server detects it → **The logo was rejected.** with the reason,
   for example **The detected file type does not match an allowed upload type**. The current logo stays as it was.
8. **The worker retires the old file:** nothing to click. After a replace or a remove the old file is marked for deletion, and within the hour
   the worker deletes it from storage.
   - If the same file was bound again first, it is kept.
9. **Permission:** a manager with the business settings permission only (without **Manage business identity**) → no sidebar item. Opening
   `/business-identity` directly → **This action is not allowed** and no form.
10. **Scope:** switch the business in the sidebar → the screen shows that business's names and logo only. Each business has its own identity.

**Must NOT happen:**
- Anyone but the owner (or a person the owner granted the permission to) changing the names or the logo, or a device changing them.
- A file that is not a PNG or JPEG image becoming the logo, or a file still being verified getting bound.
- Another user's file, another business's file or an employee document bound as the logo.
- The old file deleted while it is still the logo, or kept in storage forever after it was removed.
- A storage key or a signed URL written to the audit log or the event.

## For an agent

- **Admin:** local `http://localhost:3001/business-identity`; staging `https://app.staging.pospay.systems/business-identity`. Sidebar link
  **Business identity** / **هوية النشاط**. Credentials come from the owner privately.
  - Inputs `#official-name-ar`, `#official-name-en`, `#business-logo-file`. Buttons by exact text (catalog
    `packages/i18n/src/business-identity-catalog.ts`).
  - Phases and **Names saved.** / **Logo removed.** are `role="status"`; refusals are `role="alert"`. The logo section is
    `aria-label` **Logo** / **الشعار**; the preview is an `<img>` inside it.
- **API** (session cookie + `x-company-id`; no `Idempotency-Key`; no feature flag):
  - `GET /v1/businesses/<B>/settings/identity-capability` (`@Authenticated`) → `{ can_manage_identity }`. Every "no" (non-holder, DENY,
    device, unknown or foreign business) is the same `200 { can_manage_identity: false }`.
  - `GET /v1/businesses/<B>/settings/identity` (`manage:business-identity:business`) → `{ official_name_ar, official_name_en, logo_file_id }`.
  - `PATCH /v1/businesses/<B>/settings/identity` (`manage:business-identity:business`) with `{ official_name_ar?, official_name_en? }`;
    an omitted key is unchanged, `null` clears.
  - `PUT /v1/businesses/<B>/settings/logo` (`manage:business-identity:business`) with `{ file_id: <uuid> | null }`; `null` removes.
  - Upload: `POST /v1/businesses/<B>/files/uploads` with `owner_module: "settings"`, `owner_entity_id: <B>`, `content_type`
    `image/png` or `image/jpeg`, `required_permission: "manage:business-identity:business"` → PUT to the signed URL →
    `POST /v1/files/<ID>/confirm` → poll `GET /v1/files/<ID>` until `READY` or `REJECTED`. Preview: `POST /v1/files/<ID>/download`.
    These files routes are `@Authenticated`; for a settings file they check `manage:business-identity:business` themselves.
  - `GET /v1/businesses/<B>/settings` keeps `read:settings:business` and now also returns the three fields.
- **Errors:** `FORBIDDEN` 403 · `VALIDATION_FAILED` · `FILE_NOT_READY` (PENDING/VERIFYING) · `FILE_NOT_FOUND` (unknown, foreign, staff,
  rejected or purge-started file, all the same) · `FILE_TYPE_INVALID` · `FILE_SIZE_INVALID` · `FILE_CONTENT_INVALID` ·
  `STORAGE_NOT_CONFIGURED` · `STORAGE_UNAVAILABLE`.
- **Assertions:**
  - one `audit_log` row `entity='business_settings'`, `action='settings.identity_changed'` per real change, with before and after; none for
    a re-bind of the same file or a no-op save;
  - one `outbox` row `event_type='BusinessLogoChanged'` per bind or remove, with `previous_file_id` and `file_id` (ids only);
  - after the event, the old row in `file_objects` has `purge_started_at` set; after the hourly `files-cleanup-retired` run it has
    `purged_at` and an `audit_log` row `entity='file'`, `action='retention.deleted'`, `after.reason='retired'`;
  - a manager with `manage:settings:business` only gets 403 on the PATCH and the PUT, and nothing is written;
  - the same file cannot be the logo of two businesses.
- **Sources:**
  - `docs/specs/052-settings-business-identity/{spec.md,owner-questions.ar.md}`, ADR-0046;
  - `apps/admin/src/business-identity/**`, `apps/admin/app/(dashboard)/_frame/business-identity-{route,nav-item}.tsx`;
  - `apps/api/src/modules/settings/{http,use-cases/set-business-logo,use-cases/update-business-identity-names}/`;
  - `apps/api/src/modules/files/http/files.controller.ts`;
  - `apps/worker/src/modules/files/{events/handlers/on-business-logo-changed.ts,jobs/retention.processor.ts}`;
  - `packages/i18n/src/{business-identity-catalog,permission-codes-catalog}.ts`; migrations `0148`, `0150`, `0151`.
