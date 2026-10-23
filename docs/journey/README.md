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

Since #533 (2026-10-23) staging runs the whole product in Dokploy and is updated after every merge:

- admin (back office): `https://app.staging.pospay.systems`
- POS (cashier and staff): `https://pos.staging.pospay.systems`
- API: `https://api.staging.pospay.systems`, plus the worker and the one-shot migrate step

It holds **demo data only**: the demo company «صالون الأميرة (تجريبي)» with two branches, Salmiya and Hawalli, 8 services and
7 employees.

What still does not work there, whatever the journey:

- **WhatsApp and OTP sending is OFF** until the Meta templates and secrets are in place. So staff OTP sign-in, the personal phone
  passkey and every flow that needs the personal staff session cannot be finished on staging.
- **File uploads fail.** The staging compose passes no object-storage (`STORAGE_*`) settings to the API or the worker, so an upload
  answers `STORAGE_NOT_CONFIGURED`. This hits employee documents, the Excel import and the business logo.
- **Worker-only jobs** run there, but you only see their result (a bell message), never a screen.

من #533 (2026-10-23) الستاجنج شغال كله على Dokploy وبيتحدّث بعد كل merge: لوحة الإدارة على
`https://app.staging.pospay.systems`، والكاشير على `https://pos.staging.pospay.systems`، والـ API على
`https://api.staging.pospay.systems` ومعاه الـ worker. البيانات تجريبية بس: شركة «صالون الأميرة (تجريبي)» بفرعين، السالمية وحولي،
و8 خدمات و7 موظفين. لسه مقفول هناك: إرسال الواتساب والـ OTP (مستني قوالب Meta والأسرار)، ورفع الملفات (مفيش إعدادات تخزين)،
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

The status paragraph inside journeys 01–47 was written before #533 and may still say the admin or POS is not deployed. This table
is the current answer.

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
| 23 | [Request leave](23-request-leave.md) — طلب إجازة | #95 | manager side yes; the employee's own request is API only (no staff-app screen) |
| 24 | [Decide leave](24-decide-leave.md) — اعتماد الإجازات | #98 | yes (`/leave`); the employee's view is API only; no notification sent |
| 25 | [Unbind a passkey](25-unbind-passkey.md) — فك ربط مفتاح المرور | #97, #100 | manager unbind yes; re-enrolment needs the personal session (OTP OFF) |
| 26 | [Clock in and out from the personal phone](26-clock-attendance.md) — تسجيل الحضور والانصراف من الهاتف الشخصي | #99 | no: the personal session needs OTP (OFF); the card clock (30) works |
| 27 | [Import employees from Excel](27-employee-import.md) — استيراد الموظفين من Excel | #107 | screen exists; the upload fails (no object storage on staging) |
| 28 | [Document expiry alerts](28-document-expiry.md) — تنبيه انتهاء الوثائق | #110 | worker job on staging; nobody is notified yet; documents need object storage |
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
| 48 | [Clear an expired recording with your own visits of that day](48-reception-own-recordings.md) — حسم تسجيل منتهي من زياراتك في اليوم ده | #230, #231, #233, #234 | yes, but only after a save stays unresolved 25 h in the same open tab; no browser test yet |
| 49 | [Edit the price or discount of a saved service](49-price-discount-edit.md) — تعديل سعر أو خصم خدمة محفوظة | #253, #254, #266, #288, #304, #312, #323, #334, #353, #354, #357, #360, #361 | yes; needs the `orders` feature; the bell comes from the worker and follows the alert rules (58) |
| 50 | [Record a visit's tips](50-visit-tips.md) — تسجيل بقشيش الزيارة | #336, #339, #345, #366, #383, #398 | yes; needs the `orders` feature |
| 51 | [Cancel a saved service line](51-cancel-service-line.md) — إلغاء خدمة محفوظة | #322, #341, #346, #364, #386, #390, #395 | yes; the bell comes from the worker and follows the alert rules (58) |
| 52 | [Change who performed a saved service](52-change-line-performers.md) — تغيير منفّذين خدمة محفوظة | #330, #333, #405, #414, #430, #432, #433, #437, #445, #448, #456 | yes; the bell comes from the worker and follows the alert rules (58) |
| 53 | [Giving and managing the employee number](53-employee-number.md) — إدّي الموظفة رقمها وظبّطه | #291, #335, #340, #372, #375, #376, #377, #380, #388, #396 | yes; the Excel import part needs object storage (not set) |
| 54 | [Seeing and searching the employee number](54-employee-number-everywhere.md) — الرقم الوظيفي في كل الشاشات والبحث بيه | #317, #320, #344, #371, #379 | yes |
| 55 | [Business identity](55-business-identity.md) — هوية النشاط | #365, #384, #392, #393, #394, #397 | names yes; logo upload fails (no object storage on staging) |
| 56 | [The PDF renderer](56-pdf-renderer.md) — محرّك ملفات الـ PDF | #413, #425, #426 | nothing to click (worker capability; no document kind registered yet) |
| 57 | [Discount approval (foundation)](57-discount-approval.md) — الموافقة على خصم فوق الحد (الأساس) | #465, #469, #498, #504, #523 | foundation only: the permission shows on `/permissions`; no request/approve route or screen yet; the bell never rings yet |
| 58 | [Alert rules](58-alert-rules.md) — قواعد التنبيهات | #467, #493, #501, #503, #510, #521 | API and worker on staging; no screen yet; you see it only in which bells arrive |
| 59 | [Staff app settings: columns and months back](59-staff-app-settings.md) — إعداد تطبيق الموظفات: الأعمدة وعدد الشهور | #468, #513, #516 | API on staging; no screen yet; nothing reads the setting yet |
| 60 | [Staff push subscriptions](60-staff-push-subscriptions.md) — اشتراك موبايل الموظفة في الإشعارات | #530 | API on staging; no screen yet; needs the personal session (OTP OFF) and push keys (not in the staging env); nothing is sent yet |

New journeys are added after every merge.
