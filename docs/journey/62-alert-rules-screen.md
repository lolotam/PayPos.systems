# 62 · Alerts screen — شاشة التنبيهات

**Status / الحالة:** shipped in #562 (62-2d: the attendance-exception and document-expiry bells follow the rules) and
#619 (62-4: the admin screen on `/alert-rules`), both merged. It is the screen for the routes of
[58](58-alert-rules.md); that journey's rules (sources, revisions, audit) still hold. **Runs on staging**
(`https://app.staging.pospay.systems/alert-rules`). Two later additions sit on the same screen and have their own
journeys: the **rating requests** switch (#741) and the row **موافقة على خصم على شغل الموافِق** / **Discount approved
on the approver's own work** (#948).

After #562 and #594 the kinds on this screen all have a sender that reads the rule, including **استثناء في الحضور** /
**Attendance exception**, **مستند قرب ينتهي** / **Document expiring soon** and **الشيفت قرب يخلص (للموظفة)** /
**Shift ending soon (employee)** ([65](65-shift-ending-reminder.md)). The two commission-statement kinds
(`STATEMENT_AWAITING_REVIEW`, `STATEMENT_AWAITING_APPROVAL`, row 62-2c) are **not listed** on the screen yet.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and admin, then `pnpm db:migrate` and `pnpm db:seed`; or
  the staging admin with the demo company «صالون الأميرة (تجريبي)» (branches Salmiya and Hawalli).
- Sign in ([01](01-admin-sign-in-and-totp.md)) and choose a business ([02](02-admin-workspace-selector.md)).
- Synthetic users: the **Owner** (holds **إدارة التنبيهات** / **Manage alerts** by default); a user with only
  **إدارة رسايل التقييم** / **Manage rating messages**; a user with neither.

## العربي

1. **افتح الشاشة:** من القائمة الجانبية دوس **التنبيهات** ← عنوان **التنبيهات** وتحته «اختار تنبيهات الفريق اللي
   تتبعت، ومين يستلمها، وتعديلات كل فرع.»
2. **النطاق:** قائمة **نطاق القواعد** فيها **قواعد النشاط** وبعدها كل فرع. الافتراضي **قواعد النشاط**.
3. **القواعد:** سطر لكل نوع تنبيه (زي **الموظفة ما بصمتش حضور**، **إلغاء خدمة**، **طلب تعديل حضور**)، وفي كل سطر:
   مفتاح تشغيل، وعلامة المصدر (**الافتراضي** أو **قاعدة النشاط** أو **قاعدة الفرع**)، و**المستلمين** (أدوار تتعلّم
   عليها، أو مستلم ثابت زي **صاحب الطلب** أو **الموظفة نفسها**)، والقناة **داخل التطبيق**.
4. **الدقايق:** الأنواع اللي ليها توقيت فيها خانة **بعد كام دقيقة** أو **قبلها بكام دقيقة** (من 1 لـ 1440).
5. **احفظ قاعدة نشاط:** اقفل مفتاح **تسجيل خدمة متأخر** ودوس **احفظ** ← **بيتحفظ…** وبعدها **اتحفظ.** وعلامة السطر
   تبقى **قاعدة النشاط**. الجرس بتاع النوع ده يبطل يوصل.
6. **قاعدة فرع:** اختار فرع **السالمية** من **نطاق القواعد**، غيّر الدقايق في **الموظفة ما بصمتش حضور** واحفظ ←
   العلامة تبقى **قاعدة الفرع**. فرع حولي لسه ماشي بقاعدة النشاط.
7. **رجّعه لقاعدة النشاط:** في نطاق الفرع، دوس **رجّعه لقاعدة النشاط** على السطر ← **رجع لقاعدة النشاط.**
8. **انتهاء المستندات:** في نطاق الفرع السطر ده مش موجود، ومكتوب **تنبيه انتهاء المستندات بيمشي دايماً بقاعدة
   النشاط.** وفي نطاق النشاط السطر بيقول **الموعد بيتحدد من أنواع المستندات (30 يوم افتراضياً).** ومعاه لينك **أنواع
   المستندات**.
9. **المفتاح العام:** اقفل **كل التنبيهات شغالة** ← **كل تنبيهات الفريق واقفة دلوقتي. رسايل تقييم العملاء مش داخلة
   فيها.**
10. **اتنين بيعدّلوا مع بعض:** لو مستخدم تاني حفظ نفس القاعدة قبلك ← **عدّل مدير آخر قاعدة التنبيه. أعد التحميل قبل
    الحفظ.** (409) ومفيش حاجة بتتكتب، والنموذج بياخد القيم اللي على السيرفر.
11. **من غير صلاحية:** مستخدم معاه **إدارة رسايل التقييم** بس بيشوف المدخل ومفتاح **إرسال طلبات التقييم للعملاء**
    بس. مستخدم من غير الصلاحيتين: المدخل مش ظاهر.

**ممنوع يحصل:**
- قاعدة فرع تتحفظ لنوع ملوش قاعدة فرع (انتهاء المستندات).
- حفظ ينجح فوق نسخة أقدم من القاعدة (من غير 409).
- المفتاح العام يوقف رسايل تقييم العملاء، أو مفتاح التقييم يوقف تنبيهات الفريق.
- جرس الموافقة على الخصم ([57](57-discount-approval.md)) يتأثر بالشاشة دي.

## English

1. **Open the screen:** in the sidebar click **Alerts** → the heading **Alerts** with "Choose which team alerts are
   sent, who receives them, and each branch's overrides."
2. **Scope:** the **Rules scope** list has **Business rules**, then every branch. It starts on **Business rules**.
3. **Rules:** one row per alert kind (e.g. **Employee did not clock in**, **Service cancelled**, **Attendance change
   requested**). Each row has an on/off switch, a source badge (**Default**, **Business rule** or **Branch rule**),
   **Recipients** (roles to tick, or a fixed recipient such as **The requester** or **The employee herself**) and the
   channel **In the app**.
4. **Minutes:** kinds with a timing have **After how many minutes** or **How many minutes before** (1 to 1440).
5. **Save a business rule:** turn off **Late service recording** and click **Save** → **Saving…** then **Saved.**; the
   row's badge becomes **Business rule**. That bell stops arriving.
6. **A branch rule:** choose **Salmiya** in **Rules scope**, change the minutes of **Employee did not clock in** and
   save → the badge becomes **Branch rule**. Hawalli still follows the business rule.
7. **Back to the business rule:** in a branch scope click **Back to the business rule** on the row → **Back to the
   business rule.**
8. **Document expiry:** in a branch scope the row is absent and the note says **Document expiry always follows the
   business rule.** In the business scope the row says **The window comes from the document types (30 days by
   default).** with a **Document types** link.
9. **Master switch:** turn off **All team alerts on** → **All team alerts are off now. Customer rating messages are
   not affected.**
10. **Two editors:** if another user saved the same rule first → **Another manager changed this alert rule. Reload
    before saving.** (409), nothing is written, and the form takes the server's values.
11. **Without permission:** a user with only **Manage rating messages** sees the sidebar entry and only the **Send
    rating requests to customers** switch. A user with neither permission does not see the entry.

**Must NOT happen:**
- A branch rule saved for a kind that has none (document expiry).
- A save succeeding over a stale revision (no 409).
- The master switch stopping customer rating messages, or the rating switch stopping team alerts.
- The discount approval bell ([57](57-discount-approval.md)) changed by this screen.

## For an agent

- **Screen:** `/alert-rules` (local `http://localhost:3001`, staging `https://app.staging.pospay.systems`). Page
  `apps/admin/src/settings/alert-rules/pages/alert-rules-page.tsx`.
- **Selectors:** sidebar link **التنبيهات** / **Alerts** (shown when the alert-rules read **or** the rating-settings
  read succeeds); `select#alert-rules-scope`; each row's switch is `role="switch"` named by the kind label
  (`alertRules.kind_<KIND>`); role checkboxes are named `{{role}} — {{kind}}`; master switch `#alerts-master`; rating
  switch `#rating-requests`; `role="status"` and `role="alert"` for results. Keys in
  `packages/i18n/src/alert-rules-catalog.ts`.
- **Listed kinds** (`apps/admin/src/settings/alert-rules/model/listed-alert-kinds.ts`): `SHIFT_NOT_CLOCKED_IN`,
  `SHIFT_BREAK_NOT_RETURNED`, `SHIFT_BREAK_RETURNED_OTHER_BRANCH`, `SHIFT_ENDS_SOON`, `ATTENDANCE_EXCEPTION`,
  `DOCUMENT_EXPIRING`, `LATE_SERVICE_SESSION`, `SERVICE_LINE_EDITED`, `SERVICE_LINE_CANCELLED`,
  `SERVICE_LINE_PERFORMERS_CHANGED`, `DISCOUNT_SELF_APPROVED`, `ATTENDANCE_CHANGE_REQUESTED`,
  `ATTENDANCE_CHANGE_DECIDED`.
- **API** (all `manage:alert-rules:business`, `apps/api/src/modules/settings/http/alert-rules.controller.ts`):
  `GET|PUT /v1/businesses/<BUSINESS_ID>/alert-rules` · `PUT …/alert-rules/master` ·
  `GET|PUT /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/alert-rules` · `DELETE …/alert-rules/<KIND>`.
  Rating switch: `GET|PUT /v1/businesses/<BUSINESS_ID>/rating-settings` with `manage:rating-requests:business`.
- **Errors:** `ALERT_RULE_INVALID` 422 · `ALERT_RULE_REVISION_CONFLICT` 409 · `FORBIDDEN` 403 (no permission, a
  device, another or an unknown business all answer the same).
- **Sources:** `docs/specs/060-ratings-and-staff-app/spec.md` (rows 62-2d, 62-4), journey [58](58-alert-rules.md).
