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

New journeys are added after every merge.
