# 53 · Giving and managing the employee number — إدّي الموظفة رقمها وظبّطه

**Status / الحالة:** row 8c, all merged.
- The screens shipped in #388 (type a number when adding, **Edit number** on the profile, the one-time start dialog) and #380
  (the company screen «الأرقام الوظيفية»).
- The API under them: #335 (automatic number on create), #340 (the Excel import numbers in file order), #372 (hand edit, and the
  new permission `manage:employee-number:company`, migration `0149`), #375 (the company list), #376 (typed number on create and
  its capability read), #377 (the one-time start).
- The storage under all of it: #291 (column, counter table, backfill of existing employees, migrations `0140`–`0143`) and #396
  (stragglers numbered, then the column made `NOT NULL`, migrations `0153`–`0156`).
- On staging since #533 (2026-10-23): admin `https://app.staging.pospay.systems`, demo data only. Not yet walked in a browser
  there (#380 says it was never tried in a browser).

Seeing and searching the number on other screens is [54](54-employee-number-everywhere.md).

**Before you start / قبل ما تبدأ:**
- Locally: [00 Local setup](00-local-setup.md), then `pnpm db:migrate` and `pnpm db:seed`; run `api`, `worker` (for the import)
  and `admin`. On staging: the demo company «صالون الأميرة (تجريبي)», branches Salmiya and Hawalli, 7 employees; the owner gives
  the sign-in privately.
- Sign in as the **owner** and pick the company and business ([01](01-admin-sign-in-and-totp.md),
  [02](02-admin-workspace-selector.md)). The `staff` feature is on.
- The owner holds **إدارة الرقم الوظيفي** / **Manage employee numbers** (`manage:employee-number:company`) by default and can
  give it to any person, never to a device ([12](12-permissions-screen.md)).
- Existing employees already have numbers. **Read them off `/staff` first** (the demo numbers come from the hire-date backfill);
  the examples below assume the last number is `7`, so the next one is `8`.
- Synthetic names only: سارة / Sara, هبة / Heba, منى / Mona, ريم / Reem.

## العربي

1. **رقم لوحده:** في `/staff` دوس **إضافة موظف** ← `/staff/create`. املا **الاسم بالإنجليزية** و**الفرع الأساسي** و**الدور**
   و**تاريخ التعيين**، وسيب **رقم الموظف** فاضي ← **إضافة موظف** ← **تمت إضافة الموظف:** والاسم.
   - رسالة النجاح ما فيهاش الرقم. ارجع `/staff`: سارة واخدة `8`.
   - تاريخ تعيين قديم ما بيغيّرش حاجة: الرقم ماشي بالعدّاد، مش بتاريخ التعيين.
   - طلب اترفض (مثلاً فرع غلط) ما بياكلش رقم.
2. **تكتب الرقم وإنت بتضيف:** حقل **رقم الموظف** بيظهر لما السيرفر يرد إنك تقدر تكتب رقم في **الفرع الأساسي** المختار (أول فرع بيتختار لوحده)، وتحته **اترك الحقل فارغًا ليُسنَد الرقم التالي الشاغر تلقائيًا.**
   - اكتب `1050` لهبة ← هبة `1050`. العدّاد ما اتحركش: منى بعدها من غير رقم بتاخد `9`.
   - اكتب `007` ← بيتحفظ `7` (لو `7` فاضي).
   - `0` أو `1000000` أو حروف ← **أدخل عددًا صحيحًا من 1 إلى 999999. الأصفار البادئة تُزال.** ومفيش حاجة بتتبعت.
   - رقم مستخدم، حتى لموظفة اتمسحت ← **الرقم الوظيفي مستخدم بالفعل لموظف آخر في الشركة.** ومفيش موظفة اتضافت.
   - حد بيضيف موظفين بس معندوش **إدارة الرقم الوظيفي**، أو عليه منع (DENY) على النشاط أو الفرع ده ← الحقل مش ظاهر أصلًا، والموظفة بتاخد رقم لوحدها.
   - تغيير الفرع بيعيد السؤال، فالحقل ممكن يظهر أو يختفي.
3. **الاستيراد من Excel:** القالب ما فيهوش عمود رقم. احفظ استيراد فيه 3 صفوف ([27](27-employee-import.md)) وافتح `/staff`.
   - التلاتة خدوا 3 أرقام ورا بعض، بترتيب الصفوف في الملف، مكمّلين من العدّاد.
   - أي رقم متكتب بالإيد في السكة بيتنط عليه.
   - لو الأرقام خلصت في النص ← **فشل الاستيراد ولم يُحفظ أي موظف.** ومفيش ولا موظفة اتحفظت.
4. **تعدّل رقم موظفة:** في `/staff` دوس **تعديل** على سارة ← الرقم جنب الاسم، وتحته **تعديل الرقم**.
   - الزرار بيظهر بس لو معاك الصلاحية ومفيش منع على نشاطها أو فرعها الأساسي أو أي فرع شغالة فيه.
   - دوس **تعديل الرقم** ← **تعديل رقم الموظف** ← اكتب في **رقم الموظف** ← **حفظ الرقم** ← الحوار بيتقفل والرقم الجديد جنب الاسم.
   - نفس الرقم القديم ← مفيش حاجة بتتكتب ولا سجل تدقيق.
   - رقم مستخدم ← **الرقم الوظيفي مستخدم بالفعل لموظف آخر في الشركة.** والقديم فاضل.
   - التعديل بالإيد ما بيحركش العدّاد. رقم اتساب بتعديل ينفع يتكتب تاني بالإيد؛ رقم موظفة اتمسحت عمره ما بيرجع.
5. **بداية الترقيم، مرة واحدة بس:** في `/staff` دوس **بدء الترقيم من**. الزرار بيظهر بس طول ما البداية لسه ما اتحددتش.
   - الحوار فيه **أرقام الموظفين الحالية تبقى كما هي. الموظفون الجدد فقط يستخدمون هذه البداية، والعدّاد لا يرجع للخلف، والبداية تُضبط مرة واحدة.** و**الرقم التالي**.
   - اكتب `1000` في **رقم البداية** ← **حفظ رقم البداية** ← الحوار بيتقفل والزرار بيختفي.
   - الأرقام القديمة زي ما هي؛ أول موظفة جديدة بتاخد `1000`.
   - بداية أصغر من العدّاد (مثلًا `2` والعدّاد `10`) ← العدّاد فاضل `10`، والبداية بتتسجل إنها اتحددت.
   - محاولة تانية من تاب تاني ← **رقم بداية الترقيم حُدّد مرة واحدة ولا يمكن تغييره.** والزرار بيختفي.
6. **شاشة الأرقام الوظيفية:** من القائمة الجانبية دوس **الأرقام الوظيفية** ← `/staff/employee-numbers` ← **كل موظفي الشركة: الاسم والنشاط والرقم فقط.**
   - الجدول فيه **الاسم** و**النشاط** و**الرقم الوظيفي** بس، وفوقه **بحث بالاسم أو الرقم**.
   - بيعرض موظفات كل أنشطة الشركة، حتى نشاط إنت مش بتفتح شاشة موظفينه.
   - **تعديل** في الصف ← **الرقم الوظيفي** ← **حفظ الرقم** ← الصف بيعرض الرقم الجديد. **إغلاق** بيلغي.
   - رقم مستخدم ← **الرقم الوظيفي مستخدم بالفعل لموظف آخر في الشركة.** والقديم فاضل. رفض ← **لا يمكنك تغيير هذا الرقم الوظيفي.**
   - موظفة عليها منع للصلاحية دي (على نشاطها أو فرعها الأساسي أو فرع شغالة فيه) مش بتظهر خالص.
   - حد من غير الصلاحية: اللينك ظاهر في القائمة، بس الشاشة بتقول **لا يمكنك الاطلاع على الأرقام الوظيفية.**
7. **الموظفات اللي كانوا موجودين:** `pnpm db:migrate` بيدّي كل الموظفات أرقام بترتيب تاريخ التعيين (ولو نفس اليوم، اللي اتضافت الأول)، والمحذوفات كمان.
   - بعد #396 أي موظفة لسه من غير رقم خدت رقم، والرقم بقى إلزامي. مفيش موظفة من غير رقم تاني.

**ممنوع يحصل:**
- رقمين زي بعض في نفس الشركة، حتى لو واحدة منهم محذوفة.
- رقم موظفة محذوفة يتدّى لحد تاني.
- رقم متكتب بالإيد يحرك العدّاد، أو العدّاد يرجع لورا.
- طلب مرفوض ياكل رقم.
- رقم يتكتب أو يتعدل من غير الصلاحية أو تحت منع، أو الرقم المكتوب يتساب بهدوء ويتحفظ رقم تلقائي بداله.
- جهاز (Device) ياخد الصلاحية دي.
- البداية تتحدد مرتين، أو تغيّر رقم موجود.
- شاشة الأرقام الوظيفية تعرض أي حاجة غير الاسم والنشاط والرقم.

## English

1. **An automatic number:** on `/staff` press **Create employee** → `/staff/create`. Fill **English name**, **Primary branch**, **Role**
   and **Hire date**, and leave **Employee number** empty → **Create employee** → **Employee created:** with the name.
   - The success message does not show the number. Back on `/staff`, Sara has `8`.
   - A back-dated hire date changes nothing: the number follows the counter, not the hire date.
   - A refused request (for example a wrong branch) uses up no number.
2. **Typing a number when adding:** **Employee number** appears once the server says you may type a number for the selected **Primary branch** (the first branch is preselected), with **Leave this blank and the next free number is assigned automatically.** under it.
   - Type `1050` for Heba → Heba is `1050`. The counter did not move: Mona, added next with no number, gets `9`.
   - Type `007` → it is saved as `7` (if `7` is free).
   - `0`, `1000000` or letters → **Enter a whole number from 1 to 999999. Leading zeros are removed.** and nothing is sent.
   - A number already used, even by a deleted employee → **This employee number is already used by another employee in the company.** and no employee is added.
   - Someone who can add employees but lacks **Manage employee numbers**, or has a DENY on that business or branch → the field is not shown at all, and the employee gets an automatic number.
   - Changing the branch asks again, so the field can appear or disappear.
3. **The Excel import:** the template has no number column. Commit an import of 3 rows ([27](27-employee-import.md)) and open `/staff`.
   - The three get three numbers in a row, in the file's row order, continuing the counter.
   - A hand-typed number in the way is skipped.
   - If the numbers run out midway → **The import failed. No employees were saved.** and nobody is saved.
4. **Editing a number:** on `/staff` press **Edit** on Sara → the number shows beside the name, with **Edit number** under it.
   - The button shows only if you hold the permission and no DENY covers her business, primary branch or any branch she works in.
   - Press **Edit number** → **Edit employee number** → type in **Employee number** → **Save number** → the dialog closes and the new number is beside the name.
   - The same number as before → nothing is written and no audit row.
   - A used number → **This employee number is already used by another employee in the company.** and the old one stays.
   - A hand edit never moves the counter. A number freed by an edit can be typed again by hand; a deleted employee's number never comes back.
5. **The starting number, once only:** on `/staff` press **Start numbering from**. The button shows only while no start has been set.
   - The dialog shows **Existing employee numbers stay as they are. Only new employees use this start, the counter never moves backward, and the start can be set only once.** and **Next number**.
   - Type `1000` in **Start number** → **Save start number** → the dialog closes and the button disappears.
   - Old numbers stay; the first new employee gets `1000`.
   - A start below the counter (for example `2` with the counter at `10`) → the counter stays `10`, and the start is recorded as set.
   - A second try from another tab → **The starting number was already chosen once and cannot be changed.** and the button disappears.
6. **The employee numbers screen:** in the sidebar press **Employee numbers** → `/staff/employee-numbers` → **Every employee in the company: name, business and number.**
   - The table has only **Name**, **Business** and **Employee number**, with **Search by name or number** above it.
   - It lists employees of every business in the company, even one whose staff screen you cannot open.
   - **Edit** on a row → **Employee number** → **Save number** → the row shows the new number. **Close** cancels.
   - A used number → **This employee number is already used by another employee in the company.** and the old one stays. A refusal → **You cannot change this employee number.**
   - An employee under a DENY on this permission (her business, primary branch or a branch she works in) is not listed at all.
   - Someone without the permission: the link shows in the sidebar, but the screen says **You do not have access to employee numbers.**
7. **Employees who already existed:** `pnpm db:migrate` numbers every employee by hire date (same day: the one added first), deleted ones included.
   - Since #396 any employee still without a number got one, and the number is required. No employee is ever without a number again.

**Must NOT happen:**
- Two employees with the same number in one company, even if one of them is deleted.
- A deleted employee's number given to someone else.
- A hand-typed number moving the counter, or the counter going backward.
- A refused request using up a number.
- A number typed or changed without the permission or under a DENY, or a typed number quietly dropped and an automatic one saved instead.
- A Device holding this permission.
- The start set twice, or changing an existing number.
- The employee numbers screen showing anything besides name, business and number.

## For an agent

- **Admin** (local `http://localhost:3001`, staging `https://app.staging.pospay.systems`):
  - `/staff` (list, **Create employee**, **Start numbering from**, **Edit** per row opens the profile panel), `/staff/create`, `/staff/employee-numbers`.
  - Inputs: add form `#employee-number`, profile dialog `#employee-number-edit`, start dialog `#employee-number-start`.
  - Dialogs are native `<dialog>` (role `dialog`). Refusals are `role="alert"`. Buttons by exact text; the company screen's row button
    has the accessible name **Edit {name}** / «تعديل {name}».
- **API** (session cookie + `x-company-id`; no `Idempotency-Key` on any of these):
  - `POST /v1/businesses/<B>/employees` (`@Authenticated`; `manage:employees:business` checked inside) with optional
    `employee_number` (integer 1…999999). Only when it is present is `manage:employee-number:company` rechecked on the business and
    `primary_branch_id`. Returns 201 with `employee_number`.
  - `GET /v1/businesses/<B>/employee-number-capability?primary_branch_id=<BR>` → `{ can_type_number }`. Needs `manage:employees:business`
    on business + branch (else 403); a branch of another business → 404 `EMPLOYEE_BRANCH_NOT_FOUND`; a non-holder → `false`, not 403.
  - `GET /v1/businesses/<B>/employees/<E>/employee-number-capability` → `{ can_edit_number }` (shipped in #388). An unknown, foreign or
    deleted employee → 200 with `false`.
  - `PUT /v1/businesses/<B>/employees/<E>/employee-number` · `@Require('manage:employee-number:company')` · body
    `{ employee_number }` → `{ employee_id, employee_number }`.
  - `GET /v1/employee-numbers?q=…&cursor=…&limit=…` · `@Require('manage:employee-number:company')` + feature `staff` · items
    `{ employee_id, name_ar, name_en, business_id, business_name_ar, business_name_en, employee_number }` only.
  - `GET /v1/employee-numbering` → `{ next_number, start_number, start_set_at, can_manage }` and `PUT /v1/employee-numbering/start`
    `{ start_number }` · both `@Require('manage:employee-number:company')` + feature `staff`.
- **Errors:** `VALIDATION_FAILED` 400 · `EMPLOYEE_NUMBER_TAKEN` 409 · `EMPLOYEE_NUMBER_EXHAUSTED` 422 ·
  `EMPLOYEE_NUMBER_START_ALREADY_SET` 409 · `NOT_FOUND` 404 (deleted or other-business employee on the `PUT`) · `FORBIDDEN` 403 ·
  `FEATURE_DISABLED` · `EMPLOYEE_BRANCH_NOT_FOUND` 404 · `TRANSACTION_RETRY_REQUIRED` (a unique-index race on create) ·
  `IMPORT_COMMIT_FAILED` (the import ran out of numbers).
- **Assertions:**
  - `employee_number_sequences.next_number` = last automatic number + 1; a typed or edited number leaves it unchanged; a refused
    create leaves it unchanged.
  - Two concurrent creates get two different, consecutive numbers.
  - A hand edit writes one `audit_log` row (entity `employees`, action `employee_number.changed`, before/after); the same number
    writes none. The start writes one row (entity `employee_number_sequences`, entity id = the company id, action
    `employee_number.start_set`).
  - A typed number under a DENY → 403 and no employee row; the same request without the field → 201.
  - After `0156`, inserting an employee with `employee_number` NULL fails (`23502`).
  - A Device never holds `manage:employee-number:company` (`deviceForbidden` in `packages/db/src/system-role-policy.ts`).
- **Sources:**
  - `docs/specs/051-staff-employee-number/spec.md` (EN-Q1…EN-Q16, PP-3.1, PP-4.1, PP-4.2; rows 8c-1…8c-11);
  - `apps/admin/src/staff/{pages,ui,api,model,company-numbers}/`;
  - `apps/admin/app/(dashboard)/staff/{page,create/page,employee-numbers/page}.tsx`;
  - `apps/api/src/modules/staff/http/employee-number*.controller.ts`, `employees.controller.ts`;
  - `packages/db/src/employee-number-allocator.ts`; migrations `0140`–`0143`, `0149`, `0153`–`0156`;
  - `packages/i18n/src/{employee-number-catalog,employee-number-admin-catalog,company-employee-numbers-catalog,permission-codes-catalog}.ts`.
