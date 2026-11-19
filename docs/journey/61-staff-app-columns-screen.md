# 61 · Staff app columns screen — شاشة أعمدة تطبيق الموظفين

**Status / الحالة:** shipped in #553 (57c-2: the admin screen on `/staff-app-columns`), merged. It is the screen for
the two routes of [59](59-staff-app-settings.md), so that journey's rules (default columns, months back 1–12, the
audit row per changed value) still hold. **Runs on staging** (`https://app.staging.pospay.systems/staff-app-columns`).
What reads the setting today: **months back**, by the employee's own attendance read ([83](83-own-attendance.md))
and her own tips read ([85](85-own-monthly-tips.md)); and the **Tip** column, which decides whether the own-tips read
answers with amounts or `HIDDEN`. No staff-app screen shows the chosen **columns** yet.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the admin, then `pnpm db:migrate` and `pnpm db:seed`; or the
  staging admin with the demo company «صالون الأميرة (تجريبي)».
- Sign in to the admin ([01](01-admin-sign-in-and-totp.md)) and choose a business ([02](02-admin-workspace-selector.md)).
- Synthetic users: the **Owner** (holds **أعمدة تطبيق الموظفين** / **Manage staff app columns** by default); a user
  with only **عرض إعدادات النشاط** / **Read business settings**; a user with neither.

## العربي

1. **افتح الشاشة:** من القائمة الجانبية دوس **أعمدة تطبيق الموظفين** ← عنوان **أعمدة تطبيق الموظفين** وتحته
   «اختار أعمدة تطبيق الموظفين لهذا النشاط، وكام شهر لورا بيشوفه.»
2. **الافتراضي:** على نشاط ما اتحفظلوش حاجة ← جنب **الأعمدة** وجنب **عدد الشهور لورا** علامة **الافتراضي**،
   والأعمدة المتعلّم عليها: **التاريخ**، **الوقت**، **الخدمة**، **اسم العميلة**، **نصيبها**، **العمولة المتوقعة**،
   **البقشيش**. و**السعر قبل الخصم** و**الخصم** و**الصافي** مش متعلّم عليهم. عدد الشهور **2**.
3. **كل عمود معاه مثال:** جنب كل اسم عمود مثال، زي **الصافي** ← `11.500 د.ك`.
4. **غيّر واحفظ:** شيل العلامة من **العمولة المتوقعة**، واكتب **3** في **عدد الشهور لورا**، ودوس **حفظ** ←
   **جارٍ الحفظ…** وبعدها **تم الحفظ.** وعلامة **الافتراضي** تختفي من الاتنين.
5. **رقم برّه المدى:** اكتب **0** أو **13** في عدد الشهور ودوس **حفظ** ← **عدد الشهور لازم يكون رقم صحيح من 1 لـ
   12.** ومفيش حاجة بتتحفظ.
6. **مفيش عمود تقييم:** عمود متوسط التقييم (`rating_average`) مش معروض في القائمة (التقييم متأجل).
7. **قراءة بس:** مستخدم معاه **عرض إعدادات النشاط** بس بيشوف الشاشة والمدخل في القائمة، ولو داس **حفظ** السيرفر
   بيرفض برسالة خطأ. مستخدم من غير الصلاحيتين: المدخل مش ظاهر في القائمة أصلًا.
8. **غيّرت النشاط:** لو غيّرت النشاط من فوق، الشاشة بتتحمّل من جديد بإعداد النشاط التاني.

**ممنوع يحصل:**
- عمود `rating_average` أو رقم العميلة يتعرض أو يتحفظ.
- الحفظ ينجح لمستخدم من غير **أعمدة تطبيق الموظفين**.
- إعداد نشاط يظهر على نشاط تاني بعد تغيير النشاط.
- **تم الحفظ.** تفضل ظاهرة بعد ما تغيّر حاجة في النموذج.

## English

1. **Open the screen:** in the sidebar click **Staff app columns** → the heading **Staff app columns** with "Choose
   the columns the staff app shows for this business, and how many months back it looks."
2. **Defaults:** on a business with nothing saved → a **Default in effect** badge next to **Columns** and next to
   **Months back**; ticked: **Date**, **Time**, **Service**, **Customer name**, **Her share**, **Estimated
   commission**, **Tip**. **Price before discount**, **Discount** and **Net** are not ticked. Months back is **2**.
3. **Every column has an example:** next to each column name, e.g. **Net** → `11.500 KWD`.
4. **Change and save:** untick **Estimated commission**, type **3** in **Months back**, click **Save** → **Saving…**
   then **Saved.**, and both **Default in effect** badges disappear.
5. **Out of range:** type **0** or **13** in months back and click **Save** → **Months back must be a whole number
   from 1 to 12.** and nothing is saved.
6. **No rating column:** the average-rating column (`rating_average`) is not offered (the rating track is postponed).
7. **Read only:** a user with only **Read business settings** sees the screen and the sidebar entry; clicking
   **Save** is refused by the server with an error message. A user with neither permission does not see the sidebar
   entry at all.
8. **Switching business:** changing the business at the top reloads the screen with the other business's setting.

**Must NOT happen:**
- `rating_average` or the customer's phone offered or saved.
- A save succeeding for a user without **Manage staff app columns**.
- One business's setting shown on another after switching.
- **Saved.** still showing after the form is edited again.

## For an agent

- **Screen:** `/staff-app-columns` (local `http://localhost:3001`, staging `https://app.staging.pospay.systems`).
  Route file `apps/admin/app/(dashboard)/staff-app-columns/page.tsx`; page
  `apps/admin/src/settings/staff-app-columns/pages/staff-app-columns-page.tsx`. With no business chosen the route
  shows the `admin.chooseBusiness` text instead.
- **Selectors:** sidebar link **أعمدة تطبيق الموظفين** / **Staff app columns** (shown only when the read succeeds for
  the current business); checkboxes by their label (`staffAppColumns.label_<code>`); number input `#staff-months-back`
  (`min=1`, `max=12`); button **حفظ** / **Save**; `role="status"` for **جارٍ الحفظ…** and **تم الحفظ.**;
  `role="alert"` for errors. Keys in `packages/i18n/src/staff-app-columns-catalog.ts` and `staff-columns-errors.ts`.
- **API:** `GET` and `PUT /v1/businesses/<BUSINESS_ID>/settings/staff-columns` with `x-company-id`; the screen sends
  an `Idempotency-Key` on the `PUT`.
- **Permissions:** read `read:settings:business` **or** `manage:staff-app-columns:business`; write
  `manage:staff-app-columns:business` (`apps/api/src/modules/settings/http/staff-columns.controller.ts`).
- **Errors:** `STAFF_COLUMNS_INVALID` 422 «الأعمدة دي مش مسموحة.» / "These columns are not allowed." ·
  `STAFF_MONTHS_BACK_INVALID` 422.
- **Assertions:** offered codes = the contract's `staffColumnCode` minus `rating_average`
  (`apps/admin/src/settings/staff-app-columns/model/offered-staff-columns.ts`); the form is disabled while saving.
- **Sources:** `docs/specs/060-ratings-and-staff-app/spec.md` (row 57c-2), journey [59](59-staff-app-settings.md).
