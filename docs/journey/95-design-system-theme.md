# 95 · The new look and the light / dark switch — الشكل الجديد ومفتاح فاتح / غامق

**Status / الحالة:** shipped in #1079 (DS-1: the Souk Tiles design system foundations: colours, fonts, light and dark
themes, the theme switch, new app icons; ADR-0059) and #1083 (DS-2: every icon moved from lucide-react to Phosphor;
ADR-0060), both merged, as is #1095 (DS-3 A1: the theme switch behaves the same on every page, including before sign-in);
DS-3 A3 (the native app icons) is in review. **Runs on staging** in the admin (`https://app.staging.pospay.systems`) and the POS
(`https://pos.staging.pospay.systems`). Nothing in how the business works changed: the same screens, the same text,
the same rules. Still to come, as follow-ups named in ADR-0059: the app shell, navigation, dashboard, charts and
permissions screens redrawn in the new style.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the admin and the POS; or staging.
- A browser whose system theme you can switch between light and dark.
- Signed in to the admin ([01](01-admin-sign-in-and-totp.md)); for the POS, an employee signed in on a paired device
  ([08](08-staff-login-pos.md)).

## العربي

1. **الشكل الجديد:** افتح لوحة الإدارة ← الألوان والخطوط الجديدة (Readex Pro و Baloo Bhaijaan 2)، وأيقونة التطبيق
   الجديدة في تبويب المتصفح.
2. **حسب النظام:** أول مرة، الشاشة بتمشي مع وضع الجهاز: جهاز غامق ← الشاشة غامقة، من غير وميض فاتح وقت التحميل.
3. **المفتاح:** تحت في القائمة الجانبية فيه **وضع العرض** وفيه تلات اختيارات: **فاتح**، **غامق**، **حسب النظام**.
4. **غامق:** اختار **غامق** ← كل الشاشة بتتحوّل غامق فورًا، ولون شريط المتصفح بيتغيّر معاها.
5. **بيفضل:** اعمل تحديث للصفحة ← الوضع زي ما اخترته. افتح تبويب تاني لنفس الموقع ← نفس الوضع.
6. **حسب النظام تاني:** اختار **حسب النظام** وغيّر وضع الجهاز ← الشاشة بتتبعه.
7. **في الكاشير:** على جهاز الكاشير بعد دخول الموظفة، نفس المفتاح **وضع العرض** في لوحة الموظفة، وبيشتغل بنفس
   الطريقة. الكاشير بيفضل شغال من غير نت زي الأول، والخطوط والأيقونات الجديدة محفوظة معاه.
8. **الأيقونات:** كل الأيقونات في القائمة والأزرار بقت من مكتبة واحدة (Phosphor)، ومفيش أيقونة ناقصة أو مكانها فاضي.
9. **العربي:** بدّل اللغة للعربي ← الاتجاه من اليمين للشمال، والخط العربي الجديد، ومفيش حاجة مقلوبة.
10. **أيقونة التطبيق (DS-3 A3):** على موبايل فيه تطبيق «PosPay Business» (نسخة التجربة أو الإنتاج) ← أيقونته على الشاشة
    الرئيسية فيها حرف P بنقشة Souk Tiles على خلفية كريمي ودايرة «B» في الركن، زي أيقونة الويب، ومفيش P برتقالي. نسخة
    التجربة عليها كمان شريط «تجربة». وشاشة الفتح بتبدأ بنفس نقشة Souk Tiles P (من غير دايرة «B») على خلفية كريمية
    فاتحة وتحتها «PosPay Business» بالكحلي، من غير P برتقالي (#1103).
11. **قبل الدخول (#1095):** افتح تبويبين: واحد جوّه لوحة الإدارة، والتاني على صفحة تسجيل الدخول (أو شاشة الكاشير قبل
    دخول الموظفة). غيّر الوضع من الأول ← التاني بيتغيّر فورًا من غير تحديث.
12. **المتصفح رافض التخزين (#1095):** لو المتصفح مانع الحفظ (تصفح خاص مثلًا) واخترت **غامق** ← الشاشة بتفضل غامقة
    حتى لو وضع الجهاز اتغيّر، لحد ما تقفل الصفحة.

**ممنوع يحصل:**
- نص مش مقروء في الوضع الغامق (نص غامق على خلفية غامقة) في أي شاشة.
- وميض بالوضع الفاتح قبل ما الغامق يتحمّل.
- الاختيار يضيع بعد التحديث، أو تبويبين لنفس الموقع بوضعين مختلفين (حتى لو واحد منهم صفحة تسجيل الدخول).
- اختيار صريح يتلغي لوحده لما وضع الجهاز يتغيّر.
- خطوط أو أيقونات تتحمّل من موقع خارجي (كلها محفوظة مع التطبيق).
- الكاشير يبطل يشتغل من غير نت، أو يتغيّر عنوان بدايته أو طريقة تثبيته.
- أي سلوك أو نص أو رقم في الشغل يتغيّر بسبب الشكل الجديد.

## English

1. **The new look:** open the admin → the new colours and fonts (Readex Pro and Baloo Bhaijaan 2), and the new app
   icon in the browser tab.
2. **Follows the system:** the first time, the screen follows the device: a dark device → a dark screen, with no
   light flash while it loads.
3. **The switch:** at the bottom of the sidebar there is **Display theme** with three choices: **Light**, **Dark**,
   **System**.
4. **Dark:** choose **Dark** → the whole screen turns dark at once, and the browser's bar colour changes with it.
5. **It stays:** reload the page → the theme is as you chose. Open another tab of the same site → the same theme.
6. **System again:** choose **System** and change the device's theme → the screen follows it.
7. **On the POS:** on the cashier device, after an employee signs in, the same **Display theme** switch is in the
   operator panel and works the same way. The POS keeps working offline as before, with the new fonts and icons
   cached.
8. **Icons:** every icon in the menu and on the buttons now comes from one library (Phosphor), and no icon is
   missing or blank.
9. **Arabic:** switch the language to Arabic → right-to-left layout, the new Arabic font, and nothing mirrored
   wrongly.
10. **The app icon (DS-3 A3):** on a phone with the «PosPay Business» app (the test or the production build) → its
    home-screen icon shows the P in the Souk Tiles pattern on a cream background with the «B» circle in the corner,
    like the web icon, and no orange P. The test build also carries the «تجربة» strip. The launch screen opens with
    the same Souk Tiles P (without the «B» circle) on a light cream background and «PosPay Business» under it in navy,
    with no orange P (#1103).
11. **Before sign-in (#1095):** open two tabs: one inside the admin, the other on the sign-in page (or the POS screen
    before an employee signs in). Change the theme in the first → the second changes at once, with no reload.
12. **The browser refuses to store (#1095):** if the browser blocks saving (private browsing, for example) and you
    choose **Dark** → the screen stays dark even when the device's theme changes, until you close the page.

**Must NOT happen:**
- Unreadable text in dark mode (dark text on a dark background) on any screen.
- A light flash before the dark theme loads.
- The choice lost after a reload, or two tabs of one site in different themes (the sign-in page included).
- An explicit choice undone by itself when the device's theme changes.
- Fonts or icons loaded from an outside site (they ship with the app).
- The POS no longer working offline, or its start address or install behaviour changing.
- Any behaviour, text or number of the business changing because of the new look.

## For an agent

- **Screens:** every admin screen (local `http://localhost:3001`) and the POS (local `http://localhost:5173`). The
  switch is `ThemeSwitch` from `packages/ui/src/theme-switch.tsx`, mounted in
  `apps/admin/app/(dashboard)/_frame/dashboard-sidebar.tsx` and `apps/pos/src/staff-login/ui/staff-home.tsx`.
- **Selectors:** the group **وضع العرض** / **Display theme** with **فاتح** / **Light**, **غامق** / **Dark**, **حسب
  النظام** / **System** (keys `theme.label`, `theme.light`, `theme.dark`, `theme.system` in
  `packages/i18n/src/{ar,en}.ts`).
- **State:** the choice is stored under the `localStorage` key `pospay-theme` (`THEME_STORAGE_KEY` in
  `packages/ui/src/theme.ts`); a boot script reads it before the first paint; with storage blocked the system theme
  is still applied. From #1095 the boot script and the switch share one runtime, `window.__pospayTheme` (`get`, `set`,
  `subscribe`), which also holds the `storage` and `prefers-color-scheme` listeners on pages with no switch.
- **Assertions:** no request leaves for a font or icon CDN; `lucide-react` is no longer imported
  (`@phosphor-icons/react` only); the POS manifest scope, start URL and display mode are unchanged.
- **The public rating page:** `apps/menu` has the same look and follows the device theme, with no switch (PP-200);
  its steps are in [77](77-public-rating-page.md).
- **Sources:** `docs/adr/0059-souk-tiles-design-system.md`, `docs/adr/0060-phosphor-icons.md`,
  `docs/design/BRAND-GUIDE.md`, `packages/ui/README.md`.
