# 38 · Employee documents are owner-only by default — وثائق الموظفين للمالك فقط افتراضيًا

**Status / الحالة:** shipped in #137 (PR 13b, merge commit `a331fa73`). **No new screen and no new endpoint**: it
changes who can use the employee documents of [13](13-create-employee.md)/[28](28-document-expiry.md) and the private
files of [14](14-private-files.md), plus one new refusal when granting. Staging runs `api` and `worker` at commit
`6c220e4` (2026-10-11), which includes this change and its reference-data migration, so on staging the **API behaviour
is live**; the admin and POS apps are **not deployed** (issue #54), so the admin screens are checked locally. The
default is owner-only: the General Manager and the Business Manager lose, in **every** company at once, the rights to
read files, upload files and manage document types (OD-Q1); the owner gives them back to a chosen **person**, one
person at a time. **Consequence you accepted (OD-Q4):** the employee import upload ([27](27-employee-import.md)) goes
through the same files right, so a manager without a files grant gets 403 when uploading the spreadsheet; the owner
can still import. Owner-defined custom roles and expiry-alert recipients (PR 62) are later rows. Your decisions of
2026-10-09 (OD-Q1 to OD-Q6, the partner chose the same):
[owner-questions.ar.md](../specs/039-permissions-documents-owner-default/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (the migration that deletes five rows from the global
  `role_permissions` bundles; no table changes) and `pnpm db:seed` (the new defaults), then API and admin running, with
  private file storage configured ([14](14-private-files.md)) and the `staff` feature enabled.
- One business with one branch, Salmiya (فرع السالمية), and a synthetic employee سارة (Sara) with **one recorded
  document**, for example a residency copy ([28](28-document-expiry.md) shows the document types).
- Synthetic users, each with their own session cookie:
  - **Owner**.
  - **General Manager** and **Business Manager** (of that business), with no personal grants.
  - **Accountant** (محاسب), with no personal grants. The role can receive the file grants, but it has no employee access
    (`manage:employees:business`), so it never reaches Sara on screen; the screen grant steps (5–6) use the Business Manager.
  - A **Cashier** of the business, for the "only the owner may grant" check, and a Business Manager who also holds
    `manage:memberships:business`.
- The three permissions, as the permissions screen names them ([12](12-permissions-screen.md)): `read:files:business`
  "عرض ملفات النشاط" / "Read business files"; `manage:files:business` "رفع ملفات النشاط" / "Upload business files";
  `manage:document-types:company` "إدارة أنواع وثائق الشركة" / "Manage company document types". By default **only the
  Owner** holds them. A paired Device never holds them.
- Synthetic data only.

## العربي

1. **المالك يشوف ويرفع:** صاحب الشركة يفتح الموظفين (**الموظفون**) ويختار سارة ← قسم **وثائق الموظف** ظاهر وفيه الوثيقة
   وزرار **فتح**، وهو يقدر يرفع وثيقة جديدة (**رفع وتسجيل**). **أنواع الوثائق** تفتح وهو يقدر يضيف ويعدّل.
2. **المدير العام من غير منحة:** نفس الشاشة ← قسم **وثائق الموظف** **مش بيظهر** خالص. من الـ API: قايمة وثائق الموظف ←
   **المسار غير موجود** (`NOT_FOUND`، 404)، ورابط فتح الوثيقة القديمة (اللي اتسجلت قبل الإصدار) ← 404 برضو، ورفع ملف جديد
   (`POST /v1/businesses/<BUSINESS_ID>/files/uploads`) ← **غير مسموح بهذا الإجراء** (`FORBIDDEN`، 403). لسه بيشوف باقي بيانات
   الموظف.
3. **مدير النشاط من غير منحة:** نفس نتيجة المدير العام بالظبط.
4. **أنواع الوثائق:** المدير العام من غير منحة يفتح الرابط **أنواع الوثائق** (لسه ظاهر) ← الصفحة ترد **أنواع الوثائق غير
   متاحة لك.** أو الـ API ← 403 (`FORBIDDEN`)، وما يقدرش يعرض أو يضيف أو يعدّل.
5. **المالك يدي مدير النشاط "عرض" بس:** من **الصلاحيات** ([12](12-permissions-screen.md)) صاحب الشركة يضيف **استثناء جديد** على
   عضوية مدير النشاط: **الصلاحية** = **عرض ملفات النشاط**، **القرار** = **سماح**، **النطاق** = **النشاط** (نشاط السالمية)،
   **السبب** (إلزامي) ← **حفظ الاستثناء** ← **حُفظ الاستثناء.** مدير النشاط
   (معاه `manage:employees:business` من دوره، فيقدر يوصل لسارة) دلوقتي يفتح سارة ويشوف الوثيقة ويفتحها، لكن **ما يقدرش يرفع** (الزرار مش بيشتغل والـ API ← 403).
6. **منحة الرفع:** المالك يضيف كمان **رفع ملفات النشاط** لنفس النشاط ← مدير النشاط يرفع وثيقة وتتسجل. على نشاط تاني لسه
   ← **المسار غير موجود** (404). المنحة بتسري على كل الأدوار البشرية الـ 13، والـ Device لأ: سماح لعضوية Device ←
   **لا يمكن منح هذه الصلاحية لهذا الدور النظامي** (`PERMISSION_ROLE_FORBIDDEN`، 403).
7. **مدير يستلم منحة أنواع الوثائق:** المالك يدي المدير العام **سماح** على **إدارة أنواع وثائق الشركة** (نطاق الشركة) ←
   يقدر يضيف نوع جديد. بعد ما المالك **يسحب** المنحة ← يرجع يتقفل عليه لما يعمل reload.
8. **المالك بس هو اللي يمنح:** مدير نشاط معاه منحة ملفات ومعاه `manage:memberships:business` يحاول يدّي الكاشير **عرض ملفات
   النشاط** ← **صاحب الشركة فقط يقدر يمنح الصلاحية دي** (`PERMISSION_OWNER_ONLY`، 403). نفس الرد لو حاول يمنح **رفع ملفات
   النشاط** أو **إدارة أنواع وثائق الشركة**، ولأي دور. شاشة الصلاحيات لسه بتعرض الأكواد دي لأي واحد بيعدّل، بس الحفظ هو
   اللي بيترفض. **المنع** (Deny) والسحب لسه بيمشوا بالقواعد القديمة.
9. **استيراد الموظفين:** مدير عام من غير منحة يرفع جدول الاستيراد ([27](27-employee-import.md)) ← 403. صاحب الشركة يرفع
   ويعاين ويعتمد زي الأول. مدير عام اتمنح عرض ورفع الملفات للنشاط ← يشتغل (وبرضه محتاج `manage:employees:business` وهو معاه).
10. **اللي ما اتغيرش:** استثناءات الأشخاص (منح أو منع) والعضويات والسجل ما اتلمسوش. منحة اتدّت قبل كده لدور اتأهّل دلوقتي
    بتبدأ تشتغل. المالك مفيش منع شخصي يقدر يقلّل صلاحياته.

**ممنوع يحصل:**
- مدير عام أو مدير نشاط (أو محاسب) من غير منحة شخصية يعرض أو يفتح أو يرفع وثيقة موظف أو ملف، أو يدير أنواع الوثائق.
- حد غير صاحب الشركة يحفظ **سماح** على أي من الأكواد التلاتة.
- رد يفرّق بين وثيقة موجودة مش ليك ووثيقة مش موجودة (لازم 404 في الاتنين).
- منحة تسري على Device، أو على نشاط تاني غير اللي المالك اختاره.
- تغيير في استثناءات أو عضويات أو سجل موجود بسبب الإصدار.
- أي واحد من المديرين الاتنين يحتفظ بالصلاحية بعد الإصدار من غير ما المالك يدّيها.

## English

1. **The Owner sees and uploads:** the Owner opens **Employees** (الموظفون) and picks Sara → the **Employee documents**
   (وثائق الموظف) section is shown with the document and an **Open** button, and she can upload a new one (**Upload and
   record**). **Document types** opens and she can add and edit.
2. **The General Manager with no grant:** the same screen → the **Employee documents** section is **not shown** at all.
   From the API: the employee's document list → "Not found" (`NOT_FOUND`, 404), the link request for the older
   document (recorded before the release) → 404 too, and uploading a new file
   (`POST /v1/businesses/<BUSINESS_ID>/files/uploads`) → "This action is not allowed" (`FORBIDDEN`, 403). He still sees
   the rest of the employee record.
3. **The Business Manager with no grant:** exactly the same as the General Manager.
4. **Document types:** the General Manager with no grant opens the **Document types** link (still visible) → the page
   answers "Document types are not available to you.", or the API → 403 (`FORBIDDEN`); he cannot list, add or edit.
5. **The Owner gives the Business Manager "view" only:** on **Permissions** ([12](12-permissions-screen.md)) the Owner adds a
   **New override** on the Business Manager's membership: **Permission** = **Read business files**, **Decision** = **Allow**,
   **Scope** = **Business** (the Salmiya business), **Reason** (required) → **Save override** → "Override saved."
   The Business Manager (who has `manage:employees:business` from the role, so Sara is reachable) can now open Sara, see the
   document and open it, but **cannot upload** (the button does nothing and the API → 403).
6. **The upload grant:** the Owner also adds **Upload business files** for the same business → the Business Manager uploads a
   document and it is recorded. On another business he is still refused ("Not found", 404). The grant works for all 13
   human roles, and not for a Device: an Allow on a Device membership → "This system role cannot receive this
   permission" (`PERMISSION_ROLE_FORBIDDEN`, 403).
7. **A manager receives the document types right:** the Owner gives the General Manager an **Allow** on **Manage
   company document types** (Company scope) → he can add a type. After the Owner **revokes** the grant → it closes
   again for him on reload.
8. **Only the Owner grants:** a Business Manager who holds a files grant and `manage:memberships:business` tries to give
   the Cashier **Read business files** → "Only the company owner can grant this permission"
   (`PERMISSION_OWNER_ONLY`, 403). The same answer for **Upload business files** or **Manage company document types**,
   for any role. The permissions screen still lists these codes for any editor; it is the save that is refused. **Deny**
   and revoke follow the old rules.
9. **Employee import:** a General Manager with no grant uploads the import sheet ([27](27-employee-import.md)) → 403.
   The Owner uploads, previews and commits as before. A General Manager granted read and upload files for the business →
   it works (he also needs `manage:employees:business`, which he has).
10. **What did not change:** personal overrides (allow or deny), memberships and history were not touched. A grant that
    was given earlier to a role that is now eligible starts to count. No personal Deny can reduce the Owner's authority.

**Must NOT happen:**
- A General Manager, Business Manager or Accountant without a personal grant listing, opening or uploading an employee
  document or file, or managing document types.
- Anyone but the company Owner saving an **Allow** on any of the three codes.
- A response that tells an existing document you may not see from one that does not exist (404 for both).
- A grant that applies to a Device, or to a business other than the one the Owner chose.
- Any existing override, membership or history row being changed by the release.
- Either manager keeping the right after the release without the Owner granting it.

## For an agent

- Roles and the rule live in `packages/db/src/role-defaults.ts` (`ROLE_DEFAULTS`, and the exported
  `OWNER_GRANTED_PERMISSIONS`), `packages/db/src/system-role-policy.ts` and
  `apps/api/src/modules/identity/domain/permission-edit.ts`. The stored defaults are the global rows of
  `role_permissions` (`role_owner_key = 'global'`).
- Employee documents (session cookie + `x-company-id`):
  - `GET /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/documents` → 200 for the Owner (and for holders of
    `read:files:business` at that business); a caller without the right → 404 `NOT_FOUND` identical to an unknown id.
  - `POST /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/documents` (record; needs `Idempotency-Key`) → recording
    needs read **and** upload files at the business ([14](14-private-files.md)).
  - `POST /v1/businesses/<BUSINESS_ID>/files/uploads` → 403 `FORBIDDEN` without `manage:files:business`;
    `POST /v1/files/<FILE_ID>/download` (the link request) → 404 without read.
  - Document types: `GET|POST /v1/document-types`, `PATCH /v1/document-types/<TYPE_ID>`, `POST
    /v1/document-types/<TYPE_ID>/deactivate|reactivate` → 403 without `manage:document-types:company`.
- Grant (Owner's session only) → 201:

  ```http
  POST /v1/permissions/memberships/<MEMBERSHIP_ID>/overrides
  x-company-id: <COMPANY_ID>
  Content-Type: application/json

  { "permission_code": "read:files:business", "effect": "ALLOW", "scope_type": "BUSINESS",
    "scope_id": "<BUSINESS_ID>", "reason": "<SYNTHETIC_REASON>", "expires_at": null }
  ```

  The same body from any non-owner editor, for `read:files:business`, `manage:files:business` or
  `manage:document-types:company` with `ALLOW` → 403 `PERMISSION_OWNER_ONLY` (`message_en` "Only the company owner can
  grant this permission", `message_ar` «صاحب الشركة فقط يقدر يمنح الصلاحية دي»); against a Device membership → 403
  `PERMISSION_ROLE_FORBIDDEN`. `DENY` and revoke by a non-owner keep the existing result. The business-scoped
  permissions route behaves the same.
- Admin: `http://localhost:3001/staff` (the **Employee documents** section appears in the selected employee's panel for
  holders only; the **Document types** link at `/staff/document-types` stays visible) and
  `http://localhost:3001/permissions`. Screen text is quoted from `packages/i18n/src/employee-documents-catalog.ts`
  and `permission-codes-catalog.ts`.
- Assertions: the three codes exist in `role_permissions` for the `owner` role only (the General Manager and the
  Business Manager bundles lost 5 rows in total, and no other row, override, membership or custom-role row changed); an
  accountant, kitchen, cashier or any of the 13 human roles can receive an Allow of the three codes from the Owner, and a
  Device cannot; with no grant, documents list, link and record give 404/403 as above, never a different envelope for
  "exists but not yours"; with a business-scoped grant, another business is refused with the same 404; a revoke takes
  effect on the next request; the employee import upload is 403 for a manager without a files grant. Sources:
  `docs/specs/039-permissions-documents-owner-default/spec.md`, `packages/db/src/role-defaults.ts`,
  `packages/db/src/system-role-policy.ts`, `apps/api/src/modules/identity/domain/permission-edit.ts`,
  `apps/api/src/modules/staff/http/employee-documents.controller.ts`,
  `apps/api/src/modules/staff/http/document-types.controller.ts`, `apps/api/src/shared/errors.ts`.
