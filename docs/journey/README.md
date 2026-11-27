# User journeys — رحلات المستخدم

One file per merged feature. Each journey says what to prepare, what to click, and what you must see, so the
owner can test it by hand and an agent can replay it in a browser.

ملف لكل ميزة اتعملها merge. كل رحلة فيها: تجهّز إيه، تدوس على إيه، ولازم تشوف إيه — عشان صاحب المشروع يجربها
بإيده، وأي agent يقدر يعيدها في المتصفح.

## How a journey file is written — شكل الملف

| Section | What it holds |
|---|---|
| **Status / الحالة** | the PR that shipped it, and whether it can run on staging yet |
| **Before you start / قبل ما تبدأ** | data and settings the journey needs |
| **Steps / الخطوات** | numbered; each step in Arabic, then the same step in English with the exact screen text |
| **You must see / لازم تشوف** | the observable result of each step |
| **Must NOT happen / ممنوع يحصل** | the failure the feature exists to prevent |
| **For an agent / للـ agent** | URLs, selectors by visible text or role, and the assertions to make |

Screen text is quoted exactly as `packages/i18n` has it, in Arabic and English, so a browser agent can find the
element by its visible text in either language.

## Staging — الستاجنج

Since #533 (2026-10-23) staging runs admin, POS, API, worker and the one-shot migrate step in Dokploy, and is updated after
every merge. The public menu (`apps/menu`) is **not** deployed there yet:

- admin (back office): `https://app.staging.pospay.systems`
- POS (cashier and staff): `https://pos.staging.pospay.systems`
- API: `https://api.staging.pospay.systems`, plus the worker and the one-shot migrate step

It holds **demo data only**: the demo company «صالون الأميرة (تجريبي)» with two branches, Salmiya and Hawalli, 8 services and
7 employees.

What still does not work there, whatever the journey:

- **WhatsApp and OTP sending is OFF** until the Meta templates and secrets are in place. So staff OTP sign-in, the personal phone
  passkey and every flow that needs the personal staff session cannot be finished on staging.
- **File uploads need the storage values.** Since #547 the staging compose passes the object-storage (`STORAGE_*`) settings to the
  API and the worker; while any of them is empty in Dokploy an upload answers `STORAGE_NOT_CONFIGURED`. This hits employee
  documents, the Excel import and the business logo. The rows below that say "no object storage on staging" were written before #547.
- **Worker-only jobs** run there, but you only see their result (a bell message), never a screen.

من #533 (2026-10-23) الستاجنج شغال على Dokploy (الإدارة والكاشير والـ API والـ worker وخطوة الـ migrate) وبيتحدّث بعد كل merge، والمنيو العام (`apps/menu`) **لسه مش متركّب هناك**: لوحة الإدارة على
`https://app.staging.pospay.systems`، والكاشير على `https://pos.staging.pospay.systems`، والـ API على
`https://api.staging.pospay.systems` ومعاه الـ worker. البيانات تجريبية بس: شركة «صالون الأميرة (تجريبي)» بفرعين، السالمية وحولي،
و8 خدمات و7 موظفين. لسه مقفول هناك: إرسال الواتساب والـ OTP (مستني قوالب Meta والأسرار)، ورفع الملفات (من #547 الإعدادات بتتبعت للـ API والـ worker، بس لو قيمة منها فاضية في Dokploy الرفع بيرد `STORAGE_NOT_CONFIGURED`)،
والـ jobs اللي بتشتغل في الخلفية بتشوف نتيجتها في الجرس بس.

## Testing on staging with a browser agent — التجربة على الستاجنج بـ agent

- The login details are **not in the repo**. The owner gives them to the agent privately, in the chat.
- Never type them into a file: not a journey, not a script, not a test, not a commit.
- Use only the demo company «صالون الأميرة (تجريبي)» and its branches.
- Never test against production.

- بيانات الدخول **مش موجودة في الريبو**. صاحب المشروع بيديها للـ agent على انفراد في الشات.
- ممنوع تتكتب في أي ملف: لا رحلة ولا سكريبت ولا اختبار ولا commit.
- استخدم شركة «صالون الأميرة (تجريبي)» وفروعها بس.
- ممنوع تجرب على الـ production.

## Journeys

Since #80 the admin has a dark sidebar (logo, company/business/branch, navigation, account and authenticator at the bottom) and a slim top row (notifications bell, language). On a phone the sidebar opens from the ☰ button.
من بعد #80 لوحة الإدارة فيها قائمة جانبية كحلي (اللوجو، الشركة/النشاط/الفرع، القائمة، والحساب والمصادقة تحت) وشريط صغير فوق (الجرس واللغة). على الموبايل القائمة بتفتح من زرار ☰.

The status paragraph inside journeys 01–47 was written before #533 and may still say the admin or POS is not deployed. Journeys
57–60 were written before their screens shipped, and their bodies still say "no screen yet"; journey 58's list of kinds that are
"saved but change nothing yet" is also older than #562 and #594 (see [62](62-alert-rules-screen.md)). This table is the current
answer.

| # | Journey | Shipped in | Runs on staging? |
|---|---|---|---|
| 00 | [Local setup](00-local-setup.md) — تشغيل النظام على جهازك | — | — |
| 01 | [Admin sign-in and the authenticator app](01-admin-sign-in-and-totp.md) — دخول لوحة الإدارة وتطبيق المصادقة | #53 | yes |
| 02 | [Choosing the company, business and branch](02-admin-workspace-selector.md) — اختيار الشركة والنشاط والفرع | #52, #53 | yes |
| 03 | [Pairing a POS device](03-pos-device-pairing.md) — ربط جهاز الكاشير | #55 | yes on the POS; the manager's pairing code and approval are API only (no admin screen) |
| 04 | [The notifications bell](04-admin-notifications-bell.md) — جرس الإشعارات | #58 | yes |
| 05 | [A customer replies STOP on WhatsApp](05-whatsapp-stop.md) — العميل يرد "إيقاف" | #60 | no: needs the Meta webhook subscription and WhatsApp secrets |
| 06 | [Commission engine I](06-commission-engine-i.md) — حساب العمولة (المرحلة الأولى) | #64 | nothing to click (calculation core, checked by tests) |
| 07 | [Package value and sessions](07-package-allocation.md) — قيمة الباقة وجلساتها | #65 | nothing to click (rule core, checked by tests) |
| 08 | [Staff sign-in on the POS](08-staff-login-pos.md) — دخول الموظف على جهاز الكاشير | #61 | yes for the PIN; WhatsApp codes OFF pending Meta templates + secrets |
| 09 | [The branch attendance QR](09-attendance-qr.md) — باركود الحضور على جهاز الفرع | #72 | yes, once a device is paired (see 03) |
| 10 | [Find or create a customer by phone](10-customer-find-or-create.md) — البحث عن عميل أو إضافته برقم الموبايل | #71 | yes, inside Record a visit (47); needs the `customers` and `orders` features |
| 11 | [The email channel (built, sending off)](11-email-channel-disabled.md) — قناة الإيميل (جاهزة، والإرسال مقفول) | #75 | nothing to test live (email sending is off on purpose) |
| 12 | [The permissions screen](12-permissions-screen.md) — شاشة الصلاحيات | #73 | yes |
| 13 | [Create employee](13-create-employee.md) — إضافة موظف | #79 | yes |
| 14 | [Private files](14-private-files.md) — الملفات الخاصة | #82 | screen exists; uploads fail (no object storage on staging) |
| 15 | [Per-person discount limit](15-discount-limit.md) — حد الخصم للشخص | #84 | yes |
| 16 | [Update employee](16-update-employee.md) — تعديل الموظف | #83 | yes |
| 17 | [Business discount default](17-business-discount-default.md) — حد الخصم الافتراضي للنشاط | #86 | yes |
| 18 | [Set salary](18-set-salary.md) — تعيين الراتب | #88 | yes |
| 19 | [Schedules](19-schedules.md) — جداول العمل | #89 | yes; shift templates still API only |
| 20 | [Role default permissions](20-role-default-permissions.md) — صلاحيات الدور الافتراضية | #91 | yes |
| 21 | [Role follow-ups](21-role-followups.md) — تكملة صلاحيات الأدوار | #93 | yes; customers are created from Record a visit (47) |
| 22 | [Personal phone passkey](22-personal-phone-passkey.md) — مفتاح المرور على الموبايل الشخصي | #94 | no: the personal session needs OTP (OFF pending Meta templates + secrets) |
| 23 | [Request leave](23-request-leave.md) — طلب إجازة | #95 | manager side yes; the employee's own request is [84](84-my-leave.md) |
| 24 | [Decide leave](24-decide-leave.md) — اعتماد الإجازات | #98 | yes (`/leave`); the employee's view is [84](84-my-leave.md); no notification sent |
| 25 | [Unbind a passkey](25-unbind-passkey.md) — فك ربط مفتاح المرور | #97, #100 | manager unbind yes; re-enrolment needs the personal session (OTP OFF) |
| 26 | [Clock in and out from the personal phone](26-clock-attendance.md) — تسجيل الحضور والانصراف من الهاتف الشخصي | #99 | no: the personal session needs OTP (OFF); the card clock (30) works |
| 27 | [Import employees from Excel](27-employee-import.md) — استيراد الموظفين من Excel | #107 | screen exists; the upload fails (no object storage on staging) |
| 28 | [Document expiry alerts](28-document-expiry.md) — تنبيه انتهاء الوثائق | #110 | worker job on staging; recipients follow the alert rules ([62](62-alert-rules-screen.md)) since #562; documents need the storage values |
| 29 | [Services](29-services.md) — الخدمات | #114 | yes; needs the `catalog` feature; no delete yet |
| 30 | [Employee cards and clock-by-card](30-employee-cards-and-clock-by-card.md) — كروت الموظفين والحضور بالكارت | #120, #121 | yes (admin card section, POS clock-by-card) |
| 31 | [Attendance change requests](31-attendance-change-requests.md) — طلبات تعديل الحضور (طلب وموافقة) | #148 | yes, now on `/staff/attendance-requests` |
| 32 | [Add a manual attendance day](32-add-manual-attendance-day.md) — إضافة يوم حضور يدوي | #153 | yes, from `/staff/attendance-requests` |
| 33 | [Void and restore an attendance day](33-void-and-restore-attendance-day.md) — إلغاء يوم حضور واسترجاعه | #152 | yes: void on `/staff/attendance`, restore from `/staff/attendance-requests` |
| 34 | [Resolve an attendance exception](34-resolve-attendance-exception.md) — إغلاق تنبيه الحضور وإعادة فتحه | #126 | yes, now on `/staff/attendance-exceptions` |
| 35 | [Correct an attendance session](35-correct-attendance.md) — تصحيح وقت الحضور أو الانصراف | #132 | yes, from the board `/staff/attendance` |
| 36 | [Not-clocked-in alert](36-not-clocked-in-alert.md) — تنبيه "الموظف لسه ما سجّل حضور" | #130 | worker job on staging; the message shows in the admin bell; follows the alert rules (58) |
| 37 | [Package types](37-package-types.md) — أنواع الباقات | #133 | yes; needs the `catalog` feature |
| 38 | [Employee documents owner-only by default](38-documents-owner-only.md) — وثائق الموظفين للمالك فقط افتراضيًا | #137 | permission defaults yes; opening or uploading a file needs object storage (not set) |
| 39 | [Duplicate-name warning](39-duplicate-name-warning.md) — تنبيه الاسم المتكرر عند إضافة أو تعديل موظف | #136, #142 | yes |
| 40 | [Employee IBAN](40-employee-iban.md) — الحساب البنكي للموظف (الآيبان) | #140 | yes |
| 41 | [Maximum shifts per day (owner setting)](41-max-shifts-setting.md) — أقصى عدد ورديات في اليوم (إعداد المالك) | #143 | yes; now per branch (see [45](45-max-shifts-per-branch.md)) |
| 42 | [Passkey phone lock](42-passkey-phone-lock.md) — قفل الهاتف على موظف واحد | #144 | no: the personal session needs OTP (OFF pending Meta templates + secrets) |
| 43 | [Break window on a shift](43-schedule-break-window.md) — البريك الثابت داخل الوردية | #146 | yes |
| 44 | [Return from break: lateness and the "not returned" alert](44-return-from-break-lateness.md) — الرجوع من البريك والتنبيه لو ما رجعتش | #147 | yes with the card clock; the alert is a worker job shown in the admin bell |
| 45 | [Maximum shifts per day, per branch](45-max-shifts-per-branch.md) — أقصى عدد ورديات في اليوم لكل فرع | #151 | yes |
| 46 | [Default working hours per employee](46-employee-default-hours.md) — الدوام الافتراضي للموظفة | #154 | yes |
| 47 | [Record a visit at reception](47-record-visit-reception.md) — تسجيل زيارة من الريسبشن | #212, #215 | yes; needs the `orders` and `customers` features; the expired exit is [48](48-reception-own-recordings.md) |
| 48 | [Clear an expired recording with your own visits of that day](48-reception-own-recordings.md) — حسم تسجيل منتهي من زياراتك في اليوم ده | #230, #231, #233, #234 | yes, but only after a save stays unresolved 23 h from the first attempt in the same open tab; no browser test yet |
| 49 | [Edit the price or discount of a saved service](49-price-discount-edit.md) — تعديل سعر أو خصم خدمة محفوظة | #253, #254, #266, #288, #304, #312, #323, #334, #353, #354, #357, #360, #361 | yes; needs the `orders` feature; the bell comes from the worker and follows the alert rules (58) |
| 50 | [Record a visit's tips](50-visit-tips.md) — تسجيل بقشيش الزيارة | #336, #339, #345, #366, #383, #398 | yes; needs the `orders` feature |
| 51 | [Cancel a saved service line](51-cancel-service-line.md) — إلغاء خدمة محفوظة | #322, #341, #346, #364, #386, #390, #395 | yes; the bell comes from the worker and follows the alert rules (58) |
| 52 | [Change who performed a saved service](52-change-line-performers.md) — تغيير منفّذين خدمة محفوظة | #330, #333, #405, #414, #430, #432, #433, #437, #445, #448, #456 | yes; the bell comes from the worker and follows the alert rules (58) |
| 53 | [Giving and managing the employee number](53-employee-number.md) — إدّي الموظفة رقمها وظبّطه | #291, #335, #340, #372, #375, #376, #377, #380, #388, #396 | yes; the Excel import part needs object storage (not set) |
| 54 | [Seeing and searching the employee number](54-employee-number-everywhere.md) — الرقم الوظيفي في كل الشاشات والبحث بيه | #317, #320, #344, #371, #379 | yes |
| 55 | [Business identity](55-business-identity.md) — هوية النشاط | #365, #384, #392, #393, #394, #397 | names yes; logo upload fails (no object storage on staging) |
| 56 | [The PDF renderer](56-pdf-renderer.md) — محرّك ملفات الـ PDF | #413, #425, #426 | nothing to click (worker capability; no document kind registered yet) |
| 57 | [Discount approval (foundation)](57-discount-approval.md) — الموافقة على خصم فوق الحد (الأساس) | #465, #469, #498, #504, #523 | yes: request and use on the recording screen ([70](70-discount-approval-request.md)), PIN decision on the reception device ([71](71-discount-approval-decide.md)); the remote decision is API only |
| 58 | [Alert rules](58-alert-rules.md) — قواعد التنبيهات | #467, #493, #501, #503, #510, #521 | yes; the screen is [62](62-alert-rules-screen.md) (`/alert-rules`) |
| 59 | [Staff app settings: columns and months back](59-staff-app-settings.md) — إعداد تطبيق الموظفات: الأعمدة وعدد الشهور | #468, #513, #516 | yes; the screen is [61](61-staff-app-columns-screen.md) (`/staff-app-columns`); months back is read by the employee's own attendance and tips reads ([83](83-own-attendance.md), [85](85-own-monthly-tips.md)) |
| 60 | [Staff push subscriptions](60-staff-push-subscriptions.md) — اشتراك موبايل الموظفة في الإشعارات | #530 | API on staging; the on/off control and the sender are [64](64-staff-web-push.md); needs the personal session (OTP OFF) and the push keys set in Dokploy |
| 61 | [Staff app columns screen](61-staff-app-columns-screen.md) — شاشة أعمدة تطبيق الموظفين | #553 | yes (`/staff-app-columns`) |
| 62 | [Alerts screen](62-alert-rules-screen.md) — شاشة التنبيهات | #562, #619 | yes (`/alert-rules`) |
| 63 | [«PosPay Business» app shell](63-native-app-shell.md) — غلاف تطبيق «PosPay Business» | #563, #575, #602, #627, #667 | no web page: native build only; the employee side needs OTP (OFF) |
| 64 | [Mobile notifications in the staff app](64-staff-web-push.md) — إشعارات الموبايل في تطبيق الموظفة | #557, #599, #612 | no: the control is on the personal screen (OTP OFF) |
| 65 | [«Your shift ends soon» reminder](65-shift-ending-reminder.md) — تذكير «دوامك قرب يخلص» | #577, #585, #594 | worker job on staging; the push needs a subscribed phone (64); lead time on `/alert-rules` |
| 66 | [Staff sign-out that always finishes](66-staff-sign-out.md) — خروج الموظفة اللي دايمًا بيكمل | #597 | yes for the paired device; the personal session needs OTP (OFF) |
| 67 | [Official attendance statement (PDF)](67-attendance-statement.md) — كشف الحضور الرسمي (PDF) | #589, #608, #684, #697, #705 | screen and routes yes (`/staff/attendance-statement`); the PDF needs the worker's renderer |
| 68 | [Staff app link and QR](68-employee-app-link-qr.md) — لينك تطبيق الموظفات والـ QR | #638 | yes (`/staff/employee-app-link`); no print sheet yet |
| 69 | [List a branch's pending devices](69-pending-devices.md) — قائمة أجهزة الفرع اللي مستنية موافقة | #660 | API on staging; no screen (issue #634) |
| 70 | [Ask for a discount approval and use it](70-discount-approval-request.md) — اطلب موافقة على خصم واستخدمها | #560, #595, #657, #1015, #1022 | yes, on `/orders/service-sessions/new`; not from the edit dialog yet |
| 71 | [Approve or reject a discount (PIN or remotely)](71-discount-approval-decide.md) — الموافقة على الخصم أو رفضه | #957, #1002, #1053, #1062 | PIN screen yes on a paired reception device; the remote decision is API only |
| 72 | [Owner bell: a discount approved on the approver's own work](72-discount-self-approval-bell.md) — جرس المالك: موافقة على خصم على شغل الموافِق | #937, #945, #946, #948 | yes; worker consumer, shown in the admin bell; rule on `/alert-rules` |
| 73 | [Service categories](73-service-categories.md) — تصنيفات الخدمات | #721, #726, #729, #1060 | yes (`/catalog/categories`); branch categories are API only |
| 74 | [A service's duration and category](74-service-duration-category.md) — مدة الخدمة وتصنيفها | #757, #771 | yes (`/catalog`) |
| 75 | [Close and reopen a category and its services](75-close-reopen-categories.md) — قفل وفتح التصنيف وخدماته | #996, #1021, #1044, #1050, #1060 | yes for a category; closing one service alone is API only |
| 76 | [Rating requests: scheduling and the on/off switch](76-rating-requests.md) — طلبات التقييم: الجدولة ومفتاح التشغيل | #670, #692, #734, #741, #751, #785, #883 | the switch yes (`/alert-rules`); nothing is sent (row 59b-3 not built) |
| 77 | [The customer's rating page](77-public-rating-page.md) — صفحة تقييم العميلة | #704, #731, #738, #847, #1105 | no: `apps/menu` is not deployed on staging and no link is sent yet |
| 78 | [Commission plan versions](78-commission-plan-versions.md) — نسخ خطة العمولة | #551, #695, #730, #793 | API on staging; no screen (row 48-3 deferred) |
| 79 | [A special commission for one employee on one service](79-commission-service-overrides.md) — عمولة خاصة لموظفة على خدمة واحدة | #762 | API on staging; the screen is [98](98-commission-service-overrides.md) |
| 80 | [Monthly commission statements: the groundwork](80-commission-statements-groundwork.md) — كشوف العمولة الشهرية: الأساس | #611, #613, #645, #650, #651, #659, #707, #717, #727, #790, #813, #816, #821, #844, #928, #983, #998, #1010, #1014, #1020, #1023, #1024 | nothing to click (worker projection and storage; no statement route yet) |
| 81 | [A customer's profile and per-business notes](81-customer-profile-notes.md) — ملف العميلة وملاحظات كل نشاط | #766 | API on staging; no screen for the new fields |
| 82 | [The private view on the reception device, and the «own» permissions](82-private-view-window.md) — العرض الخاص على جهاز الريسبشن وصلاحيات «بتاعتي» | #775, #784, #845 | permissions yes on `/permissions`; the window is API only |
| 83 | [«حضوري»: an employee reads her own attendance](83-own-attendance.md) — الموظفة تقرا حضورها | #861 | API on staging; no screen; needs a private view (82) or the personal session (OTP OFF) |
| 84 | [«إجازاتي»: an employee requests leave and follows it](84-my-leave.md) — الموظفة تطلب إجازة وتتابعها | #881, #882 | yes on a paired reception device; her own phone needs OTP (OFF) |
| 85 | [An employee reads her own tips for the month](85-own-monthly-tips.md) — الموظفة تقرا بقشيشها في الشهر | #896 | API on staging; no screen; needs a private view (82) or the personal session (OTP OFF) |
| 86 | [Sell a package at reception](86-sell-package.md) — بيع باقة من الريسبشن | #756, #778, #815, #834, #929, #1025, #1051, #1052, #1073, #1100 | yes (`/orders/package-sales/new`); needs the worker; no payment is captured |
| 87 | [Use a package session in a visit, and give it back](87-redeem-package-session.md) — استخدام جلسة من الباقة في زيارة وإرجاعها | #818, #820, #838, #839, #841, #846, #931, #956 | yes, on `/orders/service-sessions/new` («من الباقة») |
| 88 | [Extend a package's expiry](88-extend-package.md) — تمديد صلاحية الباقة | #975, #985, #1045 | yes, in the package detail under «من الباقة» |
| 89 | [Refund unused package sessions](89-refund-package-sessions.md) — استرداد جلسات الباقة اللي ما اتستخدمتش | #819, #999 | API on staging; no dialog or bell yet; imported packages cannot be refunded yet |
| 90 | [Import open packages from Excel](90-import-packages.md) — استيراد الباقات المفتوحة من Excel | #851, #871, #877, #889 | Admin screen `/orders/packages/import` + template, preview and commit request API (47-2d + 47-3); needs object storage |
| 91 | [Stop and resume selling a package type](91-stop-resume-selling-package.md) — إيقاف بيع نوع باقة واستئنافه | #814, #1042, #1055, #1067 | yes (`/catalog/package-types`) |
| 92 | [The «الإجازات» tab in an employee's file](92-employee-leave-tab.md) — تبويب «الإجازات» في ملف الموظفة | #893, #897, #898, #958 | yes (`/staff/<employee id>/leave`) |
| 93 | [Leave history report for all employees](93-leave-history-report.md) — تقرير سجل الإجازات لكل الموظفين | #942, #981, #982, #997, #1001 | yes (`/staff/leave-history`); large reports are built by the worker |
| 94 | [Services import from Excel: the cell-reading core](94-services-import-parsing.md) — استيراد الخدمات من Excel: أساس قراءة الخلايا | #817, #823, #824 | nothing to click (pure rules, checked by tests; no import route or screen yet) |
| 95 | [The new look and the light / dark switch](95-design-system-theme.md) — الشكل الجديد ومفتاح فاتح / غامق | #1079, #1083, #1095, DS-3 A3 | yes, in the admin and the POS |
| 96 | [Package sale recovery when the response is lost](96-package-sale-recovery.md) — استرجاع بيع الباقة لما الرد يضيع | #1077, #1094 | after the next staging batch; needs the `orders` feature; continues [86](86-sell-package.md) step 14 |
| 97 | [The commission plan builder](97-commission-plan-builder.md) — منشئ خطط العمولة | #1104, this PR | yes (`/commissions/plans`) |
| 98 | [The special-commission screen](98-commission-service-overrides.md) — شاشة العمولة الخاصة للخدمات | this PR | after the staging batch that includes this PR (`/commissions/overrides`) |
| 99 | [A customer's packages](99-customer-packages.md) — باقات العميلة | this PR (42-4) | after the staging batch that includes this PR (`/orders/customers/{customerId}/packages` from the day list and the two forms) |
| 100 | [The imported-package refunds switch](100-imported-refunds-switch.md) — مفتاح مرتجع الباقات المستوردة | this PR (46-2a-S) | after the staging batch that includes this PR **and its seed migration passes the U gate** (`/imported-refunds`) |
| 101 | [Admin navigation styles (planned — spec 074)](101-admin-navigation-styles.md) — أنماط تنقّل لوحة الإدارة الثلاثة (مخطط — مواصفة 074) | planned (`074-0b` decision records only; UI in step 7, account sync in step 12) | no — planned only (not built yet; step `074-0b` adds decision records only) |
| 102 | [Choose the navigation style](102-choose-navigation-style.md) — اختيار نمط التنقّل | this PR (074-7b) | after the staging batch that includes this PR (`/appearance`, `/approvals`, `/overview/…`, `/soon/…`); the choice lives on the device until sign-out, saving it on the account is step 12 |

New journeys are added after every merge.
