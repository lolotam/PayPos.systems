# 101 · Admin navigation styles (planned — spec 074) — أنماط تنقّل لوحة الإدارة الثلاثة (مخطط — مواصفة 074)

> **Update 2026-11-23 (074-7b):** the step 7 part of this plan is now built; its runnable journey is [102](102-choose-navigation-style.md). Step 12 (saving the choice on the account) is still planned.

> **Step 074-3 + 074-8 note (2026-11-22) — ملاحظة الخطوة 074-3 + 074-8:** three pages already use the shared page layout **before step 7**: Services (`/catalog`) on the list template, Add service (`/catalog/create`) on the 840px form template, and Business identity (`/business-identity`) on the two-column template (main 2fr / side 1fr from 1024px), including the Services table's stacked rows under 600px and the shared `PageHeader`/`PageShell`/`DataTableFrame`/`PageShell` parts in `packages/ui`. Nothing in the frame changes yet: the sidebar, the theme switch and every route stay as they are until step 7, and steps 074-9 and 074-11 skip these three pages because they are already migrated.
>
> **ملاحظة بالعربي:** ثلاث صفحات تستخدم تخطيط الصفحة المشترك **قبل الخطوة 7**: الخدمات (`/catalog`) على قالب القائمة، إضافة خدمة (`/catalog/create`) على قالب النماذج بعرض 840px، وهوية النشاط (`/business-identity`) على القالب ثنائي الأعمدة (الرئيسي 2fr والجانبي 1fr من 1024px)، مع صفوف الجدول المكدّسة تحت 600px وأجزاء `PageHeader` و`PageShell` و`DataTableFrame` المشتركة في `packages/ui`. لا يتغير الإطار بعد: الشريط الجانبي ومفتاح الوضع وكل المسارات تبقى كما هي حتى الخطوة 7، والخطوتان 074-9 و074-11 تتخطيان هذه الصفحات الثلاث لأنها مهيّرة بالفعل.

**Status / الحالة:** **The three styles are live since 074-7b; step 12 (cross-browser account sync) is still planned.** Step `074-0b` records the governing owner decisions (`PP-214`), the ADR addenda (`ADR-0003` and `ADR-0059`), the narrow `CLAUDE.md` §8 audit exception (`NAV-Q16`), and this bilingual journey record (`PP-196.4`). **Live since 074-7b, old sidebar removed in 074-7c:** `apps/admin` draws every dashboard page inside one of the three switchable styles (default C), with `/appearance`, `/approvals`, `/overview/[group]`, `/soon/[page]` and the moved `/security/two-factor` inside the frame, and `ThemeSwitch` on the Appearance page and in the account menu; the old flat sidebar (`dashboard-sidebar.tsx`, `dashboard-navigation.tsx`, the `*-nav-item.tsx` files) is deleted. Still planned: the `user.nav_style` column and `GET`/`PUT /v1/me/preferences` (step 12). Page layout templates follow in **steps 8–11** (with Services, Add service and Business identity already on the shared templates since 074-3 + 074-8). The cashier app (`apps/pos`, `NAV-Q3`/`NAV-Q11`) and `lovable-pospay` (`NAV-Q2`) are outside this spec.

**الحالة بالعربي:** **الستايلات الثلاثة شغّالة منذ 074-7b؛ الخطوة 12 (مزامنة الحساب عبر المتصفحات) ما زالت مخططًا.** الخطوة `074-0b` توثّق قرارات المالك (`PP-214`) وملحقَي `ADR-0003` و`ADR-0059` واستثناء التدقيق في `CLAUDE.md` §8 (`NAV-Q16`) وملف الرحلة ثنائي اللغة هذا (`PP-196.4`). **شغّالة منذ 074-7b، والقائمة الجانبية القديمة حُذفت في 074-7c:** لوحة الإدارة ترسم كل صفحة من صفحات اللوحة داخل أحد الستايلات الثلاثة القابلة للتبديل (الافتراضي C)، مع شاشة المظهر وصندوق الاعتمادات و`/overview/[group]` و`/soon/[page]` و`/security/two-factor` بعد نقلها داخل الإطار، ومفتاح الوضع الفاتح/الداكن في صفحة المظهر وقائمة الحساب؛ والقائمة الجانبية القديمة (`dashboard-sidebar.tsx` و`dashboard-navigation.tsx` وملفات `*-nav-item.tsx`) محذوفة. ما زال مخططًا: عمود `user.nav_style` ومسارا `GET`/`PUT /v1/me/preferences` (الخطوة 12). وتوحيد تخطيط الصفحات في **الخطوتين 8–11**.

**Before you start / قبل ما تبدأ:**
- **Step `074-0b` (today):** nothing new to click in the browser yet; verify only the live baseline ([95](95-design-system-theme.md)) and the decision records listed under Sources below.
- **After step 7 merges and deploys (planned):** [00 Local setup](00-local-setup.md) with `apps/admin` (or staging), signed in ([01](01-admin-sign-in-and-totp.md)), plus a user with minimal permissions to test permission-free switching. Exact Arabic/English labels are working names from `spec.md` and `app-map.md` until step 2 adds the `packages/i18n` keys.
- **After step 12 merges and deploys (planned):** a second browser or private window for the cross-browser account sync step.

## العربي (مخطط — يُختبر بعد دمج الخطوة 7، ومزامنة الحساب بعد الخطوة 12)

1. **الافتراضي (الخطوة 7، مخطط):** سجّل دخول بمستخدم لم يختر ستايل من قبل ← لوحة الإدارة تفتح على **الستايل C** (شريط أيقونات يضم 5 مساحات عمل + لوحة سياقية بصفحات المساحة الحالية).
2. **تمييز الصفحة الحالية (الخطوة 7، مخطط):** افتح أي صفحة مبنية في الإدارة، بما فيها أعمدة تطبيق الموظفين وصفحة تطبيق المصادقة (`/security/two-factor`) ← يظهر عنصر رئيسي واحد فقط محدد كصفحة حالية في كل مرة.
3. **التبديل بين الستايلات الثلاثة (الخطوة 7، مخطط):** من صفحة **المظهر** (`/appearance`، مخططة)، اختر من الصفحة أو **قائمة الحساب** بالترتيب **A — شريط جانبي وتبويبات** ثم **B — شريط علوي ومحاور** ثم **C — شريط أيقونات ولوحة** ← يتغيّر إطار التنقّل فورًا دون إعادة تحميل كاملة ويظل عنوان صفحة المظهر كما هو. في اختبار مستقل، افتح صفحة نظرة عامة في B وبدّل إلى A من قائمة الحساب ← تفتح أول صفحة متاحة في المجموعة. كرّر بحساب لا يرى أي صفحة فيها ← تفتح الرئيسية. لو الحساب ده ما يقدرش يفتح النظرة العامة في B، افتح عنوانها المحفوظ في A وتأكد من فتح الرئيسية.
4. **بلا صلاحية (الخطوة 7، مخطط):** سجّل دخول بمستخدم بأقل صلاحيات ← يستطيع فتح صفحة **المظهر** وتغيير الستايل دون الحاجة لأي صلاحية خاصة.
5. **ثبات الاختيار بعد التحديث (الخطوة 7، مخطط):** اختر الستايل B وأعد تحميل الصفحة ← أوّل رسم يظهر هو الستايل B مباشرة (من كوكي `pospay_nav_style`) دون وميض بستايل آخر.
6. **مكان مفتاح الوضع الفاتح/الداكن (الخطوة 7، مخطط — NAV-Q5):** في الستايلات الثلاثة، مفتاح الوضع الفاتح/الغامق/حسب النظام موجود في صفحة **المظهر** وفي **قائمة الحساب**، وليس في أسفل الشريط الجانبي؛ وتغيير الستايل لا يغيّر الوضع المختار ولا اللغة.
7. **صندوق الاعتمادات (الخطوة 7، مخطط — NAV-Q17):** افتح **صندوق الاعتمادات** (`/approvals`، مخططة) تحت «الرئيسية» في أي ستايل ← يعرض أنواع الاعتمادات الموجودة (الإجازات، طلبات الحضور، تنبيهات الحضور) مع رابط لكل صفحة قائمة، ويحترم صلاحية كل نوع.
8. **خريطة المنتج الكاملة وصفحات «قيد التطوير» (الخطوة 7، مخطط — NAV-Q13/Q14/Q15):** تصفّح القوائم ← تظهر أقسام منطقة الإدارة المناسبة لنوع النشاط المختار ودور المستخدم فقط، والمدخلات غير المبنية تحمل علامة «قريبًا / Soon» (غير معتمدة على اللون وحده) وتفتح صفحة **قيد التطوير** الموحدة (`/soon/[page]`، مخططة) باسم الصفحة ورابط العودة للرئيسية دون تاريخ أو رقم مرحلة.
9. **تبديل النشاط (الخطوة 7 بعد الخطوة `0c`، مخطط — NAV-Q17):** في بيئة محلية ببيانات اصطناعية، استخدم حساب اختبار واحد له وصول لمطعم وصالون. جهّز في بيئة الاختبار مسارًا مبنيًا تجريبيًا خاصًا بالمطاعم فقط ومدخلًا له في نموذج التنقّل. اختر الستايل C لفتح باحث الصفحات. في سياق المطعم تأكد من ظهور المدخل التجريبي ومدخل شاشات ومحطات المطبخ «قيد التطوير» في القائمة والبحث، وافتح الصفحتين واحفظ عنوانيهما. بدّل للصالون ← تختفي المدخلات الخاصة بالمطعم وتظهر مدخلات الصالون في القائمة والبحث. افتح العنوانين المحفوظين في سياق الصالون وتأكد من عدم عرض الصفحة المبنية وظهور «غير موجودة» لرابط «قيد التطوير».
10. **ثلاثة مقاسات والاتجاه العربي (الخطوة 7، مخطط):** اختبر على 1280 و820 و390 بكسل بالعربي والإنجليزي ← القائمة على اليمين بالعربي، ولا يوجد تمرير أفقي، والوصول لأي صفحة خلال 3 نقرات/لمسات على الأكثر.
11. **متصفح مشترك (الخطوة 7، مخطط):** اختر الستايل A ثم سجّل خروج ← يُمسح كوكي `pospay_nav_style`، وعند دخول مستخدم آخر لم يختر ستايل يرى الستايل C.
12. **مزامنة الحساب عبر المتصفحات (الخطوة 12، مخطط — NAV-Q6/Q10/Q12):** اختر الستايل A في متصفح، ثم سجّل دخول بنفس الحساب في متصفح ثانٍ فارغ ← يظهر الستايل A من أول شاشة (عبر `GET`/`PUT /v1/me/preferences` وعمود `user.nav_style`) دون أن يؤثر ذلك على مستخدم آخر في نفس الشركة؛ ولو تعذّر الحفظ على السيرفر، يستمر التبديل محليًا وتظهر رسالة بأن الحفظ على الحساب لم يتم.

**ممنوع يحصل (بعد إطلاق الخطوتين 7 و12):**
- تغيّر أي لون أو خط أو نصف قطر زوايا أو شكل زر عن نظام Souk Tiles (`NAV-Q4`، `NAV-Q7`).
- بقاء مفتاح الوضع الفاتح/الداكن في أسفل الشريط الجانبي بعد الخطوة 7 (`NAV-Q5`).
- وميض بستايل مختلف عند إعادة التحميل، أو انتقال اختيار مستخدم لمستخدم آخر على نفس المتصفح بعد الخروج أو انتهاء الجلسة.
- ظهور مدخل غير مبني لنوع نشاط أو دور غير مخصص له، سواء في القائمة أو البحث أو الرابط المباشر (`NAV-Q14`).
- تمرير أفقي على الهاتف (390 بكسل) أو توقف أي رابط حالي عن العمل.
- كتابة سطر `AuditLog` لمجرد تغيير المستخدم لنمط التنقل التجميلي الشخصي (`NAV-Q16`، استثناء `CLAUDE.md` §8).

## English (planned — runnable after step 7 merges, and step 12 for account sync)

1. **Default (step 7, planned):** sign in as a user who has never chosen a style → the admin opens in **Style C** (icon rail with 5 workspaces + context panel listing the current workspace's pages).
2. **One active entry (step 7, planned):** open every built admin page, including Staff app columns and the Authenticator page (`/security/two-factor`) → exactly one top-level entry is marked current each time.
3. **Switch between the three styles (step 7, planned):** on **Appearance** (`/appearance`, planned), pick **A — Sidebar and tabs**, then **B — Top bar and hubs**, then **C — Rail and panel** from the page or the **account menu** → the frame changes immediately without a full page reload and the URL stays on Appearance. In a separate check, open a Style B overview and switch to A from the account menu → the first visible page in that group opens. Repeat with a user who can see no pages in the group → Home opens. If that user cannot open the overview in B, open its saved URL in A and verify that Home opens.
4. **No permission required (step 7, planned):** sign in as a user with minimal permissions → Appearance opens and lets them switch styles without any special permission.
5. **Reload persistence (step 7, planned):** pick Style B and reload → the first frame painted is Style B (from the `pospay_nav_style` cookie) with no flash of another style.
6. **Theme switch location (step 7, planned — NAV-Q5):** across all three styles, the light / dark / system switch lives on the **Appearance** page and in the **account menu**, and is removed from the sidebar footer; switching navigation style leaves the theme and language unchanged.
7. **Approvals inbox (step 7, planned — NAV-Q17):** open **Approvals inbox** (`/approvals`, planned) under Home in any style → lists the existing approval kinds (leave approvals, attendance requests, attendance exceptions) linking to their pages while preserving each kind's permission check.
8. **Whole product map and Under development pages (step 7, planned — NAV-Q13/Q14/Q15):** browse the menu → only Management-area entries matching the selected business type and the user's role appear; unbuilt entries carry a "Soon" mark (not colour alone) and open the shared **Under development** page (`/soon/[page]`, planned) showing the entry's name and a way back to Home, with no date or phase number.
9. **Switching businesses (step 7 after step `0c`, planned — NAV-Q17):** in a local environment with synthetic data, use one test account with access to a restaurant and a salon. Add a local test-only built route and a navigation entry restricted to restaurants. Select Style C to use the page finder. In the restaurant workspace, find the test route and the Soon entry for Kitchen screens and stations in the menu and page finder. Open both and save their URLs. Switch to the salon → restaurant-only entries disappear and salon entries appear in the menu and page finder. Open both saved URLs in the salon workspace and verify that the built page does not render and the Soon URL shows not-found.
10. **Three widths and RTL Arabic (step 7, planned):** check at 1280px, 820px, and 390px in Arabic and English → Arabic places navigation on the right, no page scrolls horizontally, and any page is reachable in at most three clicks or taps.
11. **Shared browser (step 7, planned):** choose Style A, then sign out → the `pospay_nav_style` cookie is cleared; a second user who has never chosen sees Style C on sign-in.
12. **Cross-browser account sync (step 12, planned — NAV-Q6/Q10/Q12):** choose Style A in one browser, then sign in as the same user in a second clean browser → Style A renders on first paint (via `GET`/`PUT /v1/me/preferences` and `user.nav_style`) without affecting any other user in the company; if saving to the account fails, the frame still switches locally and displays a notice that it was not saved to the account.

**Must NOT happen (after steps 7 and 12 ship):**
- Any colour, font, corner radius, or button style changing from Souk Tiles (`NAV-Q4`, `NAV-Q7`).
- The admin `ThemeSwitch` remaining in the sidebar footer after step 7 (`NAV-Q5`).
- A wrong-style flash on reload, or one user's cookie leaking to the next user after sign-out or session expiry.
- An unbuilt entry appearing for a business type or role it is not meant for in the menu, page finder, or direct URL (`NAV-Q14`).
- Horizontal scrolling at 390px, or any existing admin URL breaking.
- An `AuditLog` row written for a user changing their own cosmetic navigation style (`NAV-Q16`, `CLAUDE.md` §8 narrow exception).

## For an agent

- **Live baseline (verified on `origin/main` at `f99c51ddd` — before step 7 / step 12):**
  - Admin sidebar and live `ThemeSwitch` mount: `apps/admin/app/(dashboard)/_frame/dashboard-sidebar.tsx` (`DashboardSidebar` mounts `ThemeSwitch` from `packages/ui/src/theme-switch.tsx` in the sidebar footer).
  - POS `ThemeSwitch` mount (untouched by spec 074): `apps/pos/src/staff-login/ui/staff-home.tsx` (`StaffHome`).
  - Global identity `user` table: `packages/db/schema/identity-auth.ts` (has no `nav_style` column yet); existing table-level grant for `pospay_auth` is in `packages/db/migrations/0008_2026-09-23_identity-auth-grants.sql`.
  - Identity self endpoints: `apps/api/src/modules/identity/http/me.controller.ts` (`MeController` currently exposes only `GET me/workspaces` and `GET me/memberships`); write registry is `apps/api/src/modules/identity/http/authenticated-writes.ts` (`AUTHENTICATED_WRITES`).
- **Planned surfaces (NOT yet present in code; update this section with exact i18n keys and selectors when steps 2, 7, and 12 land):**
  - Step `0c` (separate spec and tier card): read-only business type and country code on `WorkspaceBusiness` in `GET /v1/me/workspaces`.
  - Step 7 (UI release): planned routes `/appearance`, `/approvals`, `/overview/[group]`, `/soon/[page]`; planned cookie `pospay_nav_style` (`A` | `B` | `C`, default `C`); planned `ThemeSwitch` relocation out of the admin sidebar footer into `/appearance` and the account menu across all three styles; working labels in `spec.md` and `app-map.md` become `packages/i18n` keys in step 2.
  - Step 12 (Heavy account sync): planned nullable column `user.nav_style` (`'A' | 'B' | 'C'` check), planned Zod contract `packages/contracts/src/identity/me-preferences.ts`, planned `GET /v1/me/preferences` and `PUT /v1/me/preferences` on `MeController` (`@Authenticated()`, `principal.userId` required, `PUT` declared as `PERSONAL` in `AUTHENTICATED_WRITES`), integration scenarios `PREF-01` to `PREF-09`, and no `AuditLog` entry (`NAV-Q16`).
- **Sources:**
  - [PP-214 (item 131) in `docs/owner-decisions.ar.md`](../owner-decisions.ar.md)
  - [ADR-0003 addendum](../adr/0003-auth-rls-boundary.md) · [ADR-0059 addendum](../adr/0059-souk-tiles-design-system.md) · [`CLAUDE.md` §8](../../CLAUDE.md#8-security)
  - [Spec 074](../specs/074-admin-navigation-layout-restructure/spec.md) · [PR sequence](../specs/074-admin-navigation-layout-restructure/pr-sequence.md) · [Quickstart](../specs/074-admin-navigation-layout-restructure/quickstart.md)
  - Current live theme journey: [95](95-design-system-theme.md)
