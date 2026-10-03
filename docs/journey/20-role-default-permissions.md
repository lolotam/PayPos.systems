# 20 · Role default permissions — صلاحيات الدور الافتراضية

**Status / الحالة:** shipped in #91 (PR 7a, merged). Local only (admin not deployed, issue #54).
Your decisions of 2026-10-03/04 apply: default/optional/read-only/forbidden cells, protected canonical Owner,
business-scoped membership delegation, optional human salaries and forbidden Device administration.
This extends [12 The permissions screen](12-permissions-screen.md); customer creation and personal discount-limit
administration for managers are deferred to PR 7d, not shipped here.

**Before you start / قبل ما تبدأ:**
- Complete [12](12-permissions-screen.md) for sign-in, permission editing, reasons, expiry and history.
  Apply migration `0058_2026-10-03_system-role-default-bundles.sql` with `pnpm db:migrate`; `pnpm db:seed` repeats the same matrix.
  Existing system-role memberships receive the updated defaults without new personal overrides; custom roles/history are preserved.
- Prepare synthetic memberships for the table's roles, two businesses with branches, and a business manager scoped to the first.
  Use a separate owner session to delegate; nobody edits their own memberships. Prepare the manager's own-business target membership.
- An agent prepares a technical `device` membership, a custom company role with code/name `owner` and no grants,
  and historical forbidden ALLOW/owner-sibling DENY fixtures. These are fixture checks; no role/membership creation screen is implied.
- Use only synthetic IDs, reasons and sessions. To compare inaccessible decisions, prepare an unknown override ID,
  a decision belonging to the second business and a company-scoped decision on a visible own-business membership.

## العربي

1. من حساب المالك افتح **الصلاحيات**. لو نشاط مختار، محدد **النطاق** أعلى قائمة العضويات يبدأ بـ **النشاط** ومعاه اسم النشاط؛
   اختار **الشركة** عشان تراجع كل عضويات الشركة، حتى لو الشركة فيها نشاط واحد بس. دوس **عرض** على العضوية.
   تحت **صلاحيات الدور الافتراضية** كل إذن يظهر باسمه المترجم وكوده، مثلًا **إدارة أجهزة الفرع** مع `manage:devices:branch`.
   **استثناءات الشخص** و**الاستثناءات المنتهية** يفضلوا منفصلين؛ الافتراضي مش قرار شخصي جديد.
2. راجع أمثلة الجدول من المصفوفة الفعلية. ✅ شغال افتراضيًا داخل نطاق العضوية؛ ⚙️ مقفول لحد **سماح** شخصي صريح؛
   👁 قراءة بس للكود ده؛ ❌ منح السماح مرفوض. الرموز شرح في الرحلة، مش شارات جديدة على الشاشة.

   | الحالة | ✅ مثال افتراضي | ⚙️ مثال محتاج سماح شخصي | ❌ مثال ممنوع |
   |---|---|---|---|
   | **صاحب الشركة** النشط الحقيقي | `manage:memberships:company` | مفيش خانة اختيارية مقفولة في الكتالوج الحالي للمالك | `login:staff:branch`؛ استثناء دخول الموظفين ADR-0019 |
   | **مدير عام** | `create:businesses:company` | `read:salaries:business` | `manage:memberships:company` |
   | **مدير نشاط**، نشاطه مقابل نشاط تاني | `create:branches:business` في نشاطه؛ مش التاني | `manage:memberships:business` في نشاطه بس | `manage:memberships:company`؛ إذن نشاطه ما يفتحش إدارة نشاط تاني |
   | **مدير فرع** | `manage:devices:branch` في فرعه | `manage:settings:business` | `create:businesses:company` |
   | **كاشير** | `read:branches:branch` في فرعه | `login:staff:branch` | `manage:devices:branch` |
   | **مشاهد** | `read:branches:branch`، 👁 قراءة بس | `read:salaries:business` | `manage:devices:branch` |
   | Device (`device`)، فحص agent | مفيش افتراضيات شغالة | `read:files:business` مؤهل حاليًا لحد PR 7d (قرار المالك 2026-10-04: يتمنع) | `manage:schedules:branch` |

   المالك مفيش له مثال ⚙️، والجهاز مفيش له مثال ✅؛ ما نخترعش منح عشان نملأ الجدول. خانة ملفات الجهاز هنا وصف
   لأهلية السماح الموجودة في الكود، مش القرار النهائي؛ المالك قرر 2026-10-04 إن الجهاز يتمنع من الملفات والموظفين والعملاء والخصومات في PR 7d، ودخول الموظفين يفضل مسموح. 👁 ما يدّيش إذن تعديل تلقائيًا.
3. على عضوية **مدير فرع** من حساب المالك وفي نطاق إدارة **الشركة**، راجع إن **إدارة إعدادات النشاط**
   (`manage:settings:business`) مش ضمن **صلاحيات الدور الافتراضية**. باستخدام نموذج [12](12-permissions-screen.md)،
   اختار الإذن و**سماح** ونطاق النشاط المقصود وسبب تجربة ← **حفظ الاستثناء** ← **حُفظ الاستثناء.**
   يظهر تحت **استثناءات الشخص** بس؛ الافتراضيات ما تتغيرش. امنح **عرض إعدادات النشاط** بشكل مستقل لو محتاج القراءة كمان.
   **منع** ساري يغلب افتراضيات غير المالك وأي سماح؛ انتهاء/سحب السماح الاختياري يرجّع الخانة مقفولة.
4. على عضوية **مشاهد** حاول تمنح **إدارة أجهزة الفرع** (`manage:devices:branch`) مع **سماح**، فرع صحيح وسبب ←
   **حفظ الاستثناء** ← **لا يمكن منح هذه الصلاحية لهذا الدور النظامي** (`PERMISSION_ROLE_FORBIDDEN`، 403).
   حتى المالك اللي معاه الإذن ما يقدرش يمنح خانة ❌؛ مفيش قرار أو تدقيق جديد. الـ agent يكرر الرفض على الجهاز
   لكل أكواد قراءة/إدارة الرواتب، جداول الفرع، قوالب النشاط، عضويات الشركة/النشاط، إعدادات النشاط وإدارة أجهزة الفرع.
5. مدير النشاط مش معاه إدارة عضويات افتراضيًا. من حساب المالك، في إدارة **الشركة**، افتح عضوية **مدير نشاط**
   المرتبطة بنشاط التجربة وامنح **عرض عضويات النشاط** (`read:memberships:business`) و**إدارة صلاحيات النشاط**
   (`manage:memberships:business`) كل واحد بقرار **سماح** صريح ونطاق **النشاط** ومعرّف نفس نشاط العضوية وسبب.
   من حساب المدير افتح **الصلاحيات** واختر نشاطه: يشوف عضويات النشاط وفروعه بس. يقدر يعدّل عضو تاني داخل النشاط
   لو هو نفسه يملك الإذن المطلوب، مع بقاء منع تعديل الذات وحماية المالك وقواعد [12](12-permissions-screen.md).
6. من حساب المدير اختار **الشركة** أو جرّب routes نشاط تاني من الـ API ← 403 **غير مسموح بهذا الإجراء** (`FORBIDDEN`).
   حتى المالك، لو حاول يمنح مدير النشاط كود إدارة/قراءة عضويات النشاط بنطاق **الشركة** أو نشاط تاني ←
   **النطاق المطلوب خارج نطاق صلاحيتك** (`PERMISSION_SCOPE_OUTSIDE_REACH`، 403).
   في نموذج إدارة النشاط خيارات القرار هي **النشاط** و**الفرع** بس؛ قرار شركة على عضوية ظاهرة ممكن يتقري لكن
   ما عليهش **سحب الاستثناء**. تعديل الحد الشخصي كمان مقفول في السياق ده؛ إدارة الشركة تفضل متاحة للمالك من المحدد.
7. من الـ API وبنفس جلسة المدير المصرح له داخل نشاطه، حاول تسحب قرار النشاط التاني، أو قرار شركة على عضوية ظاهرة،
   ثم حاول معرف قرار مجهول ← نفس 404 **المسار غير موجود** (`NOT_FOUND`) بنفس الـ envelope.
   القرار غير المتاح ما يكشفش وجوده ولا السبب ولا صاحبه. عضويات الشركة/النشاط التاني مش في قائمة إدارة النشاط؛
   تبديل النطاق ما يسيبش قائمة أو تفاصيل قديمة من النطاق السابق.
8. المالك الحقيقي النشط يحتفظ بكل صلاحيات إدارة الشركة؛ **منع** تاريخي على عضوية تانية لنفس الشخص ما يقلّلش سلطته،
   والتاريخ يفضل محفوظ. محاولة منعه أو استبدال/سحب سماح له تفضل مرفوضة بـ **صلاحيات صاحب الشركة محمية من هذا التغيير**.
   الـ agent يراجع إن دور شركة مخصص اسمه `owner` ما يرثش منح أو حماية المالك؛ الهوية هي دور المالك العالمي الثابت
   بنطاق الشركة الصحيحة، مش الاسم. دخول الموظفين وصلاحيات المنصة لهم قواعد مستقلة، مش سلطة إدارية ضمنية.
9. الرواتب مالهاش منح أدوار مخزنة: المالك الحقيقي تظهر له **قراءة سجل الرواتب** و**تعيين الراتب** كافتراضيات مشتقة.
   كل الأدوار البشرية التانية، حتى **مشاهد**، تقدر تاخدهم بسماح شخصي صريح؛ إدارة الراتب محتاجة القراءة كمان، والوصول
   للشاشة يحتاج إدارة الموظفين زي [18](18-set-salary.md). الجهاز ❌ للاتنين ولأي جدول/قالب أو عضويات أو إعدادات أو إدارة أجهزة.
   سماح قديم محظور يفضل ظاهر في التاريخ/القرارات لكنه ما يمنحش وصول. صلاحيات إنشاء العملاء للمديرين/الكاشير وإدارة
   الحدود الشخصية للمدير العام/مدير النشاط تيجي في PR 7d؛ الأكواد الحالية `create:customers:company` و`manage:discounts:company`
   لسه للمالك بس، وما نستخدمش صلاحية شركة واسعة بدل التفويض الضيق المؤجل.

**ممنوع يحصل:**
- خانة ❌ تتفتح بسماح جديد أو تاريخي؛ صلاحية اختيارية تتعامل كافتراضي؛ قراءة بس تتحول لتعديل من غير إذنه.
- مدير نشاط يدير الشركة أو نشاط تاني، أو يمنح إذن مش عنده؛ تبديل نطاق يعرض بيانات النطاق السابق.
- المالك الحقيقي يتقلّل بمنع تاريخي، أو دور مخصص اسمه `owner` ياخد حماية/منح المالك تلقائيًا.
- الجهاز ياخد رواتب أو جداول/قوالب أو عضويات أو إعدادات أو إدارة أجهزة؛ افتراضيات جديدة تمسح تاريخ القرارات أو تغيّر الأدوار المخصصة.
- رفض يكشف وجود قرار غير متاح أو يكتب قرار/تدقيق؛ وصف PR 7d كأنه متنفذ في PR 7a.

## English

1. As owner, open **Permissions**. With a business selected, the management **Scope** above the membership list starts
   on **Business**, followed by its name. Choose **Company** to review all company memberships, even with only one business.
   **View** a membership: **Role defaults** shows translated names beside codes, for example **Manage branch devices**
   with `manage:devices:branch`. **Personal overrides** and **Ended overrides** remain separate; defaults are not new personal decisions.
2. Check these examples against the real matrix. ✅ is on by default within membership scope; ⚙️ needs explicit personal **Allow**;
   👁 is read-only for that code; ❌ refuses ALLOW grants. These symbols explain the journey; the UI does not add symbol badges.

   | Scenario | ✅ Default example | ⚙️ Explicit personal ALLOW example | ❌ Forbidden example |
   |---|---|---|---|
   | Active canonical **Owner** | `manage:memberships:company` | None: no off optional Owner cell in the current catalog | `login:staff:branch`; ADR-0019 staff-login exception |
   | **General Manager** | `create:businesses:company` | `read:salaries:business` | `manage:memberships:company` |
   | **Business Manager**, own versus other business | `create:branches:business` in own business; not the other | `manage:memberships:business` in own business only | `manage:memberships:company`; own-business access never opens another business |
   | **Branch Manager** | `manage:devices:branch` in own branch | `manage:settings:business` | `create:businesses:company` |
   | **Cashier** | `read:branches:branch` in own branch | `login:staff:branch` | `manage:devices:branch` |
   | **Viewer** | `read:branches:branch`, 👁 read-only | `read:salaries:business` | `manage:devices:branch` |
   | Device (`device`), agent check | None: no enabled defaults | `read:files:business` still eligible until PR 7d (owner decision 2026-10-04: forbidden) | `manage:schedules:branch` |

   Owner has no ⚙️ example and Device has no ✅ example; do not invent grants to fill those cells.
   The Device file cell records existing code eligibility, not the final policy; the owner decided on 2026-10-04 that PR 7d forbids files, employees, customers and discounts for Device, while staff login stays allowed. Read-only never implicitly grants management.
3. As owner in **Company** management, open a **Branch Manager** membership. **Manage business settings**
   (`manage:settings:business`) is absent from **Role defaults**. Use [12](12-permissions-screen.md)'s form to select it,
   **Allow**, the intended business scope and a synthetic reason → **Save override** → "Override saved."
   It appears only under **Personal overrides**; defaults stay unchanged. Grant **Read business settings** separately if reading is needed.
   An active **Deny** beats non-owner defaults and ALLOWs; optional-grant expiry/revocation closes that cell again.
4. On a **Viewer** membership, try **Manage branch devices** (`manage:devices:branch`) with **Allow**, a valid branch and reason
   → **Save override** → "This system role cannot receive this permission" (`PERMISSION_ROLE_FORBIDDEN`, 403).
   Even an owner holding the permission cannot grant a ❌ cell; no decision/audit is added. The agent repeats this for Device salary
   read/manage, branch schedules, business templates, company/business memberships, business settings and branch device management.
5. A business manager has no default membership-management access. As owner in **Company** management, open the **Business Manager**
   membership attached to the fixture business. Grant **Read business memberships** (`read:memberships:business`) and
   **Manage business permissions** (`manage:memberships:business`), each with explicit **Allow**, **Business** scope,
   that membership's business identifier and a reason. As the manager, open **Permissions** for that business:
   only its business/branch memberships appear. Another member can be edited within it only when the manager also holds the target permission;
   self-edit refusal, owner protection and [12](12-permissions-screen.md)'s rules still apply.
6. As manager, select **Company** or call another business's routes → 403 "This action is not allowed" (`FORBIDDEN`).
   Even an owner granting the business membership codes to that manager at **Company** or another-business scope gets
   "The target scope is outside your permission’s reach" (`PERMISSION_SCOPE_OUTSIDE_REACH`, 403).
   The business override form offers only **Business** and **Branch**. Company decisions on visible memberships may be read,
   but have no **Revoke override** control. Personal discount-limit editing is also disabled in this context;
   the scope selector keeps company management available to the owner.
7. API check using the authorized manager's same own-business session: revoke another-business decision, a company decision on
   a visible membership, then an unknown decision ID → identical 404 "Not found" (`NOT_FOUND`) envelopes.
   An inaccessible decision reveals neither existence, reason nor holder. Company/other-business memberships do not appear in the business list;
   changing scope must not retain old list/detail data from the previous scope.
8. An active canonical Owner keeps all company administrative authority. Historical DENYs on sibling memberships cannot reduce it;
   history remains intact. New DENYs or replacement/revocation of an owner's ALLOW remain refused with
   "Owner permissions are protected from this change". The agent verifies that a custom company role named `owner` inherits no
   Owner grants or immunity: identity uses the fixed global Owner role in this company's COMPANY scope, never its name.
   Staff login and platform permissions have independent rules, not implicit administrative authority.
9. Salaries have no stored role grants: the canonical Owner's **Read salary history** and **Set salary** defaults are derived.
   Every other human role, including **Viewer**, can receive explicit personal ALLOWs for both. Manage additionally requires read;
   reaching the panel needs employee-management access as in [18](18-set-salary.md). Device is ❌ for both salaries and every
   schedule/template, membership, settings or device-management code. Historical forbidden ALLOWs stay visible in decisions/history but grant nothing.
   Manager/cashier customer creation and general/business-manager personal discount-limit administration come in PR 7d;
   current `create:customers:company` and `manage:discounts:company` remain owner-only. Never substitute company-wide authority for the deferred scoped codes.

**Must NOT happen:**
- New/historical ALLOW opening a ❌ cell, optional cells treated as defaults, or read-only implying management.
- A business manager administering the company/another business or delegating an unheld permission; scope changes retaining previous data.
- Historical DENYs reducing the canonical Owner, or a custom role named `owner` automatically receiving Owner immunity/defaults.
- Device salary/schedule/template/membership/settings/device-management authority; new defaults rewriting decisions/history or custom roles.
- Refusals revealing inaccessible decisions or writing decisions/audit; presenting PR 7d as implemented in PR 7a.

## For an agent

- Admin: `http://localhost:3001/permissions`. `#permission-management-scope` switches management routes; `#override-scope`
  selects a decision's scope. Keep these controls distinct. Permission options render the exact localized name, ` · ` and code;
  assert the name and code together, using `permissionName`'s mapping. Select the technical `device` fixture by membership ID;
  no localized Device role key exists in `packages/i18n/src/{ar,en}.ts`.
- Company endpoints from [12](12-permissions-screen.md) remain unchanged. Business endpoints use session cookie + `x-company-id`:
  `GET /v1/businesses/{businessId}/permissions/memberships?limit=20` → `{ items, next_cursor }`;
  `GET /.../memberships/{membershipId}?limit=20` → membership, `role_defaults`, catalog, current/ended pages and `editing_enabled`.
  Optional `cursor` and independent `history_cursor` are UUIDs. Reads require `read:memberships:business` at the verified business.
- `POST /v1/businesses/{businessId}/permissions/memberships/{membershipId}/overrides` → 201 with the same strict body as [12](12-permissions-screen.md):
  `{ "permission_code": "<ELIGIBLE_CODE>", "effect": "ALLOW", "scope_type": "BUSINESS", "scope_id": "<OWN_BUSINESS_ID>",
  "reason": "<SYNTHETIC_REASON>", "expires_at": null }`.
  `POST /.../memberships/{membershipId}/overrides/{overrideId}/revoke` with `{ "reason": "<SYNTHETIC_REASON>" }` → 200.
  Writes need `manage:memberships:business` and effective possession across the target scope/descendants. No `Idempotency-Key`.
- Assert own-business delegation works and company/other-business routes remain denied. From an authorized own-business route,
  compare entire status/body for unknown versus inaccessible override IDs, including company decisions visible but not revocable there:
  both are `NOT_FOUND` (404). Detail unknown/inaccessible memberships also match. Grant unknown/inaccessible memberships matches
  the same generic `FORBIDDEN` (403) envelope; do not claim every inaccessible write is a 404.
- Matrix source is `packages/db/src/role-defaults.ts` plus `system-role-policy.ts`, not a synthesized UI bundle.
  Compare seeded/migrated global defaults against every role/catalog cell; salary rows remain absent from `role_permissions`.
  Canonical Owner salary defaults are projected by the detail query. Confirm migration/seed leaves custom roles and personal decisions intact.
- Use existing synthetic regression fixtures to check historical forbidden ALLOWs remain stored/visible but never authorize or delegate;
  owner-sibling historical DENYs stay stored but cannot reduce administrative authority. A custom `owner` role with no grants has no
  authority/protection; ordinary explicit delegation follows PR 7 policy. Company scope and fixed global role identity are required for canonical ownership.
- Device currently has no stored defaults. Its forbidden list covers all salary, schedule/template, membership, settings and device-management
  codes (plus the other explicitly forbidden catalog cells). Five of the later codes stay grantable until PR 7d forbids them (owner decision 2026-10-04; staff login stays);
  the table uses `read:files:business` from that real policy, not a recommendation to grant it. Device fixtures do not imply a human admin login.
- Verify grants/replacements/revokes are audited with actor/reason/before/after and refusal leaves rows/audit unchanged.
  Non-owner DENY/expiry and descendant denial still apply. Scope appears in query keys; switching clears selected detail and uses the right routes.
- Sources: `docs/specs/019-identity-role-default-grants/spec.md`, `docs/adr/0025-system-role-default-bundles.md`,
  `docs/specs/009-identity-permissions-screen/spec.md` (Default bundles), `packages/db/src/{role-defaults,system-role-policy}.ts`,
  `apps/admin/src/permissions`, `apps/api/src/modules/identity/http/business-permissions.controller.ts`, membership queries,
  permission edit/eligibility and owner-access domain rules, permission override use cases/persistence,
  `packages/i18n/src/{ar,en,permission-name}.ts` and `apps/api/src/shared/errors.ts`.
