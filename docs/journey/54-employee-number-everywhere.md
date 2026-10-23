# 54 · Seeing and searching the employee number — الرقم الوظيفي في كل الشاشات والبحث بيه

**Status / الحالة:** row 8c, all merged.
- The admin screens shipped in #379 (profile, staff list with its search box, reception performer picker, attendance board and
  monthly report).
- The API under them: #344 (employee detail, staff list, performer picker; the exact `employee_number=N` filter), #371 (the staff
  list search box `q`), #317 (attendance board, monthly report and CSV first column) and its doc follow-up #320.
- The column itself came with #291; since #396 every employee has a number, so no screen shows «—» any more.
- On staging since #533 (2026-10-23): admin `https://app.staging.pospay.systems`, demo data only. #379 was never tried in a
  browser, and nobody has walked it on staging yet.

Giving, typing and changing the number is [53](53-employee-number.md).

**Before you start / قبل ما تبدأ:**
- Locally: [00 Local setup](00-local-setup.md), `pnpm db:migrate`, `pnpm db:seed`, then `api` and `admin`. On staging: the demo
  company «صالون الأميرة (تجريبي)», branches Salmiya and Hawalli, 7 employees; the owner gives the sign-in privately.
- Sign in as the owner, pick the company, business and branch ([01](01-admin-sign-in-and-totp.md),
  [02](02-admin-workspace-selector.md)). Features `staff` and `orders` are on.
- **Read the numbers off `/staff` first.** The examples below use سارة / Sara = `1` and هبة / Heba = `2`; put in the real ones.
- For the board and the report: a few clock-ins in the branch this month ([26](26-clock-attendance.md),
  [30](30-employee-cards-and-clock-by-card.md)). For the picker: the recording screen of [47](47-record-visit-reception.md).

## العربي

1. **ملف الموظفة:** في `/staff` دوس **تعديل** على سارة ← تحت **تعديل الموظف** اسمها وجنبه `1`.
   - الرقم أرقام عادية، من غير فواصل ومن غير أصفار في الأول.
2. **قايمة الموظفين:** في `/staff` أول عمود **رقم الموظف**، وبعده **الاسم** و**الدور** و**الفرع الأساسي** و**تعديل**.
3. **البحث في القايمة:** فوق الجدول مربع **بحث بالاسم أو الرقم**.
   - اكتب `2` ← هبة (رقمها 2)، ومعاها أي موظفة في اسمها «2».
   - اكتب «هبة» ← هبة. واكتب `heb` ← Heba.
   - كلام مالوش نتيجة ← **لا يوجد موظفون في هذه الصفحة.** مش رسالة غلط.
   - البحث بيتبعت بعد ما تبطل كتابة بشوية، وبيرجعك لأول صفحة. لو فضّيت المربع القايمة كلها بترجع.
   - موظفة عليها منع (DENY) في فرعها ما بتظهرش، حتى لو رقمها مطابق.
4. **اختيار الموظفة في تسجيل الزيارة:** افتح `/orders/service-sessions/new` ([47](47-record-visit-reception.md)) واختار خدمة.
   - في **البحث عن الموظفات** اكتب `2` ← في **الموظفة 1** الاختيار مكتوب «هبة (2)».
   - كل اختيار فيه الاسم والرقم بين قوسين. `002` بيلاقي `2` برضه.
5. **لوحة الحضور:** من القائمة الجانبية **لوحة الحضور** ← `/staff/attendance`.
   - في **جوّه دلوقتي** الرقم جنب اسم كل موظفة.
   - في **حضور اليوم** عمود **رقم الموظف**.
6. **التقرير الشهري:** **تقرير الحضور الشهري** ← `/staff/attendance-report` ← اختار **الشهر** و**الفرع** ← عمود **رقم الموظف**.
   - نفس العمود موجود لما تختار **كل الفروع**.
7. **ملف الـ CSV:** دوس **تنزيل CSV** وافتح الملف.
   - أول عمود عنوانه «رقم الموظف»، وتحته رقم كل موظفة. العنوان ده عربي دايمًا، حتى لو الشاشة إنجليزي.
   - لسه مفيش تليفون ولا مرتب ولا آيبان ولا وثائق.
8. **محدش بقى يشوف أكتر من الأول:** اللي ما كانش بيفتح الشاشات دي قبل كده لسه مش بيفتحها؛ الرقم ما فتحش أي حاجة جديدة.

**ممنوع يحصل:**
- الرقم يتعرض بفواصل أو بأصفار في الأول.
- البحث بالرقم يجيب موظفة برة صلاحياتك، أو من نشاط أو شركة تانية.
- بحث مالوش نتيجة يطلع رسالة غلط بدل قايمة فاضية.
- الـ CSV يطلع فيه تليفون أو مرتب أو آيبان أو وثائق.
- شاشة تتفتح لحد ما كانش بيشوفها قبل الرقم.

## English

1. **The employee profile:** on `/staff` press **Edit** on Sara → under **Edit employee**, her name with `1` beside it.
   - The number is plain digits: no separators, no leading zeros.
2. **The staff list:** on `/staff` the first column is **Employee number**, then **Name**, **Role**, **Primary branch** and **Edit**.
3. **Searching the list:** above the table, **Search by name or number**.
   - Type `2` → Heba (number 2), plus any employee whose name contains «2».
   - Type «هبة» → Heba. Type `heb` → Heba.
   - Text that matches nobody → **No employees on this page.**, not an error.
   - The search is sent shortly after you stop typing and goes back to the first page. Clearing the box brings the whole list back.
   - An employee under a DENY on her branch is not shown, even if her number matches.
4. **Choosing a performer when recording a visit:** open `/orders/service-sessions/new` ([47](47-record-visit-reception.md)) and choose a service.
   - In **Search performers** type `2` → under **Performer 1** the choice reads "Heba (2)".
   - Every choice shows the name with the number in brackets. `002` finds `2` too.
5. **The attendance board:** in the sidebar press **Attendance board** → `/staff/attendance`.
   - Under **In now**, the number is beside each name.
   - Under **Daily attendance**, a column **Employee number**.
6. **The monthly report:** **Monthly attendance report** → `/staff/attendance-report` → choose **Month** and **Branch** → a column **Employee number**.
   - The same column is there with **All branches**.
7. **The CSV file:** press **Download CSV** and open the file.
   - The first column is headed «رقم الموظف», with each employee's number under it. That header is always Arabic, even when the screen is in English.
   - Still no phone, salary, IBAN or documents.
8. **Nobody sees more than before:** whoever could not open these screens still cannot; the number opened nothing new.

**Must NOT happen:**
- The number shown with separators or leading zeros.
- A number search returning an employee outside your permissions, or from another business or company.
- A search with no match showing an error instead of an empty list.
- A phone, salary, IBAN or document in the CSV.
- A screen opening for someone who could not see it before the number existed.

## For an agent

- **Admin** (local `http://localhost:3001`, staging `https://app.staging.pospay.systems`):
  - `/staff` (list; **Edit** per row opens the profile panel), `/staff/attendance`, `/staff/attendance-report`,
    `/orders/service-sessions/new`.
  - The staff search is an `input[type="search"]` labelled **Search by name or number** / «بحث بالاسم أو الرقم» (300 ms debounce,
    sends `q`).
  - In the profile heading and the **In now** list the number carries a visually hidden prefix **Employee number** / «رقم الموظف».
  - Picker options read `<name> (<number>)` inside the select labelled **Performer {n}** / «الموظفة {n}».
- **API** (session cookie + `x-company-id`; reads, no `Idempotency-Key`):
  - `GET /v1/businesses/<B>/employees?q=…` (`@Authenticated`; `manage:employees:business` checked inside, DENY wins; feature `staff`).
    Digits only match the exact number **or** the name; other text searches `name_ar`/`name_en`.
  - Same route with `employee_number=N`: an exact filter, **API only, no screen yet** («API بس، لسه مفيش شاشة»).
  - `GET /v1/businesses/<B>/employees/<E>` → `employee_number`.
  - `GET /v1/businesses/<B>/branches/<BR>/service-sessions/performer-options?occurred_at=…&q=…` (`@Authenticated`; access checked
    inside the read, recording or changing performers, PP-19.1) → items carry `employee_number`.
  - `GET /v1/businesses/<B>/branches/<BR>/attendance-board?date=YYYY-MM-DD` · `@Require('read:attendance:branch')` + feature `staff`
    → `in_now[]` and `sessions[]` carry `employee_number`.
  - `GET /v1/businesses/<B>/branches/<BR>/attendance-report?month=YYYY-MM` and `…/attendance-report.csv` ·
    `@Require('read:attendance:branch')` + feature `staff`.
  - All branches: `GET /v1/businesses/<B>/attendance-report?month=YYYY-MM` and `.csv` (`@Authenticated` + the company report guard).
- **Errors:** `VALIDATION_FAILED` 400 (`employee_number=0`, `1000000`, `0x7`, `1e3`; `q` over 100 characters) · `FORBIDDEN` 403 ·
  `FEATURE_DISABLED` · `NOT_FOUND` 404.
- **Assertions:**
  - `q=2` returns the employee numbered 2 and every name containing «2»; `q=nomatch` returns `items: []` with 200.
  - `q` and `employee_number` never return a DENY-hidden employee.
  - Picker: `q=007` finds 7; `q=0` and `q=1000000` match no number.
  - CSV: cell 0 is `"رقم الموظف"` after the BOM, each row starts with the number, and the file has no phone, salary, IBAN or
    `employee_id`.
  - EXPLAIN for the list filter and the picker digit match uses `employees_company_employee_number_key`, no Seq Scan.
- **Sources:**
  - `docs/specs/051-staff-employee-number/spec.md` (EN-Q3, EN-Q9, EN-Q16, D-2, D-3; rows 8c-4, 8c-4b, 8c-5, 8c-9);
  - `apps/admin/src/staff/ui/{employee-profile-heading,employee-table,employee-list-search,attendance-in-now,attendance-session-columns,attendance-report-columns}.tsx`;
  - `apps/admin/src/orders/ui/{session-performers-field,session-performer-row}.tsx`;
  - `apps/api/src/modules/staff/http/{employees,attendance-board,attendance-monthly-report}.controller.ts`, `attendance-monthly-report.csv.ts`;
  - `apps/api/src/modules/orders/http/service-session-form.controller.ts`;
  - `packages/i18n/src/{en,ar,attendance-board-catalog,attendance-report-catalog,service-session-catalog}.ts`.
