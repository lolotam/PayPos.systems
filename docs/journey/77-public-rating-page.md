# 77 · The customer's rating page — صفحة تقييم العميلة

**Status / الحالة:** shipped in #704 (58-2b: the one-way rating opt-out guard on the customer), #731 (58-2c: opting
out from the rating link), #738 (60-1: the public view and submit API) and #847 (60-2: the public page in
`apps/menu` and its own CORS origin), all merged (spec 060 rows 58 and 60, ADR-0011, ADR-0058); #1105 (DS-3 A4:
the page's new look, and light / dark by the device setting; ADR-0059 addendum, PP-200) is in review. **Not reachable by a
real customer yet:** nothing sends the link (row 59b-3, see [76](76-rating-requests.md)), and the staging compose
has no `menu` service, so the page is **not deployed on staging**. The three public API routes are in the API; they
accept a browser only from the exact origin in `RATING_PAGE_ORIGIN`. You can run the page locally with a link made
in a test.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and `apps/menu` running, `RATING_PAGE_ORIGIN` set to the local
  menu origin and `NEXT_PUBLIC_API_URL` to the local API.
- A rating link for a synthetic customer, made by a test fixture: the token is `<company_id>.<random>` and sits in
  the URL **fragment** (`<menu origin>/#<token>`). No real phone numbers.
- The link is valid for 7 days.

## العربي

1. **افتح اللينك:** العميلة تفتح اللينك ← **جاري التحميل…** وبعدها **قيّمي زيارتك لـ** واسم النشاط، وتحته
   **التقييم** (خمس نجوم) وخانة **اكتبي ملاحظتك (اختياري)** وزرار **ابعتي التقييم**. مفيش أي حاجة تانية في الصفحة:
   لا اسمها، ولا الخدمة، ولا السعر.
2. **اللغة:** الصفحة عربي ومن اليمين للشمال؛ زرار **English** بيحوّلها إنجليزي، وهناك الزرار اسمه **العربية**.
3. **ابعتي:** تختار 4 نجوم وتكتب ملاحظة وتدوس **ابعتي التقييم** ← النموذج بيختفي ومكانه **شكراً، وصلنا تقييمك**.
4. **إدخال غلط:** من غير نجوم، أو ملاحظة أطول من 1000 حرف، أو فيها لينك ← **اختاري من نجمة لخمس نجوم وملاحظة نصية
   لحد ١٠٠٠ حرف، من غير روابط.** ومفيش حاجة بتتبعت.
5. **مرة واحدة:** تفتح نفس اللينك تاني بعد التقييم ← **شكراً، وصلنا تقييمك** من غير النموذج، ومن غير ما التقييم أو
   الملاحظة يتعرضوا.
6. **مش عايزة رسايل:** تدوس **مش عايزة رسايل تقييم تاني** ← **تمام، مش هنبعتلك رسايل تقييم تاني**. الزرار ده شغال
   قبل التقييم وبعده، لحد ما اللينك ينتهي. بعد الإلغاء تقدر تقيّم الزيارة دي عادي.
7. **لينك منتهي أو غلط:** بعد 7 أيام، أو لينك متغيّر فيه حرف ← **الرابط ده مش متاح.** نفس الرسالة للحالتين.
8. **النت قطع:** ← **حصل خطأ. حاولي تاني.** وزرار **حاولي تاني**.
9. **طلبات كتير:** طلبات كتير من نفس الـ IP ← السيرفر بيرد 429 (`TOO_MANY_REQUESTS`) ومعاه `Retry-After`.
10. **الشكل (#1105):** الصفحة بألوان وخطوط النظام الجديدة: النموذج جوّه كارت، وكل نجمة زرار فيه رقم وأيقونة نجمة،
    والنجمة اللي اختارتها بتتلوّن. وأيقونة PosPay في تبويب المتصفح.
11. **فاتح وغامق (#1105):** موبايلها على الوضع الغامق ← الصفحة بتفتح غامقة من غير وميض فاتح، ولون شريط المتصفح
    غامق معاها. موبايلها فاتح ← الصفحة فاتحة. لو غيّرت وضع الجهاز والصفحة مفتوحة ← الصفحة بتتغيّر لوحدها. مفيش زرار
    في الصفحة يغيّر الوضع.

**ممنوع يحصل:**
- الصفحة تعرض أي حاجة غير اسم النشاط والنموذج (اسم العميلة، رقمها، الخدمة، الموظفة، السعر).
- تقييمين من نفس اللينك.
- إلغاء رسايل التقييم يترجع تاني من اللينك (الإلغاء اتجاه واحد).
- الرد يفرّق بين لينك منتهي ولينك مش موجود.
- الـ token يظهر في الـ query string، أو في عنوان الصفحة، أو يتخزّن في المتصفح.
- متتبّع، أو تحليلات، أو service worker في الصفحة.
- زرار تبديل وضع (فاتح / غامق) في الصفحة، أو اختيار وضع يتحفظ في متصفح العميلة.
- نص مش مقروء في الوضع الغامق، أو وميض فاتح قبل ما الغامق يتحمّل.
- حاجة مقلوبة غلط في العربي (الصفحة من اليمين للشمال)، أو في الإنجليزي (من الشمال لليمين).

## English

1. **Open the link:** the customer opens it → **Loading…**, then **Rate your visit to** and the business name, with
   **Rating** (five stars), the field **Write your note (optional)** and the button **Send rating**. Nothing else is
   on the page: not her name, not the service, not the price.
2. **Language:** the page is Arabic and right-to-left; the **English** button switches it, and there the button
   reads **العربية**.
3. **Send:** she picks 4 stars, writes a note and clicks **Send rating** → the form is replaced by **Thank you, we
   received your rating**.
4. **Bad input:** no stars, a note over 1,000 characters, or one with a link → **Choose 1–5 stars and a plain-text
   note of up to 1,000 characters, without links.** and nothing is sent.
5. **Once only:** opening the same link again after rating → **Thank you, we received your rating** without the
   form, and without showing the rating or the note.
6. **No more messages:** she clicks **No more rating messages** → **Okay, we will not send you rating messages
   again**. This button works before and after rating, until the link expires. After opting out she can still rate
   this visit.
7. **An expired or wrong link:** after 7 days, or a link with one character changed → **This link is unavailable.**
   The same message for both.
8. **Network failure:** → **Something went wrong. Please try again.** with **Try again**.
9. **Too many requests:** many requests from one IP → the server answers 429 (`TOO_MANY_REQUESTS`) with
   `Retry-After`.
10. **The look (#1105):** the page uses the new colours and fonts: the form sits in a card, each star is a button
    with its number and a star icon, and the chosen one is coloured. The PosPay icon shows in the browser tab.
11. **Light and dark (#1105):** her phone is in dark mode → the page opens dark with no light flash, and the
    browser's bar is dark with it. A light phone → a light page. Changing the device's theme while the page is open →
    the page follows by itself. There is no button on the page that changes the theme.

**Must NOT happen:**
- The page showing anything but the business name and the form (her name or phone, the service, the employee, the
  price).
- Two ratings from one link.
- A rating opt-out undone through the link (it is one-way).
- An answer that tells an expired link from an unknown one.
- The token in the query string or the page title, or stored in the browser.
- A tracker, analytics or a service worker on the page.
- A theme switch (light / dark) on the page, or a theme choice stored in the customer's browser.
- Unreadable text in dark mode, or a light flash before the dark theme loads.
- Anything mirrored wrongly in Arabic (right-to-left) or in English (left-to-right).

## For an agent

- **Page:** `apps/menu` (`app/page.tsx`, `src/ratings/pages/rating-page.tsx`, `rating-screen.tsx`,
  `src/ratings/ui/rating-form.tsx`); the token is read from `window.location.hash` and sent only in the
  `x-rating-token` header. Text in `packages/i18n/src/public-rating-catalog.ts`.
- **Look and theme:** `apps/menu/app/layout.tsx` renders `THEME_COLOR_METAS` and `THEME_BOOT_SCRIPT` from
  `packages/ui/src/theme.ts`; there is no `ThemeSwitch`, so the `localStorage` key `pospay-theme` is never written on
  this origin and the page follows `prefers-color-scheme` (emulate it in the browser to test; in development, clear
  that key first if the admin or the POS ran on the same `localhost` port). The `dark` class is
  on `<html>`. The stars are five radios named `1`–`5`. Favicons are
  `apps/menu/app/{favicon.ico,icon.png,apple-icon.png}`; there is no web manifest.
- **API** (`apps/api/src/modules/customers/http/`, all `@Public()`, no session): `GET /v1/ratings/view` ·
  `POST /v1/ratings/submit` · `POST /v1/ratings/opt-out`. The view returns only the business name and the state
  (`submitted` once the token is consumed).
- **Rules:** token `<company_id>.<256-bit random>`; its stored full hash and 7-day expiry are checked inside
  `withTenant()`; submit consumes it once by an atomic update; opt-out keeps the first `opted_out_at` and is audited
  as `customer.rating_opted_out` with no phone (spec 060 FR-B10, FR-B11; `CLAUDE.md` §5).
- **Errors:** `TOO_MANY_REQUESTS` 429 with `Retry-After` (per-IP limiter).
- **Tests to mirror:** `apps/menu/src/ratings/pages/rating-page.spec.tsx` ("shows only the business name and form",
  "submits once, replaces the form with completion, and permits opt-out afterward", "reopens a consumed link with
  completion and opt-out but no form"); `apps/menu/src/root-layout.spec.tsx` for the theme metas, the boot script
  and the absence of a theme control.
- **Sources:** `docs/adr/0011-public-rating-link.md`, `docs/adr/0058-rating-only-menu-shell.md`,
  `docs/adr/0059-souk-tiles-design-system.md` (DS-3 A4 addendum), `docs/owner-decisions.ar.md` item 120 (PP-200),
  `docs/specs/060-ratings-and-staff-app/spec.md` (rows 58-2, 60-1, 60-2).
