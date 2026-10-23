# 58 · Alert rules — قواعد التنبيهات

**Status / الحالة:** shipped in #467 (62-1: storage, routes and readers), #501 (fix: out-of-range minutes are 422
`ALERT_RULE_INVALID`), #503 (62-3: the four orders bells read the rules), #493 (62-2b: the attendance-change bells read
the rules), #510 (own permission `manage:alert-rules:business`) and #521 (62-2: the not-clocked-in and break alerts read
the rules), all merged. **API only, no screen yet** (the alerts screen is row 62-4). Since #533 (2026-10-23) staging runs
the admin at `https://app.staging.pospay.systems`, the POS at `https://pos.staging.pospay.systems` and the API + worker
at `https://api.staging.pospay.systems`, demo data only: the routes and the worker jobs are there, and what a person sees
is the **bell** ([04](04-admin-notifications-bell.md)) arriving earlier, later or not at all. The not-clocked-in job
covers a company only after its `CompanyCreated` was delivered ([36](36-not-clocked-in-alert.md)). Your answers
AL-Q1…AL-Q6 apply (AL-Q1 as Abu Salem picked it: its own permission «إدارة التنبيهات»):
[owner-questions.ar.md](../specs/060-ratings-and-staff-app/owner-questions.ar.md).

Which kinds a rule really changes today:
- **Live:** `SHIFT_NOT_CLOCKED_IN` ([36](36-not-clocked-in-alert.md)), `SHIFT_BREAK_NOT_RETURNED` and
  `SHIFT_BREAK_RETURNED_OTHER_BRANCH` ([44](44-return-from-break-lateness.md)), `ATTENDANCE_CHANGE_REQUESTED` /
  `_DECIDED` ([31](31-attendance-change-requests.md)), `LATE_SERVICE_SESSION`, `SERVICE_LINE_EDITED`,
  `SERVICE_LINE_CANCELLED`, `SERVICE_LINE_PERFORMERS_CHANGED`.
- **Saved but changes nothing yet:** `ATTENDANCE_EXCEPTION` and `DOCUMENT_EXPIRING` (row 62-2d, waits on AL-Q8),
  `SHIFT_ENDS_SOON` (row 28c), `STATEMENT_AWAITING_REVIEW` / `_APPROVAL` (row 62-2c).
- The discount approval bell ([57](57-discount-approval.md)) is always on and is **not** governed by these rules.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and admin, then `pnpm db:migrate` (0165, 0167, 0169–0171)
  and `pnpm db:seed`; or staging with the demo company «صالون الأميرة (تجريبي)», branches Salmiya and Hawalli.
- The setup of [36](36-not-clocked-in-alert.md): منى (Mona) with a shift at Salmiya, and a second employee with the same
  shift at Hawalli; the four managers of each branch, each with their own bell.
- Synthetic users: the **Owner**, a **General Manager**, a **Business Manager** (the three hold
  **إدارة التنبيهات** / **Manage alerts** by default), the **Salmiya Branch Manager** (does not hold it), and a user
  who holds only **إدارة إعدادات النشاط** / **Manage business settings**.

## العربي

API بس، لسه مفيش شاشة. اللي بيبان لك هو الجرس.

1. **القواعد الافتراضية:** صاحب الشركة يقرا قواعد النشاط ← 14 نوع، كل واحد `source: DEFAULT`، والمفتاح العام شغال.
   تنبيه عدم الحضور بعد 20 دقيقة، وعدم الرجوع من البريك بعد 10 دقايق، للأربع مديرين، في التطبيق بس. من غير ما حد يغيّر
   حاجة، الجرس زي ما هو في [36](36-not-clocked-in-alert.md) و[44](44-return-from-break-lateness.md) بالظبط.
2. **فرع بقاعدة لوحده:** صاحب الشركة يخلي تنبيه عدم الحضور في السالمية بعد **10** دقايق ← شيفت منى 10:00، ولو ما
   سجّلتش، جرس مديري السالمية يظهر عليه بعد 10:10 (في خلال 5 دقايق):
   **لم يُسجَّل حضور منى لشفت الساعة 10:00 في فرع السالمية**. حولي فاضلة على قاعدة النشاط (20 دقيقة).
3. **رجوع الفرع للنشاط:** صاحب الشركة يمسح قاعدة السالمية ← السالمية ترجع لـ 20 دقيقة.
4. **قفل نوع:** يقفل تنبيه عدم الحضور ← ولا جرس لأي مدير. الشيفت اللي فات وقته وهو مقفول **ما بيتنبّهش بعدين** حتى لو
   النوع اتفتح تاني؛ الشيفت الجديد بعد الفتح بيتنبّه عادي.
5. **تغيير المستلمين:** يشيل مدير الفرع من المستلمين ← من الإشعار الجاي، مديرة السالمية ما يوصلهاش، والباقيين يوصلهم.
   التغيير بيأثر على اللي جاي بس، مش على إشعار اتبعت.
6. **المفتاح العام:** يقفل كل التنبيهات ← ولا جرس من الأنواع الشغالة فوق، في كل الفروع. يفتحه ← ترجع.
7. **أنواع لسه مالهاش أثر:** حفظ قاعدة لاستثناءات الحضور أو انتهاء المستندات أو قرب نهاية الشيفت أو الكشوفات بيتحفظ
   ويتسجل، بس ما بيغيرش أي جرس دلوقتي. انتهاء المستندات والكشوفات مالهاش قاعدة فرع:
   **قيمة القاعدة برّه المسموح لنوع التنبيه ده (المدة أو الأدوار أو القنوات).**
8. **قيم غلط:** مدة 0 أو 1441 دقيقة ←
   **قيمة القاعدة برّه المسموح لنوع التنبيه ده (المدة أو الأدوار أو القنوات).** (422). مدة 20.5 ←
   **البيانات المرسلة غير صحيحة** (400). القناة الوحيدة دلوقتي التطبيق.
9. **اتنين بيعدّلوا مع بعض:** مدير حفظ بنسخة قديمة بعد ما مدير تاني عدّل ←
   **عدّل مدير آخر قاعدة التنبيه. أعد التحميل قبل الحفظ.** (409) ومفيش حاجة اتحفظت.
10. **الصلاحية:** اللي معاه **إدارة إعدادات النشاط** بس، أو مديرة السالمية، أو حد صلاحيته على فرع واحد بس (حتى لقاعدة
    فرعه)، أو جهاز مربوط ← **غير مسموح بهذا الإجراء** (403) على قراية القواعد وحفظها ومسحها والمفتاح العام. صاحب
    الشركة يديها **سماح** لـ **إدارة التنبيهات** على النشاط من شاشة الصلاحيات ([12](12-permissions-screen.md)) ← تقدر.
11. **التدقيق:** كل تغيير ليه سطر قبل/بعد. حفظ نفس القيم تاني ما بيكتبش حاجة.

**ممنوع يحصل:**
- نوع مقفول أو مفتاح عام مقفول، وجرس يوصل برضه.
- شيفت فات وقته والتنبيه مقفول، ويتنبّه بعد ما التنبيه يتفتح.
- قاعدة السالمية تغيّر توقيت حولي.
- صلاحية **إدارة إعدادات النشاط** لوحدها تفتح القواعد، أو جهاز يعدّلها.
- حفظ قديم يمسح تعديل مدير تاني.
- تغيير بدون سطر تدقيق، أو قاعدة تغيّر الحضور أو التأخير أو العمولة.

## English

API only, no screen yet. What you see is the bell.

1. **Defaults:** the Owner reads the business rules → 14 kinds, each `source: DEFAULT`, the master switch on.
   Not-clocked-in at 20 minutes, break-not-returned at 10 minutes, the four managers, in-app only. With nothing changed,
   the bell is exactly as in [36](36-not-clocked-in-alert.md) and [44](44-return-from-break-lateness.md).
2. **A branch override:** the Owner sets Salmiya's not-clocked-in alert to **10** minutes → Mona's 10:00 shift, with no
   clock-in, rings the Salmiya managers' bell after 10:10 (within 5 minutes):
   **Mona has not clocked in for the 10:00 shift at Salmiya**. Hawalli stays on the business rule (20 minutes).
3. **Back to the business rule:** the Owner deletes Salmiya's override → Salmiya is back at 20 minutes.
4. **A kind off:** the Owner switches the not-clocked-in kind off → no manager gets a bell. A shift that became overdue
   while it was off is **never alerted later**, even after switching it back on; a new overdue shift after that alerts
   as usual.
5. **Recipients:** removing the branch manager from the roles → from the next notice the Salmiya Branch Manager gets
   nothing and the others still do. A change affects the next notice only, never one already sent.
6. **The master switch:** off → no bell from any live kind above, in any branch. On → they are back.
7. **Kinds with no effect yet:** a rule for attendance exceptions, document expiry, shift-ends-soon or the statements
   is saved and audited, but changes no bell today. Document expiry and the statements have no branch rule:
   **A value is outside what this alert kind allows (minutes, roles or channels).**
8. **Bad values:** 0 or 1441 minutes →
   **A value is outside what this alert kind allows (minutes, roles or channels).** (422). 20.5 minutes →
   **The request is not valid** (400). The only channel today is in-app.
9. **Two editors:** a manager saves with a stale revision after another manager changed the rule →
   **Another manager changed this alert rule. Reload before saving.** (409), nothing saved.
10. **Permission:** a holder of **Manage business settings** alone, the Salmiya Branch Manager, someone whose grant
    covers one branch only (even for that branch's override), or a paired device → **This action is not allowed** (403)
    on reading, saving, deleting and the master switch. The Owner gives an **Allow** for **Manage alerts** on the
    business from the permissions screen ([12](12-permissions-screen.md)) → allowed.
11. **Audit:** every change writes one before/after entry. Saving the same values again writes nothing.

**Must NOT happen:**
- A bell from a kind that is off, or while the master switch is off.
- A shift that became overdue while the alert was off being alerted after it is switched on.
- Salmiya's override changing Hawalli's timing.
- **Manage business settings** alone opening the rules, or a device editing them.
- A stale save overwriting another manager's change.
- A change without an audit entry, or a rule changing attendance, lateness or commission.

## For an agent

- **Screens:** none (row 62-4). Observe the bell at `http://localhost:3001` (staging `https://app.staging.pospay.systems`)
  and `GET /v1/me/notifications/unread-count`. Bell texts: `packages/i18n/src/in-app-catalog.ts` (`shift_not_clocked_in`,
  `break_not_returned`, `break_returned_other_branch`, the four orders keys) and `packages/i18n/src/attendance-change.ts`.
- **API** (base `http://localhost:3000/v1`, staging `https://api.staging.pospay.systems/v1`; session cookie +
  `x-company-id`; no `Idempotency-Key`). All six routes: `@Require('manage:alert-rules:business', { business: 'businessId' })`.
  - `GET /businesses/<B>/alert-rules` and `GET /businesses/<B>/branches/<BR>/alert-rules` → `AlertRules`
    `{ business_id, branch_id, alerts_enabled, rules[14] { kind, source DEFAULT|BUSINESS|BRANCH, enabled, recipient_roles,
    channels, delay_minutes, lead_minutes, fixed_recipients, revision, rule_id } }`.
  - `PUT /businesses/<B>/alert-rules` and `PUT /businesses/<B>/branches/<BR>/alert-rules` → 200 `AlertRules`:

    ```json
    { "rules": [ { "kind": "SHIFT_NOT_CLOCKED_IN", "enabled": true,
      "recipient_roles": ["owner", "general_manager", "business_manager", "branch_manager"],
      "channels": ["IN_APP"], "delay_minutes": 10, "lead_minutes": null,
      "expected_revision": null, "expected_rule_id": null } ] }
    ```

    `expected_revision` / `expected_rule_id` = the `revision` / `rule_id` read in that scope (`null` when none is stored).
  - `DELETE /businesses/<B>/branches/<BR>/alert-rules/<KIND>?expected_rule_id=<RULE_ID>&expected_revision=<N>` → 204.
  - `PUT /businesses/<B>/alert-rules/master` with `{ "alerts_enabled": false }` → 200.
- **Errors:** `ALERT_RULE_INVALID` 422 · `ALERT_RULE_REVISION_CONFLICT` 409 · `VALIDATION_FAILED` 400 · `FORBIDDEN` 403 ·
  `NOT_READY` 503.
- **Assertions:** audit actions `alert_rule.saved`, `alert_rule.branch_reset`, `alert_rules_master.enabled|disabled`, none
  on a same-value save; effective rule = branch row → business row → default, master switch on top; a closed periodic
  alert writes its ledger row with `suppressed_at` set and `recipient_count = 0`, no audit and no outbox event; a closed
  attendance-change kind leaves the event with no `notification_recipients`; a closed orders kind claims its ledger row
  with zero recipients; `alert_rules` RLS hides another tenant's rows; the new permission is in `deviceForbidden`.
- **Sources:** `docs/specs/060-ratings-and-staff-app/spec.md` (§B.2 Story B5, §B.4 alert kinds, §B.5 rows 62-1…62-4),
  `apps/api/src/modules/settings/http/alert-rules.controller.ts`, `packages/contracts/src/settings/alert-rules.ts`,
  `packages/domain/src/alert-rules.ts`, `apps/api/src/shared/errors.ts`, `packages/i18n/src/{ar,en,in-app-catalog}.ts`.
