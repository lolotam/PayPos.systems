# 21 · Role follow-ups — تكملة صلاحيات الأدوار

**Status / الحالة:** shipped in #93 (PR 7d, merged). Local only (admin not deployed, issue #54).
Customer creation is API-only until the reception UI in PR 35. The 2026-10-04 owner decision gives General Manager
company-level customer creation by default. This extends [12](12-permissions-screen.md), [15](15-discount-limit.md)
and [20](20-role-default-permissions.md): the new discount-limit authorization replaces their earlier requirements,
and the Device restrictions deferred in [20](20-role-default-permissions.md) are now enforced.

**Before you start / قبل ما تبدأ:**
- Complete [12](12-permissions-screen.md) for personal ALLOWs and [15](15-discount-limit.md) for the limit form;
  keep [20](20-role-default-permissions.md)'s company/business management routes. Apply migration
  `0059_2026-10-03_identity-role-followups.sql` with `pnpm db:migrate`; `pnpm db:seed` uses the same defaults/policy.
- Prepare synthetic owner, general manager, business manager, branch manager, cashier and viewer memberships;
  two businesses with branches, a second company's branch, unknown IDs, ordinary target memberships,
  sibling memberships of an editor and a lower membership of an active canonical owner.
- Customer API calls need an authenticated test session, `x-company-id`, the enabled `customers` feature and synthetic
  customer input from [10](10-customer-find-or-create.md). No customer-creation button is implied.
- Discount administrators need separate membership-read access to open the screen: the owner has company reads;
  grant `read:memberships:business` explicitly to BM in their own business. GM has no default membership-read access:
  test their default discount administration through the API. Mutation needs no membership-read/management permission.
  Prepare a paired POS Device and a separately eligible human for [08](08-staff-login-pos.md).
- Use placeholders for sessions, IDs and phone data; replace them only with synthetic fixture values. An agent prepares
  historical forbidden Device ALLOWs and descendant DENYs for negative checks; never change real memberships.

## العربي

1. من **الصلاحيات** ← **عرض** راجع **صلاحيات الدور الافتراضية** للأدوار دي. الأكواد الجديدة تظهر بأسمائها:
   **إنشاء عملاء الشركة**، **إنشاء عملاء من هذا النشاط**، **إنشاء عملاء من هذا الفرع** و**إدارة حدود الخصم الشخصية**.
   الجدول ده تكملة لمصفوفة [20](20-role-default-permissions.md): ✅ افتراضي داخل نطاق العضوية؛ ⚙️ يحتاج **سماح** شخصي؛ ❌ ممنوع.

   | الحالة | إنشاء العميل | إدارة الحد الشخصي لشخص تاني |
   |---|---|---|
   | **صاحب الشركة** النشط الحقيقي | ✅ الشركة/النشاط/الفرع | ✅ داخل الشركة؛ المالك محمي وتعديل الذات ممنوع |
   | **مدير عام** | ✅ `create:customers:company` | ✅ `manage:discount-limits:business` بنطاق الشركة |
   | **مدير نشاط** | ✅ `create:customers:business` في نشاطه بس | ✅ عضويات نشاطه وفروعه؛ مش الشركة ولا نشاط تاني |
   | **مدير فرع** / **كاشير** | ✅ `create:customers:branch` في فرع العضوية بس؛ ❌ إنشاء الشركة | ❌ الكود الجديد |
   | **مشاهد**؛ مثال لباقي الأدوار البشرية المؤهلة | ⚙️ `create:customers:company` بسماح شخصي صريح | ❌ الكود الجديد |
   | Device (`device`)، فحص agent | ❌ أكواد الإنشاء التلاتة | ❌ الكود الجديد وإدارة خصومات الشركة |

2. من جلسة **كاشير**، الـ agent يبعت طلب إضافة العميل لفرع عضويته من الـ API الموضح تحت ← 200 وعميل برقم موبايل مخفي جزئيًا.
   يكرر من جلسة **مدير فرع** لفرعه. بنفس الجلسة والمدخلات، يجرّب فرع تاني حتى لو في نفس النشاط، وفرع شركة تانية، ومعرّف فرع مجهول
   ← نفس 403 **غير مسموح بهذا الإجراء** (`FORBIDDEN`) بنفس جسم الرد. الإذن الفرعي ما يفتحش route إنشاء الشركة.
3. من جلسة **مدير عام** ابعت لنفس route الشركة الموجود في [10](10-customer-find-or-create.md) ← 200 من غير **سماح** شخصي جديد؛
   ده اختيار المالك 2026-10-04. **مشاهد** يتمنع افتراضيًا. من حساب المالك امنحه **إنشاء عملاء الشركة** مع **سماح** بنطاق **الشركة**
   وسبب زي نموذج [12](12-permissions-screen.md)، ثم كرر الطلب ← 200. اسحب السماح وكرر ← 403 **غير مسموح بهذا الإجراء**.
   **مشرف وردية** و**محاسب** و**ويتر** و**مطبخ** و**أمين مخزن** و**موظف** و**تسويق** زي المشاهد: مفيش إنشاء افتراضي؛ يحتاجوا سماح صريح.
4. **مدير نشاط** يضيف من route نشاطه ← 200؛ نشاط تاني أو مجهول ← نفس 403 **غير مسموح بهذا الإجراء**.
   ما ينفعش سماح جديد أو قديم يوسّع مدير النشاط لإنشاء الشركة، أو مدير الفرع/الكاشير لفرع تاني.
   الـ agent يكرر نفس رقم تجربة داخل الشركة من سياقات مصرح بها مختلفة ← نفس معرّف العميل؛ العميل مملوك للشركة، مش نسخة لكل فرع.
5. من **صاحب الشركة** في نطاق **الشركة**، أو **مدير نشاط** معاه إذن القراءة في نطاق **النشاط** بتاعه، افتح **الصلاحيات** ← **عرض** على عضو عادي متاح.
   **حد الخصم (%)** يتفتح بإذن **إدارة حدود الخصم الشخصية** (`manage:discount-limits:business`)؛ مالوش علاقة بمنح
   **إدارة خصومات الشركة** (`manage:discounts:company`) أو إذن تعديل الاستثناءات. كمل نموذج [15](15-discount-limit.md)
   بنسبة تجربة `5.00` و**السبب** ← **حفظ حد الخصم** ← **تم حفظ حد الخصم.** حتى لو تعديل استثناءات الشخص نفسه مقفول.
   كرر تعديل الحد من جلسة **مدير عام** بالـ API: الإذن افتراضي، ومش محتاج إدارة أو قراءة عضويات للحفظ؛ لكن مفيش قراءة عضويات افتراضية تفتح له الشاشة.
   المدير العام والمالك يقدروا يعدّلوا حدود أعضاء الشركة؛ مدير النشاط لعضويات نشاطه وفروعه بس، مش عضوية شركة أو نشاط تاني.
6. على عضويتك، أو عضوية تانية لنفسك، الحقل مقفول. بعد التحقق من صلاحية النطاق بالكامل، محاولة الـ API ←
   **لا يمكنك تعديل صلاحيات عضويتك الشخصية** (`PERMISSION_SELF_EDIT`، 403).
   حد أي شخص مالك نشط، حتى على عضويته الأقل، محمي من الحفظ والتغيير والمسح ←
   **صلاحيات صاحب الشركة محمية من هذا التغيير** (`PERMISSION_OWNER_PROTECTED`، 403). المالك النشط بلا حد خصم.
7. من مدير النشاط جرّب تعديل حد شخص في نشاط تاني أو شركة تانية، أو عضوية شركة، أو عضوية غير نشطة، ثم معرّف مجهول
   ← نفس 403 **غير مسموح بهذا الإجراء** (`FORBIDDEN`). كرر بمدخلات صحيحة ومدخلات غير صحيحة: الرفض ما يكشفش وجود الشخص أو حمايته.
   منع على فرع متأثر بالقرار يقفل تعديل الحد على النطاق الأعلى كمان؛ وجود حقل أو إذن على جزء من النطاق مش كفاية.
8. على fixture الجهاز، الـ agent يحاول يمنح **سماح** لكل كود ملفات أو موظفين أو إنشاء عملاء أو خصومات في القائمة تحت
   ← 403 **لا يمكن منح هذه الصلاحية لهذا الدور النظامي** (`PERMISSION_ROLE_FORBIDDEN`). السماح التاريخي يفضل في التاريخ لكن ما يفتحش وصول.
   **الدخول إلى تطبيق الموظفين** (`login:staff:branch`) يفضل مؤهل للجهاز بدون منحة افتراضية جديدة؛
   كرر [08](08-staff-login-pos.md) لدخول الموظف البشري على جهاز الفرع المربوط: دخوله يفضل شغال بصلاحياته وشروطه المستقلة.
9. كرر تغيير ومسح الحد من [15](15-discount-limit.md) تحت التفويض الجديد. كل حفظ/تغيير/مسح ناجح له تدقيق بالفاعل والسبب والقديم والجديد
   وإبطال للقراءة القديمة في نفس المعاملة. الرفض ما يغيّرش القيمة ولا يضيف تدقيق قرار. منح الأدوار الجديدة ما يمسحش استثناءات أو تاريخ قديم.

**ممنوع يحصل:**
- إنشاء عميل خارج الفرع/النشاط المصرح به، أو اعتبار عميل الشركة ملك لفرع، أو فتح إنشاء الشركة بامتياز إنشاء فرعي.
- تفعيل إنشاء العميل لباقي الأدوار البشرية المؤهلة من غير سماح شخصي، أو إظهار شاشة استقبال قبل PR 35.
- ربط إدارة الحد الشخصي بإدارة الاستثناءات/خصومات الشركة، أو مدير نشاط يعدّل الشركة أو نشاط تاني، أو أي حد يغيّر حد نفسه أو المالك.
- رد يميّز الشخص/الفرع غير المتاح عن المجهول، حتى مع جسم طلب غير صحيح للحد، أو منع فرعي متجاهل عند تعديل النطاق الأعلى.
- الجهاز ياخد الملفات/الموظفين/العملاء/الخصومات بسماح جديد أو تاريخي، أو التضييق عليه يمنع دخول الموظف البشري على الجهاز.
- رفض يغيّر قيمة أو يضيف تدقيق قرار، أو تحديث الافتراضيات يمسح تاريخ القرارات.

## English

1. In **Permissions** → **View**, check these roles' **Role defaults**. The new codes display
   **Create company customers**, **Create customers from this business**, **Create customers from this branch** and
   **Administer personal discount limits**. This extends [20](20-role-default-permissions.md)'s matrix:
   ✅ default within membership scope; ⚙️ explicit personal **Allow** required; ❌ forbidden.

   | Scenario | Customer creation | Administer another person's limit |
   |---|---|---|
   | Active canonical **Owner** | ✅ Company/business/branch | ✅ Within company; owner protected and self-edit forbidden |
   | **General Manager** | ✅ `create:customers:company` | ✅ `manage:discount-limits:business` at company scope |
   | **Business Manager** | ✅ `create:customers:business` in own business only | ✅ Own business/branch memberships; no company or other-business targets |
   | **Branch Manager** / **Cashier** | ✅ `create:customers:branch` in membership's branch only; ❌ company creation | ❌ New code |
   | **Viewer**, example of other eligible human roles | ⚙️ `create:customers:company` with explicit personal ALLOW | ❌ New code |
   | Device (`device`), agent check | ❌ All three creation codes | ❌ New code and company discount management |

2. Using a **Cashier** session, the agent submits the customer API request below for that membership's own branch
   → 200 and a partially masked phone. Repeat as **Branch Manager** in their branch. With the same session/input,
   try another branch even in the same business, another company's branch and an unknown branch ID
   → identical 403 "This action is not allowed" (`FORBIDDEN`) bodies. Branch creation never opens the company route.
3. As **General Manager**, call [10](10-customer-find-or-create.md)'s company route → 200 without a new personal **Allow**:
   the owner's 2026-10-04 decision. **Viewer** is refused by default. As owner, grant **Create company customers**,
   **Allow**, **Company** scope and a reason using [12](12-permissions-screen.md), then repeat → 200.
   Revoke it and repeat → 403 "This action is not allowed". **Shift Supervisor**, **Accountant**, **Waiter**, **Kitchen**,
   **Storekeeper**, **Staff** and **Marketing** follow Viewer: no default creation; explicit ALLOW required.
4. **Business Manager** creates through their own business route → 200; another/unknown business → identical 403
   "This action is not allowed". New or historical ALLOWs cannot broaden business managers to company creation,
   or branch managers/cashiers to another branch. The agent reuses a synthetic phone across authorized contexts
   in one company → the same customer ID: customers remain company-owned, not duplicated per branch.
5. As **Owner** in **Company** scope or **Business Manager** with read access in their own **Business**, open **Permissions**
   → **View** an accessible ordinary member. **Discount limit (%)** is enabled by **Administer personal discount limits**
   (`manage:discount-limits:business`), independently of **Manage company discounts** (`manage:discounts:company`)
   and override-edit permission. Use [15](15-discount-limit.md)'s form with synthetic `5.00` and **Reason**
   → **Save discount limit** → "Discount limit saved.", even when personal override editing is disabled.
   Repeat the mutation through the API as **General Manager**: the default needs no membership-read/management permission to save,
   but GM has no default membership reads to open the screen. Owner/GM can administer company members' limits;
   BM reaches own business/branch memberships, excluding company and other-business memberships.
6. On your own membership or a sibling membership of yourself, the field is disabled. After full scope authorization,
   API mutation → "You cannot edit permissions on your own membership" (`PERMISSION_SELF_EDIT`, 403).
   Every membership of an active owner, including a lower one, refuses set/change/clear
   → "Owner permissions are protected from this change" (`PERMISSION_OWNER_PROTECTED`, 403). Active owners have no limit.
7. As BM, try a limit mutation on another business/company's person, a company membership, an inactive membership,
   then an unknown ID → identical 403 "This action is not allowed" (`FORBIDDEN`). Repeat with valid and invalid bodies:
   refusal reveals neither existence nor protected identity. A DENY on an affected descendant branch also closes
   higher-scope limit editing; a visible field or permission over only part of the target is insufficient.
8. On the Device fixture, the agent tries **Allow** for each file/employee/customer-creation/discount code listed below
   → 403 "This system role cannot receive this permission" (`PERMISSION_ROLE_FORBIDDEN`). Historical ALLOWs stay stored
   but grant no access. **Sign in to staff app** (`login:staff:branch`) remains eligible for Device without a new default grant.
   Replay [08](08-staff-login-pos.md) for a human employee on the paired branch device: sign-in still works under that human's
   independent permissions and eligibility.
9. Replay [15](15-discount-limit.md)'s change/clear checks under the new authorization. Every successful set/change/clear
   atomically audits actor, reason, before/after and invalidates old reads. Refusal changes neither value nor decision audit.
   New role defaults do not erase existing overrides/history.

**Must NOT happen:**
- Creating outside the authorized branch/business, treating company customers as branch-owned, or opening company creation with a scoped code.
- Default creation for other eligible human roles without personal ALLOW, or presenting the reception screen before PR 35.
- Coupling limit administration to override/company-discount management; BM editing company/other-business targets, or anyone editing themselves/owners.
- Distinguishing inaccessible people/branches from unknown ones, including invalid limit bodies; ignoring descendant DENYs.
- New/historical Device ALLOWs opening files/employees/customers/discounts, or these restrictions breaking human staff sign-in on a paired device.
- Refusal changing values/decision audit, or updated defaults deleting decision history.

## For an agent

- Admin: `http://localhost:3001/permissions`. Reuse [12](12-permissions-screen.md)'s grant form and
  [20](20-role-default-permissions.md)'s business routes. Assert exact permission names beside codes.
  `#permission-management-scope` chooses company/business reads; detail exposes `editing_enabled` separately from
  `discount_limit_editing_enabled`. Test an own-business BM with read access and the new default but no membership-management grant:
  overrides disabled, limit enabled for an authorized ordinary target. `#discount-percentage` and `#discount-reason` remain [15](15-discount-limit.md)'s controls.
- Customer API requests use session cookie + `x-company-id`; no `Idempotency-Key`. With synthetic values replacing placeholders:

  ```http
  POST /v1/branches/<OWN_BRANCH_ID>/customers/find-or-create
  Content-Type: application/json
  x-company-id: <COMPANY_ID>
  Cookie: <SYNTHETIC_SESSION_COOKIE>

  { "name": "SYNTHETIC CUSTOMER", "locale": "ar", "phone": { "calling_code": "965", "national_number": "<SYNTHETIC_8_DIGITS>" } }
  ```

  Use `POST /v1/businesses/<OWN_BUSINESS_ID>/customers/find-or-create` for BM;
  `POST /v1/customers/find-or-create` for GM/company ALLOW. Each route requires its own code and `customers` feature.
  Success is 200 with `{ id, name, locale, opted_out, phone }`; `phone` is masked. Shared-company deduplication and input rules remain [10](10-customer-find-or-create.md)'s.
- Limit mutation keeps `POST /v1/permissions/memberships/<MEMBERSHIP_ID>/discount-limit`, even from business-scoped UI,
  with the same cookie/company header and `{ "limit_bps": 500, "reason": "<SYNTHETIC_REASON>" }` → 200 `{ limit_bps: 500 }`.
  Clear uses `limit_bps: null`; integers are 0–10000, reason 1–500 trimmed characters. The server resolves the target scope,
  requires `manage:discount-limits:business` over it and every affected descendant, then rechecks under locks.
  No `manage:memberships:*` or `manage:discounts:company` requirement and no `Idempotency-Key`.
- Compare entire envelopes for unknown/inaccessible customer contexts (403 `FORBIDDEN`) and limit memberships
  (403 `FORBIDDEN`, not the detail-read 404). For limit writes, include inactive, cross-tenant, company/other-business,
  direct/descendant DENY and deleted-company fixtures, each with valid and invalid bodies: guard authorization precedes validation.
  Only fully authorized targets can produce named self/owner failures; an authorized malformed body may return `VALIDATION_FAILED`.
- Device forbidden codes: `read:files:business`, `manage:files:business`, `manage:employees:business`,
  `create:customers:company`, `create:customers:business`, `create:customers:branch`, `manage:discounts:company`,
  `manage:discount-limits:business`. Each new ALLOW → `PERMISSION_ROLE_FORBIDDEN`; historical rows remain inert.
  `login:staff:branch` stays eligible, with no stored Device defaults. No localized Device role label exists;
  select the technical fixture by membership ID. Replay human kiosk sign-in independently, including [08](08-staff-login-pos.md)'s disabled-OTP/PIN rules.
- Assert successful customer creation and limit writes retain their existing atomic audit; refused writes leave values/audit unchanged.
  Defaults/migration preserve custom roles, personal overrides and history. Sources: `docs/specs/022-identity-role-followups/spec.md`,
  `docs/adr/0025-system-role-default-bundles.md` amendment, `packages/db/src/{role-defaults,system-role-policy}.ts`,
  customer controller, identity discount-limit controller/domain/locked transactions/detail projections,
  `apps/admin/src/permissions`, `packages/contracts/src/customers.ts`, `packages/contracts/src/identity`,
  `packages/i18n/src/{ar,en,permission-name}.ts` and `apps/api/src/shared/errors.ts`.
