# 102 · Choose the navigation style — اختيار نمط التنقّل

**Status / الحالة:** shipped by the PR of step `074-7b` (spec 074, `docs/specs/074-admin-navigation-layout-restructure/074-7-style-switch/release-spec.md`). Runs on `apps/admin` after the staging batch that includes that PR. The choice is kept **on the device, for the signed-in session only**: sign-out and every sign-in clear it, so each sign-in starts on style C. Saving it on the account is step 12 and is **not** part of this journey. The decisions behind it are in [101](101-admin-navigation-styles.md).

**الحالة بالعربي:** تُسلَّم مع طلب الدمج الخاص بالخطوة `074-7b`. تعمل على لوحة الإدارة بعد دفعة الستاجنج التي تضمّه. الاختيار يُحفظ **على الجهاز وللجلسة الحالية فقط**: الخروج وكل دخول يمسحانه، فيبدأ كل دخول على النمط C. حفظه على الحساب هو الخطوة 12 وليس جزءًا من هذه الرحلة.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) or staging, signed in ([01](01-admin-sign-in-and-totp.md)).
- Two users if you can: one owner, and one with the fewest permissions. A second company of a different business type (restaurant and salon) for step 8.
- مستخدمان إن أمكن: مالك، ومستخدم بأقل صلاحيات. وشركة ثانية بنوع نشاط مختلف (مطعم وصالون) للخطوة 8.

## العربي

1. سجّل دخولًا بمستخدم جديد على الجهاز ← تفتح لوحة الإدارة على **C — شريط أيقونات ولوحة**: شريط مساحات العمل على الجانب، ولوحة بصفحات المساحة الحالية، وزر **انتقل إلى صفحة**.
2. من قائمة الحساب (أيقونة المستخدم) اختر **المظهر** ← تفتح صفحة المظهر على العنوان `/appearance` وبها ثلاث بطاقات: **A — شريط جانبي وتبويبات** و**B — شريط علوي ومحاور** و**C — شريط أيقونات ولوحة**، والحالية عليها كلمة **الحالي**.
3. اضغط **اختيار هذا النمط** على بطاقة **A** ← يتبدّل الإطار فورًا إلى شريط جانبي وتبويبات، ويبقى العنوان `/appearance` كما هو دون إعادة تحميل.
4. من قائمة الحساب اختر **نمط التنقّل: B — شريط علوي ومحاور** ← يتبدّل الإطار إلى شريط علوي، وتظهر كلمة **الحالي** بجوار B في القائمة.
5. أعد تحميل الصفحة ← أول رسم يظهر هو B مباشرة، بلا وميض بنمط آخر.
6. مفتاح الوضع الفاتح/الداكن/حسب النظام في صفحة المظهر وقائمة الحساب (**وضع العرض**)، وليس أسفل الشريط الجانبي. تغيير النمط لا يغيّر الوضع ولا اللغة.
7. افتح **صندوق الاعتمادات** (`/approvals`) تحت «الرئيسية» ← يعرض أنواع الاعتماد التي تقدر على فتحها (الإجازات، طلبات الحضور، تنبيهات الحضور) وكل نوع رابط لصفحته. من لا يملك صلاحية أي نوع يرى أن لا قائمة متاحة.
8. افتح من القائمة مدخلًا عليه علامة **قريبًا** ← تفتح صفحة **قيد التطوير** (`/soon/…`) باسم المدخل وزر **العودة إلى الرئيسية**. في شركة مطعم افتح «شاشات المطبخ» واحفظ عنوانها، ثم بدّل إلى شركة صالون وافتح العنوان المحفوظ ← صفحة غير موجودة، والمدخل غير موجود في القوائم ولا في باحث الصفحات.
9. في B أو C افتح صفحة **نظرة عامة** لمجموعة (`/overview/…`)، ثم بدّل النمط إلى نمط لا يعرف هذه المجموعة ← يُستبدل العنوان بأول صفحة تراها من المجموعة نفسها؛ ومجموعة لا تراها ترجع بك إلى الرئيسية.
10. افتح **المصادقة** من قائمة الحساب (`/security/two-factor`) ← تظهر داخل الإطار، وعنصرها في قائمة الحساب عليه **الحالي**.
11. بمستخدم بلا أي صلاحية خاصة وبمستخدم لم تُحمَّل مساحة عمله بعد: افتح `/appearance` وبدّل النمط ← يعمل في الحالتين.
12. على 390 بكسل في النمط A: اضغط **المزيد** ثم رابط الصفحة ← تصل إلى أي صفحة خلف «المزيد» في 3 ضغطات على الأكثر.
13. اختر A ثم **سجّل الخروج** ← يُمسح الاختيار من الجهاز؛ سجّل دخول مستخدم آخر ← يبدأ على C. إن فشل الخروج بقي الاختيار.

## English

1. Sign in as a user new to this device → the dashboard opens in **C — Rail and panel**: a workspace rail at the side, a panel with the pages of the current workspace, and a **Go to a page** button.
2. In the account menu (user icon) choose **Appearance** → the Appearance page opens at `/appearance` with three cards: **A — Sidebar and tabs**, **B — Top bar and hubs**, **C — Rail and panel**; the current one says **Current**.
3. Press **Use this style** on card **A** → the frame switches at once to a sidebar with tabs, and the address stays `/appearance` with no page reload.
4. In the account menu choose **Navigation style: B — Top bar and hubs** → the frame switches to a top bar, and **Current** shows beside B in the menu.
5. Reload → the first paint is already B, with no flash of another style.
6. The light / dark / system switch is on the Appearance page and in the account menu (**Display theme**), not at the foot of the sidebar. Changing the style changes neither theme nor language.
7. Open the **Approvals inbox** (`/approvals`) under Home → it lists the approval kinds you may open (leave, attendance requests, attendance exceptions), each a link to its page. A user who may open none sees that no list is available.
8. Open an entry marked **Soon** → the **Under development** page (`/soon/…`) shows the entry's name and **Back to Home**. In a restaurant company open «Kitchen screens» and keep its address, switch to a salon company and open the saved address → not found, and the entry is gone from the menus and the page finder.
9. In B or C open a group **overview** (`/overview/…`), then switch to a style that does not have that group → the address is replaced by the first page of the same group you may see; a group you may see nothing in sends you Home.
10. Open **Authenticator** from the account menu (`/security/two-factor`) → it is drawn inside the frame, and its account-menu entry says **Current**.
11. As a user with no special permission, and as a user whose workspace has not loaded: open `/appearance` and switch the style → it works in both cases.
12. At 390px in style A: press **More** then a page link → any page behind More is reached in three presses at most.
13. Choose A, then **Sign out** → the choice is cleared from the device; sign in as another user → starts on C. If sign-out fails the choice stays.

**You must see / لازم تشوف:** the frame changes at once and the address does not; a reload draws the chosen style first; every page is inside one of the three frames.

**Must NOT happen / ممنوع يحصل:** a page reload when the style changes; the style of the previous user showing for the next user; Appearance or Authenticator blocked for a user whose workspace is missing; a built page or its menu entry shown for a business type or role it is hidden from.

**For an agent / للـ agent:** the first paint is style C (`pospay_nav_style` cookie absent or invalid). Find the account menu by its name «Account menu» / «قائمة الحساب»; style entries are menu items starting «Navigation style:» / «نمط التنقّل:». Appearance cards are buttons named «Use this style A — Sidebar and tabs» (the style name is in the accessible name). Identify the frame by role: A has a button «Collapse navigation»; B has a button starting «Today» in the top bar; C has a button «Go to a page». Assert the address with `page.url()` before and after, and that no `load` event fired.
