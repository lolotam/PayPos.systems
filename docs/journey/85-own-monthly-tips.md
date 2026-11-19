# 85 · An employee reads her own tips for the month — الموظفة تقرا بقشيشها في الشهر

**Status / الحالة:** shipped in #896 (57-2a: the own monthly tips API), merged (spec 060 part A, the first read of
«شغلي»). **API only, no screen:** the «شغلي» screen of the staff app is not built, and neither are its other reads
(her service lines and estimated commission). The route is on staging. As with [83](83-own-attendance.md), it
answers the personal session (OTP **OFF**) or the reception device's staff session with a live private view
([82](82-private-view-window.md)).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API; the `orders` feature on.
- هبة (Heba), an employee linked to a user, with tips recorded on her visits this month
  ([50](50-visit-tips.md)), some cash and some card.
- The staff-app columns of the business at their default, which includes **البقشيش** / **Tip**
  ([61](61-staff-app-columns-screen.md)).

## العربي

API بس، لسه مفيش شاشة.

1. **الشهر الحالي:** هبة تطلب بقشيشها من غير تحديد شهر ← `status: VISIBLE` ومعاه مجموعين للشهر: `total_cash`
   و`total_card`، بالدينار بتلات خانات.
2. **آخر نسخة بس:** بقشيش زيارة اتعدّل أكتر من مرة ← بيتحسب آخر تعديل بس، مش كل التعديلات.
3. **شهر فات:** `month=YYYY-MM` للشهر اللي فات ← مجموعه.
4. **أبعد من المسموح:** شهر أقدم من «عدد الشهور لورا»، أو شهر في المستقبل ← **الشهر ده برّه الفترة اللي تقدري
   تشوفيها.**
5. **العمود مقفول:** المدير شال علامة **البقشيش** من أعمدة تطبيق الموظفين
   ([61](61-staff-app-columns-screen.md)) ← الرد `status: HIDDEN` وفيه الشهر بس، من غير أي مبلغ.
6. **على جهاز الريسبشن:** بجلسة الجهاز من غير نافذة عرض خاص شغالة ← **وقت العرض خلص. دخّلي الـ PIN تاني.**
7. **من غير بقشيش:** شهر مفيهوش بقشيش ← `VISIBLE` والمجموعين صفر.

**ممنوع يحصل:**
- موظفة تشوف بقشيش موظفة تانية، أو الطلب يقبل رقم موظفة من العميل.
- مبلغ يظهر والعمود مقفول.
- بقشيش زيارة يتحسب مرتين بسبب تعديله.
- المبلغ يتحسب أو يتقرّب بكسور عشرية (`number`) بدل الفلس.
- الرد يتخزّن في الكاش.

## English

API only, no screen yet.

1. **The current month:** Heba asks for her tips with no month → `status: VISIBLE` with the month's two totals,
   `total_cash` and `total_card`, in KWD with three decimals.
2. **The latest revision only:** a visit's tips edited more than once → only the last edit counts, not every edit.
3. **A past month:** `month=YYYY-MM` for last month → its totals.
4. **Further than allowed:** a month older than «months back», or a future month → **This month is outside the
   period you can view.**
5. **The column is off:** the manager unticked **Tip** in the staff app columns
   ([61](61-staff-app-columns-screen.md)) → the answer is `status: HIDDEN` with the month only and no amount.
6. **On the reception device:** with the device's staff session and no live private view → **The private view has
   expired. Enter your PIN again.**
7. **No tips:** a month with no tips → `VISIBLE` with both totals zero.

**Must NOT happen:**
- One employee seeing another's tips, or the request accepting an employee id from the client.
- An amount shown while the column is off.
- A visit's tips counted twice because they were edited.
- The amount computed or rounded with floating point (`number`) instead of mills.
- The answer cached.

## For an agent

- **Screens:** none.
- **API:** `GET /v1/staff/me/tips?month=<YYYY-MM>` (`apps/api/src/modules/orders/http/own-work.controller.ts`,
  `@Authenticated()`, `Cache-Control: no-store`). On the reception device add the `x-private-view-window-id` header.
- **Answer** (`packages/contracts/src/orders/own-tips.ts`): `{ month, status: "HIDDEN" }` or
  `{ month, status: "VISIBLE", total_cash, total_card }`.
- **Order of checks:** live authority and the month window first, then `HIDDEN`; a `HIDDEN` answer runs no tip query
  (`apps/api/src/modules/orders/queries/own-tips.query.ts`, `own-work-context.ts`).
- **Errors:** `MY_PERIOD_OUT_OF_RANGE` · `PRIVATE_VIEW_EXPIRED` 403 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403.
- **Sources:** `docs/specs/060-ratings-and-staff-app/spec.md` (part A, row 57-2),
  `docs/specs/060-ratings-and-staff-app/57-2a-brief.md`, `57-2a-validation.md`.
