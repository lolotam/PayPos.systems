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

## Journeys

Since #80 the admin has a dark sidebar (logo, company/business/branch, navigation, account and authenticator at the bottom) and a slim top row (notifications bell, language). On a phone the sidebar opens from the ☰ button.
من بعد #80 لوحة الإدارة فيها قائمة جانبية كحلي (اللوجو، الشركة/النشاط/الفرع، القائمة، والحساب والمصادقة تحت) وشريط صغير فوق (الجرس واللغة). على الموبايل القائمة بتفتح من زرار ☰.

| # | Journey | Shipped in | Runs on staging? |
|---|---|---|---|
| 00 | [Local setup](00-local-setup.md) — تشغيل النظام على جهازك | — | — |
| 01 | [Admin sign-in and the authenticator app](01-admin-sign-in-and-totp.md) — دخول لوحة الإدارة وتطبيق المصادقة | #53 | not yet (admin not deployed, issue #54) |
| 02 | [Choosing the company, business and branch](02-admin-workspace-selector.md) — اختيار الشركة والنشاط والفرع | #52, #53 | not yet |
| 03 | [Pairing a POS device](03-pos-device-pairing.md) — ربط جهاز الكاشير | #55 | not yet (POS not deployed) |
| 04 | [The notifications bell](04-admin-notifications-bell.md) — جرس الإشعارات | #58 | not yet |
| 05 | [A customer replies STOP on WhatsApp](05-whatsapp-stop.md) — العميل يرد "إيقاف" | #60 | needs Meta webhook + secrets |
| 06 | [Commission engine I](06-commission-engine-i.md) — حساب العمولة (المرحلة الأولى) | #64 | nothing to deploy (no screen yet) |
| 07 | [Package value and sessions](07-package-allocation.md) — قيمة الباقة وجلساتها | #65 | nothing to deploy (no screen yet) |
| 08 | [Staff sign-in on the POS](08-staff-login-pos.md) — دخول الموظف على جهاز الكاشير | #61 | not yet (POS not deployed); WhatsApp codes need Meta templates + secrets |
| 09 | [The branch attendance QR](09-attendance-qr.md) — باركود الحضور على جهاز الفرع | #72 | not yet (POS not deployed) |
| 10 | [Find or create a customer by phone](10-customer-find-or-create.md) — البحث عن عميل أو إضافته برقم الموبايل | #71 | API only until PR 35 |
| 11 | [The email channel (built, sending off)](11-email-channel-disabled.md) — قناة الإيميل (جاهزة، والإرسال مقفول) | #75 | nothing to test live until feedback intake ships |
| 12 | [The permissions screen](12-permissions-screen.md) — شاشة الصلاحيات | #73 | not yet (admin not deployed, issue #54) |
| 13 | [Create employee](13-create-employee.md) — إضافة موظف | #79 | not yet (admin not deployed, issue #54) |
| 14 | [Private files](14-private-files.md) — الملفات الخاصة | #82 | API only (no screen yet; deployment not verified here) |
| 15 | [Per-person discount limit](15-discount-limit.md) — حد الخصم للشخص | #84 | not yet (admin not deployed, issue #54) |
| 16 | [Update employee](16-update-employee.md) — تعديل الموظف | #83 | not yet (admin not deployed, issue #54) |
| 17 | [Business discount default](17-business-discount-default.md) — حد الخصم الافتراضي للنشاط | #86 | not yet (admin not deployed, issue #54) |
| 18 | [Set salary](18-set-salary.md) — تعيين الراتب | #88 | not yet (admin not deployed, issue #54) |
| 19 | [Schedules](19-schedules.md) — جداول العمل | #89 | not yet (admin not deployed, issue #54); templates API only |
| 20 | [Role default permissions](20-role-default-permissions.md) — صلاحيات الدور الافتراضية | #91 | not yet (admin not deployed, issue #54) |
| 21 | [Role follow-ups](21-role-followups.md) — تكملة صلاحيات الأدوار | #93 | not yet (admin not deployed, issue #54); customer creation API only until PR 35 |
| 22 | [Personal phone passkey](22-personal-phone-passkey.md) — مفتاح المرور على الموبايل الشخصي | #94 | not yet (POS not deployed); OTP sending OFF pending Meta templates + secrets; tests/local seams only |

New journeys are added after every merge.
