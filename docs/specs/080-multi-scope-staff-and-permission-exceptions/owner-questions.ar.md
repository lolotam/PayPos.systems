# أسئلة وقرارات المالك — المواصفة 080 (`PR-Q9`): توسيع الفروع والأنشطة والأدوار واستثناءات الصلاحية عند إنشاء المستخدم

> مصدر القرارات: بطاقة المالك **وليد** في محادثة المدير بتاريخ `2026-11-26 ~09:30 بتوقيت الكويت`، وتأكيده بتاريخ `2026-11-27 17:05 الكويت` (`«YES , YES , YES»`, `PP-280`)، ورد الشريك **أبو سالم** على الدفعة 106 بتاريخ `2026-11-27T13:51:28.130Z`.  
> تم فصل هذا النطاق عن [المواصفة 079](../079-auth-otp-recovery-and-brand-logo/spec.md) تطبيقاً لقرار المدير (`2026-11-26 14:00 الكويت`) حفاظاً على حد الأسطر (`PP-273` — ≤ 1,500 سطر إنتاج لكل PR).  
> حالة النشر: بند المنتج `PR-Q9` نُشر على صفحة القرارات ضمن **الدفعة 106** بالرمز `079-Q9` ووافَقَ عليه **أبو سالم** بالكامل (`«الأربعة كلهم.»`، اختيار `0` مطابق لاختيار وليد، قرار نهائي). الأسئلة التقنية [`TQ-080-1..3`](./spec.md#3-open-design-questions-to-resolve-before-planning-implementation) مسجّلة أدناه (`TQ-080-1` مؤكَّد من وليد `2026-11-27 17:05` مع حفظ الاختيار المفوَّض السابق كتاريخ، و`TQ-080-2` و`TQ-080-3` محسومان من الكود — لا تُنشر الأسئلة التقنية على صفحة القرارات).

---

## قرار المالك المسجّل حرفياً (`PR-Q9` / `079-Q9` — الدفعة 106)

**السؤال:** «وممكن نعطي لهذا المستخدم ...» عند إنشاء حسابه؟

**الإجابة الحرفية (وليد، كارت متعدد الاختيارات، 2026-11-26 ~09:30 الكويت):**
اختار وليد الخيارات الأربعة كلها:
1. `«صلاحيات زيادة فوق دوره»`
2. `«أكتر من فرع»`
3. `«أكتر من نشاط»`
4. `«أدوار أكتر للعامل»`

**إجابة أبو سالم الحرفية (`plan.pospay.systems` — الدفعة 106، `079-Q9`، `2026-11-27T13:51:28.130Z`):**
- `verdict: "ok"`, `choice: 0`, `text: ""` — **«الأربعة كلهم.»** (مطابق لاختيار وليد؛ قرار نهائي مُلزم متّسق بالكامل مع `080-a` المدموجة و`080-b`).

**التفصيل المعتمد للنطاق:**
- إتاحة اختيار أكثر من فرع وأكثر من نشاط (ضمن نفس الشركة) وأدوار إضافية للعامل عند الإنشاء.
- إظهار قسم «استثناء صلاحية» مباشرة في شاشة إنشاء المستخدم بالآلية نفسها المعتمدة في شاشة الصلاحيات (`permission_overrides` في المواصفة `009`)، دون استحداث نظام صلاحيات موازٍ ودون كسر حدود `076 D8` لعزل حساب الموظف الاصطناعي.

**نوع القرار وأثر صفحة القرارات:** **قرار منتج وصلاحيات** — نُشر في **الدفعة 106** (`079-Q9`) وحُسم بموافقة وليد وأبو سالم معاً («الأربعة كلهم.»).

---

## الأسئلة التقنية (`TQ-080-1..3`) — تقنية لا تُنشر على صفحة القرارات

### 1. `TQ-080-1` — صلاحية الداعي لتعدد النطاقات و«أدوار أكتر» و«استثناء صلاحية» وقت دعوة العضو (`080-a`)

- **السؤال:** هل تُقصر دعوة العضو متعددة الفروع/الأنشطة و«أدوار أكتر» و«استثناء صلاحية» على مالك الشركة (`owner` عبر `manage:memberships:company`)، أم يُسمح أيضاً لمدير عام أو مدير نشاط مفوَّض بنطاق مفلتر؟
- **الخيارات:**
  1. **`owner` فقط (`المقترح`)** — تبقى بوابة الدعوة محصورة في مالك الشركة وفق `076 IM-Q1` و`authorityAllows`.
  2. **توسيع جزئي** لمدير عام / مدير نشاط مفوَّض بنطاق مفلتر.
- **الاختيار المفوَّض السابق (تاريخ — اختيار المدير بتفويض وليد، `2026-11-27 ~13:15 الكويت`):** **`owner` فقط (`المقترح`)**.
- **تأكيد المالك والحالة النهائية:** **مؤكَّد من وليد `2026-11-27 17:05` (محادثة المدير، «YES , YES , YES»، `PP-280`)** — الدعوة متعددة النطاقات واستثناءات الصلاحيات inline للمالك (`owner`) بس. (سؤال تقني لا يُنشر على صفحة القرارات).
- **أهم مواضع الكود ذات الصلة:**
  - `apps/api/src/modules/identity/persistence/member-invitation-records.ts:61-80` (`authorityAllows`: تشترط `canonicalOwnerSql('m', companyId)` و`manage:memberships:company` بدون `DENY`).
  - `apps/api/src/modules/identity/persistence/member-invitation-transactions.ts:40-47, 169, 199, 235, 393` (استدعاء `authorityAllows` داخل معاملات `authorize` / `open` / `complete` / `claimLink` / `claimReissue` / `abandonStale`).
  - `apps/api/src/modules/identity/persistence/member-invitation-records.ts:83-98` (`scopeBelongs`: التحقق من تبعية كل نشاط/فرع للشركة).
  - `apps/api/src/modules/identity/domain/permission-edit.ts:6-32, 154-208` (`OWNER_GRANTED_PERMISSIONS` و`OWNER_ONLY_EDIT_PERMISSIONS` و`permissionEditFailure` مع `editorIsCompanyOwner = true`).
  - `apps/admin/src/permissions/api/use-invitations-access.ts` و`apps/admin/src/permissions/pages/invitations-page.tsx:26, 36` (قصر الشاشة في الإدارة على المالك).

### 2. `TQ-080-2` — تعدد العضويات لنفس `user_id` عبر الفروع، ومبدّل فروع الـ POS، و`employee_staff_access.membership_id`

- **الحالة:** **`ANSWERED` من الكود (`2026-11-27`) — سؤال تقني لا يُنشر على صفحة القرارات.**
- **الحكم من الكود (`origin/main`):**
  1. **مقيّم العضويات والصلاحيات يدعم تعدد العضويات اليوم بلا تعديل:**
     - `packages/db/schema/identity-access.ts:115-181` (خصوصاً `line 164`): لا يوجد أي قيد تفرد على `(company_id, user_id)`؛ يمكن حمل أكثر من عضوية فعّالة في فروع أو أنشطة مختلفة.
     - `apps/api/src/modules/identity/persistence/access-reader.ts:196-245` (`readAccessTransaction`): يقرأ كل صفوف `memberships` النشطة للمستخدم ويجمع بـ `UNION ALL` كل `role_permissions` و`permission_overrides` المرتبطة بها.
     - `apps/api/src/modules/identity/domain/access.ts:44-80` (`evaluateAccess`): يقيّم كل المنح المغطية للهدف (`DENY` يغلب على أي نطاق مغطٍ، ويكفي `ALLOW` واحد).
     - `apps/api/src/modules/identity/domain/staff-eligibility.ts:11-24` (`staffEligible`): يفحص `memberships.some(...)` لتغطية فرع الجهاز مع `login:staff:branch`.
  2. **مسار `/v1/me/workspaces` يدعم تعدد العضويات والأنشطة/الفروع اليوم بلا تعديل:**
     - `apps/api/src/modules/identity/queries/my-workspaces.query.ts:82-161` و`apps/api/src/modules/tenancy/queries/describe-workspaces.query.ts:44-110`: يمرر كل نطاقات عضويات المستخدم في الشركة إلى `describeWorkspaces` التي توحد الفروع (`branchHit`) والأنشطة (`businessHit`) عبر `UNION`.
  3. **مبدّل الفروع في الـ POS (`POS branch selector`):**
     - في وضع جهاز الاستقبال (`apps/pos/src/app/device-body.tsx:55-62`، `apps/pos/src/app/reception-body.tsx:58-70`): الجهاز مقترن بفرع واحد ثابت، وتدخل الموظفة على جهاز أي فرع تغطيه إحدى عضوياتها.
     - في الوضع الشخصي (`/v1/staff/me/branches`): الواجهة تعرض `<select>` جاهزاً عبر `LeaveBranchSelector` (`apps/pos/src/my-leave/ui/branch-leave.tsx:56-72` و`leave-branch-selector.tsx:5-28`)، لكن القارئ في الخادم `readPersonalBranches` (`apps/api/src/modules/staff/queries/personal-branches.query.ts:30-66`) يقاطع `memberships` مع جدول `employee_branches`؛ لذلك يجب في `080-b` مزامنة الفروع الإضافية للموظفة داخل `employee_branches` بجانب `memberships`.
  4. **حد `employee_staff_access.membership_id` (خاص بـ `080-b` فقط — لا يلمسه `080-a`):**
     - `packages/db/schema/staff-access.ts:38, 61, 78-82`: يوجد `UNIQUE(company_id, employee_id)` وعمود `membership_id` مفرد؛ و`followPrimaryBranch` (`apps/api/src/modules/staff/persistence/employee-access-branch-follow.ts:29-45`) و`endStaffMembership` (`apps/api/src/modules/identity/persistence/staff-user-auth.ts:222-238`) يعتمدان على `membership_id` مفرد (بخلاف `EndMembership` في `apps/api/src/modules/identity/persistence/end-membership-transactions.ts:66-74` الذي يفحص `user_id` أيضاً). لذا يُعالج `080-b` إما بجدول ربط أو بإدارة كل عضويات `user_id` في الشركة.
     - **حكم `080-a` (`G1`):** لا يلمس `employee_staff_access`؛ عمود `member_invitations.membership_id` (`packages/db/schema/identity-invitations.ts:32, 49-53`) يحتفظ بالعضوية الأساسية، وتُكتب العضويات الإضافية والاستثناءات في نفس معاملة `completeInvitation` بدون أي Migration.

### 3. `TQ-080-3` — سقف أدوار الحساب الاصطناعي (`staff-*@staff.pospay.invalid`) مقابل أدوار الإدارة الخلفية

- **الحالة:** **`ANSWERED` من الكود (`2026-11-27`) — سؤال تقني لا يُنشر على صفحة القرارات.**
- **الحكم من الكود (`origin/main`):** **لا يمكن** أن يحصل الحساب الاصطناعي (`staff-*@staff.pospay.invalid`) على `general_manager` أو `accountant` (أو `business_manager` / `branch_manager`) من «أدوار أكتر»، لأن الحساب محجور تماماً عن جلسات الإدارة الخلفية بموجب قرار `076 D8` عبر 6 حواجز صريحة:
  1. `packages/auth/src/staff-access-users.ts:183-213` (`staffUserD8Hooks`): يرفض أي إنشاء/تعديل `account` (`STAFF_USER_CREDENTIAL_REFUSED`) وأي جلسة عادية بلا `purpose` (`STAFF_USER_SESSION_REFUSED`) لأي مستخدم يحمل `staff_access_operation_id` (`packages/db/schema/identity-auth.ts:46-49, 67-69`).
  2. `packages/auth/src/__tests__/staff-access-d8.spec.ts:51-58`: يرفض `auth.getSession` أي جلسة عادية لحساب موظفة حتى مع كوكي موقَّع.
  3. `packages/auth/src/password-reset-otp/api.ts:52-53, 130` (`credentialAccount`): يحظر استعادة/تعيين كلمة المرور للحساب الاصطناعي (`staffAccessOperationId === null && !isStaffSyntheticEmail(email)`).
  4. `apps/api/src/modules/identity/use-cases/invite-member/invite-member.ts:127-133` و`packages/auth/src/member-invitations.ts:75-84, 141-152`: يرفضان دعوة البريد الاصطناعي (`isStaffSyntheticEmail`) أو أي حساب موجود (`N1` / `MEMBER_EMAIL_NOT_INVITABLE`).
  5. `packages/db/schema/staff-access.ts:89-92` (`employee_staff_access_role_code` CHECK `role_code IN ('staff', 'reception')`) و`apps/api/src/modules/identity/domain/staff-access-roles.ts:8-21` و`apps/api/src/modules/identity/persistence/staff-user-auth.ts:89-93, 121-140`: تحصر «إعطاء الدخول» في دوري الفروع `'staff'` و`'cashier'` بنطاق `'BRANCH'` فقط.
  6. `apps/api/src/modules/identity/persistence/employee-scope-access.ts:18-31` (`employeeUserLinkAvailable`): تمنع ربط حساب موظفة اصطناعي بموظفة عبر مسار الربط الإداري (`FR-F1-8`).
- **الأثر المعتمد:** في `080-b` تنحصر «أدوار أكتر» للحساب الاصطناعي في أدوار الفروع التشغيلية المسموحة للـ POS (`staff` و`reception`/`cashier`)، بينما تُمنح أدوار الإدارة الخلفية عبر دعوة بريد حقيقي في `080-a` (`G1`) ثم ربط المستخدم بسجل الموظفة (`FR-F1-8`).
