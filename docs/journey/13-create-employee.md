# 13 · Create employee — إضافة موظف

**Status / الحالة:** shipped in #79 (PR 8). Local only (admin not deployed, issue #54). Your decisions of 2026-10-03
apply: creation grants no access; duplicate names and future hire dates are allowed; contract end cannot precede
hire date; one active employee per user per business; inaccessible references reveal no existence information.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` and `pnpm db:seed` for the employee schema and permission catalog.
- Signed in to the admin with a company and business chosen ([01](01-admin-sign-in-and-totp.md),
  [02](02-admin-workspace-selector.md)); the business has a branch and the company's `staff` feature is enabled.
- The editor needs an explicit effective `manage:employees:business` grant covering the business and primary branch.
  Default role grants, including the owner's, are deferred to PR 7a; creating an employee does not add them.
- Prepare synthetic data: an existing user with an active membership in this company, a second business/branch,
  unknown UUIDs and other-company references for API checks. Use placeholders, never real contact data.

## العربي

1. من القائمة الجانبية دوس **إضافة موظف** ← `/staff/create`، وتظهر شاشة **إضافة موظف**. لو لسه ما اخترتش نشاط،
   اختاره الأول من محدد مساحة العمل ([02](02-admin-workspace-selector.md)).
2. اكتب **الاسم بالإنجليزية** (إلزامي)، وممكن تكتب **الاسم بالعربية (اختياري)**. اختار **الفرع الأساسي** من فروع
   النشاط، و**الدور** (مثلاً **موظف**). الدور هنا بيانات وظيفة؛ حتى اختيار **صاحب الشركة** ما بيدّيش صلاحيات وصول.
3. حط **تاريخ التعيين** (إلزامي، تاريخ ميلادي من غير ساعة)، وسيب **نهاية العقد (اختياري)** و**معرف مستخدم موجود (اختياري)**
   فاضيين في أول تجربة ← **إضافة موظف** ← **تمت إضافة الموظف:** وبعدها الاسم وتاريخ التعيين. اتأكد من الـ API إن
   الموظف اتسجل في النشاط والفرع الصح، وإن ارتباطه بالفرع بيبدأ من تاريخ التعيين.
4. جرّب نفس الاسم تاني من غير ربط مستخدم، وكمان جرّب تاريخ تعيين في المستقبل ← الاتنين ينجحوا بسجلين مختلفين.
   تكرار الاسم مسموح. ما تكررّش الضغط أو تعيد الطلب تلقائيًا لو نتيجته مش واضحة؛ الإنشاء مش بيتمنع بمفتاح idempotency.
5. جرّب **نهاية العقد (اختياري)** قبل **تاريخ التعيين** ← **يجب أن تكون نهاية العقد في تاريخ التعيين أو بعده.**
   (`EMPLOYEE_CONTRACT_END_BEFORE_HIRE`، 400)، ومفيش موظف أو ارتباط فرع أو تدقيق إنشاء يتسجل. نفس اليوم أو بعده مسموح.
6. جرّب **معرف مستخدم موجود (اختياري)** بمستخدم ليه عضوية سارية في الشركة ← ينجح، من غير تغيير عضوياته أو صلاحياته
   أو بيانات دخوله. إنشاء الموظف ما بيدّيش وصول؛ إدارة الوصول خطوة منفصلة وصريحة ([12](12-permissions-screen.md)).
7. اربط نفس المستخدم بموظف تاني في نفس النشاط ← **هذا المستخدم مرتبط بالفعل بموظف نشط في هذا النشاط.**
   (`EMPLOYEE_USER_ALREADY_LINKED`، 409). الربط في نشاط تاني مسموح؛ موظف من غير مستخدم أو موظف محذوف منطقيًا
   ما بيحجزش الربط النشط. طلبين متزامنين لنفس المستخدم والنشاط لازم واحد بس ينجح.
8. **فحوصات من الـ API بس:** مستخدم مجهول أو من شركة تانية أو من غير عضوية سارية ← نفس
   **تعذر ربط المستخدم الموجود.** (`EMPLOYEE_USER_LINK_UNAVAILABLE`، 400). فرع مجهول أو من شركة تانية ← نفس
   **لم يتم العثور على الفرع الرئيسي.** (`EMPLOYEE_BRANCH_NOT_FOUND`، 404). فرع معروف من نشاط تاني في نفس الشركة
   ← **الفرع الرئيسي يجب أن يتبع نشاط الموظف.** (`EMPLOYEE_BRANCH_BUSINESS_MISMATCH`، 400).
   لو نطاق الفرع خارج صلاحيتك، قارن الرد بفرع مجهول خارج نفس نطاقك: الرفض ما يكشفش وجوده.
9. **قراءة من الـ API:** اقرأ الموظف المحفوظ ← 200 بنفس البيانات. موظف مجهول أو غير متاح لصلاحياتك أو من شركة/نشاط
   تاني ← نفس **المسار غير موجود** (`NOT_FOUND`، 404، لمستخدم ليه عضوية سارية في الشركة المختارة).
10. كل إنشاء ناجح بيتسجل في سجل التدقيق بمين أنشأه والبيانات المسموحة. لو بيانات مطلوبة ناقصة أو مش صالحة، الشاشة
    تعرض **راجع بيانات الموظف والتواريخ ومعرف المستخدم.**؛ مفيش حفظ جزئي لو الإنشاء اترفض.

**ممنوع يحصل:**
- إنشاء موظف يدي عضوية أو صلاحية أو بيانات دخول، حتى لو له مستخدم مرتبط أو اختير له دور صاحب الشركة.
- الاسم المكرر أو تاريخ التعيين المستقبلي يترفضوا؛ نهاية عقد قبل التعيين تتقبل.
- مستخدم يبقى مربوط بموظفين نشطين في نفس النشاط؛ فشل يسيب موظف أو ارتباط فرع محفوظ لوحده.
- رد يكشف وجود مستخدم أو فرع غير متاح؛ قراءة موظف من شركة أو نشاط تاني تنجح.

## English

1. Sidebar **Create employee** → `/staff/create`, showing **Create employee**. If no business is selected yet,
   select it through the workspace selector first ([02](02-admin-workspace-selector.md)).
2. Enter **English name** (required), optionally **Arabic name (optional)**. Select **Primary branch** from this
   business's branches and **Role** (for example **Staff**). This role is HR metadata; even choosing **Owner** grants no access.
3. Enter **Hire date** (required, Gregorian date without a time). Leave **Contract end (optional)** and
   **Existing user ID (optional)** empty for the first attempt → **Create employee** → "Employee created:"
   followed by the name and hire date. Read through the API to check the saved business/primary branch and that the
   branch attachment starts on the hire date.
4. Create again with the same name and no user link, then try a future hire date → both succeed with distinct records.
   Duplicate names are allowed. Avoid repeated clicks or automatic retries after an uncertain result; creation has no
   idempotency-key deduplication.
5. Set **Contract end (optional)** before **Hire date** → "The contract end must be on or after the hire date."
   (`EMPLOYEE_CONTRACT_END_BEFORE_HIRE`, 400); no employee, branch attachment or creation audit is saved.
   The same day or a later end is allowed.
6. Set **Existing user ID (optional)** to a user with an active membership in this company → success, without
   changing their memberships, permissions or credentials. Creating an employee grants no access; access management is
   a separate explicit step ([12](12-permissions-screen.md)).
7. Link the same user to another employee in this business → "This user already has an active employee record in this business."
   (`EMPLOYEE_USER_ALREADY_LINKED`, 409). Linking in another business is allowed; an unlinked or soft-deleted employee
   does not reserve the active link. Two simultaneous requests for the same user/business must yield only one success.
8. **API-only checks:** an unknown, other-company or inactive-member user → the same "The existing user could not be linked."
   (`EMPLOYEE_USER_LINK_UNAVAILABLE`, 400). An unknown or other-company branch → the same "The primary branch was not found."
   (`EMPLOYEE_BRANCH_NOT_FOUND`, 404). A known branch from another business in this company →
   "The primary branch must belong to the employee business." (`EMPLOYEE_BRANCH_BUSINESS_MISMATCH`, 400).
   For a branch outside your grant scope, compare with an unknown branch outside that same scope: refusal must not reveal existence.
9. **API read:** read the saved employee → 200 with the same data. An unknown, inaccessible or other-company/business
   employee → the same "Not found" (`NOT_FOUND`, 404, for a caller with active membership in the selected company).
10. Every successful creation is audited with the real actor and allowlisted data. Missing or invalid required input
    shows "Check the employee details, dates and user ID." on the form; a refused creation leaves no partial save.

**Must NOT happen:**
- Creation granting membership, permissions or credentials, even with a linked user or the Owner HR role.
- Duplicate names or future hires refused; contract end before hire accepted.
- Two active employees linked to one user in a business; a failure leaving only an employee or branch attachment saved.
- Responses exposing an inaccessible user/branch; successful employee reads across companies or businesses.

## For an agent

- Admin at `http://localhost:3001/staff/create`; locate controls using the visible labels above. The success text has
  a dynamic name/date suffix. There is no employee-detail screen in this slice; verify the persisted record through the API.
- API (session cookie + `x-company-id`): `POST /v1/businesses/{businessId}/employees` → 201 with
  `{ primary_branch_id, name_en, name_ar: null|string, role_code, hire_date, contract_end: null|string, user_id: null|UUID }`;
  `GET /v1/businesses/{businessId}/employees/{employeeId}` → 200. No `Idempotency-Key` required; no automatic create retries.
- Inspect the synthetic fixture's primary attachment and creation audit using the existing test harness. Compare memberships
  and permission overrides before/after: unchanged. There are no salary, PIN or phone fields on this form.
- Errors use `{ code, message_ar, message_en, details? }`; named statuses above come from
  `apps/api/src/shared/errors.ts`. For branch/user privacy, compare complete envelopes using the same caller and scope.
  Missing management access gives 403; disabled `staff` gives 403; no session gives 401.
- Sources: `docs/specs/013-staff-create-employee/spec.md`, `apps/admin/src/staff`,
  `apps/api/src/modules/staff/http/employees.controller.ts`, `packages/contracts/src/staff/employee.ts`,
  and the `staff`, `roles`, `errors` entries in `packages/i18n/src/{ar,en}.ts`.
