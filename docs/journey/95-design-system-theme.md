# 95 · The new look and the light / dark switch — الشكل الجديد ومفتاح فاتح / غامق

**Status / الحالة:** shipped in #1079 (DS-1: the Souk Tiles design system foundations: colours, fonts, light and dark
themes, the theme switch, new app icons; ADR-0059) and #1083 (DS-2: every icon moved from lucide-react to Phosphor;
ADR-0060), both merged. **Runs on staging** in the admin (`https://app.staging.pospay.systems`) and the POS
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

**ممنوع يحصل:**
- نص مش مقروء في الوضع الغامق (نص غامق على خلفية غامقة) في أي شاشة.
- وميض بالوضع الفاتح قبل ما الغامق يتحمّل.
- الاختيار يضيع بعد التحديث، أو تبويبين لنفس الموقع بوضعين مختلفين.
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

**Must NOT happen:**
- Unreadable text in dark mode (dark text on a dark background) on any screen.
- A light flash before the dark theme loads.
- The choice lost after a reload, or two tabs of one site in different themes.
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
  is still applied.
- **Assertions:** no request leaves for a font or icon CDN; `lucide-react` is no longer imported
  (`@phosphor-icons/react` only); the POS manifest scope, start URL and display mode are unchanged.
- **Sources:** `docs/adr/0059-souk-tiles-design-system.md`, `docs/adr/0060-phosphor-icons.md`,
  `docs/design/BRAND-GUIDE.md`, `packages/ui/README.md`.
