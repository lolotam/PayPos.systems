# 87 · Use a package session in a visit, and give it back — استخدام جلسة من الباقة في زيارة وإرجاعها

**Status / الحالة:** shipped in #818 (42-4b-a: the stored package detail read), #820 (43-1a: locking the package's
components), #838 (43-1: redemption storage and contracts), #839 (43-1b: the old writers refuse a redeemed line),
#841 (43-2: redeeming a session under a row lock when the visit is saved), #846 (row 44: cancelling a redeemed line
gives the session back, once), #931 (42-4r: the customer's package list and detail routes) and #956 (43-3: the **من
الباقة** / **From package** toggle and the redemption history on the recording screen), all merged (spec 058 rows 43
and 44). **Runs on staging** on the recording screen `/orders/service-sessions/new`
([47](47-record-visit-reception.md)); needs the `orders` feature. **Not built:** a separate «the customer's packages»
screen; today a customer's packages are seen only inside this toggle.

**Before you start / قبل ما تبدأ:**
- Everything of [47](47-record-visit-reception.md), with the worker running.
- A customer who bought a package ([86](86-sell-package.md)) with at least 2 free sessions of the service «قص شعر».
- هبة (Heba), a receptionist who records visits on Salmiya.

## العربي

1. **من الباقة:** هبة تسجّل زيارة للعميلة وتختار خدمة «قص شعر»، وتفعّل **من الباقة** على السطر.
2. **لازم عميلة وخدمة:** من غير عميلة ← **اختاري الزبونة الأول.** ومن غير خدمة ← **اختاري الخدمة الأول.**
3. **اختيار الباقة:** في **الباقة** بتظهر باقات العميلة اللي فيها الخدمة دي، وكل واحدة مكتوب عليها «تنتهي في …»
   و«متبقي … جلسة». الأقرب انتهاءً عليها **مقترحة: أقرب انتهاء**. هبة هي اللي بتختار؛ السيستم ما بيختارش لوحده.
4. **مفيش باقة تنفع:** ← **مفيش باقة صالحة لهذه الزبونة للخدمة دي.**
5. **احفظ:** تحفظ الزيارة ← السطر بيتحفظ بسعر قيمة الجلسة في الباقة ومن غير خصم، وجلسة واحدة بتتخصم من الباقة
   (أقل رقم جلسة فاضية للخدمة دي).
6. **سجل الاستخدام:** تحت الباقة المختارة **سجل الاستخدام**: «زيارة …» و«الجلسة …» لكل جلسة اتستخدمت. لو لسه مفيش ←
   **لا توجد جلسات مستخدمة بعد.**
7. **الجلسات خلصت:** باقة مفيهاش جلسات فاضية للخدمة ← **لا توجد جلسات متبقية في هذه الباقة لهذه الزيارة.**، والسيرفر
   بيرفض بـ **مفيش جلسات فاضية في الباقة دي.**
8. **باقة منتهية:** الباقة بتتقبل لو تاريخ الزيارة يوم الانتهاء أو قبله؛ في القائمة مكتوب **منتهية: صالحة فقط لو
   تاريخ الزيارة قبل الانتهاء**. زيارة بعد الانتهاء ← **الباقة خلصت صلاحيتها.**
9. **اتنين في نفس اللحظة:** موظفتين بيسجّلوا آخر جلسة في نفس الوقت ← واحدة بس تنجح، والتانية تترفض.
10. **السعر ثابت:** تعديل سعر أو خصم سطر من الباقة ([49](49-price-discount-edit.md)) ← **سعر جلسة الباقة ثابت.**
11. **إلغاء السطر:** الغي سطر الباقة ([51](51-cancel-service-line.md)) ← الجلسة بترجع فاضية في الباقة، وفي **سجل
    الاستخدام** السطر عليه **ملغاة**. الإلغاء مرة تانية ما بيرجّعش جلسة تانية.
12. **تغيير المنفّذين:** تغيير اللي عملوا سطر الباقة ([52](52-change-line-performers.md)) شغال عادي وما بيلمسش الباقة.

**ممنوع يحصل:**
- جلسة واحدة تتستخدم في زيارتين.
- إلغاء سطر يرجّع جلستين، أو يرجّع جلسة لباقة تانية.
- باقة عميلة تتستخدم لعميلة تانية، أو في نشاط تاني، أو لخدمة مش فيها.
- السيستم يختار الباقة لوحده من غير ما الموظفة تحددها.
- سطر الباقة ياخد خصم أو سعر غير قيمة الجلسة.
- جلسة مستردة ([89](89-refund-package-sessions.md)) تتستخدم تاني.

## English

1. **From package:** Heba records a visit for the customer, picks the service «قص شعر» and turns on **From package**
   on the line.
2. **A customer and a service first:** with no customer → **Choose a customer first.**; with no service → **Choose a
   service first.**
3. **Picking the package:** under **Package** the customer's packages that contain this service are listed, each
   with "Expires …" and "… sessions left". The one expiring first is marked **Suggested: expires first**. Heba
   chooses; the system never picks one by itself.
4. **No usable package:** → **This customer has no usable package for this service.**
5. **Save:** she saves the visit → the line is saved at the session's value in the package, with no discount, and
   one session is taken from the package (the lowest free session number of that service).
6. **Redemption history:** under the chosen package, **Redemption history** lists "Visit …" and "Session …" for every
   session used. With none yet → **No sessions used yet.**
7. **No sessions left:** a package with no free session of the service → **No sessions left in this package for
   this visit.**, and the server refuses with **This package has no free sessions left.**
8. **An expired package:** a package is accepted when the visit date is on or before its expiry; the list says
   **Expired: valid only if the visit date is on or before expiry**. A visit after the expiry → **The package has
   expired.**
9. **Two at the same moment:** two receptionists record the last session at once → only one succeeds, the other is
   refused.
10. **The price is fixed:** editing the price or discount of a package line ([49](49-price-discount-edit.md)) → **A
    package session's price cannot be edited.**
11. **Cancelling the line:** cancel the package line ([51](51-cancel-service-line.md)) → the session is free again in
    the package, and the row in **Redemption history** shows **Reversed**. Cancelling again gives back no second
    session.
12. **Changing performers:** changing who performed a package line ([52](52-change-line-performers.md)) works as
    usual and touches no package row.

**Must NOT happen:**
- One session used in two visits.
- A cancellation giving back two sessions, or giving one back to another package.
- A customer's package used for another customer, in another business, or for a service it does not contain.
- The system choosing the package without the receptionist naming it.
- A package line taking a discount, or a price other than the session's value.
- A refunded session ([89](89-refund-package-sessions.md)) used again.

## For an agent

- **Screen:** `/orders/service-sessions/new`; components `apps/admin/src/orders/ui/session-package-toggle.tsx`,
  `session-package-picker.tsx`, `package-redemption-history.tsx`. Text in
  `packages/i18n/src/service-session-catalog.ts` (`fromPackage`, `packagePicker`, `packageSuggested`,
  `packageExpiresOn`, `packageRemaining`, `packageNoneUsable`, `packageExhausted`, `packageHistory`,
  `packageHistoryReversed`).
- **Reads** (`apps/api/src/modules/orders/http/customer-packages.controller.ts`, the `orders` feature,
  `record:service-sessions:branch` **or** `read:service-sessions:branch`):
  `GET /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/customers/<CUSTOMER_ID>/packages` ·
  `GET …/packages/<ENTITLEMENT_ID>`.
- **Write:** the record and append bodies of [47](47-record-visit-reception.md) accept a line draft
  `{ service_id, package: { entitlement_id }, … }` (spec 058 FR-020, FR-021).
- **Errors** (`packages/i18n/src/service-session-errors.ts`): `PACKAGE_NO_FREE_SESSION` · `PACKAGE_EXPIRED` ·
  `PACKAGE_NOT_YET_VALID` · `PACKAGE_NOT_USABLE_HERE` · `PACKAGE_REDEMPTION_ALREADY_REVERSED` ·
  `SESSION_LINE_PRICE_NOT_EDITABLE` 422.
- **Assertions:** the line has `list_price = price = net` = the slot's unit value and discount 0 (FR-025); one
  `package_redemptions` row per redeemed line; a cancel reverses it exactly once (FR-031).
- **Sources:** `docs/specs/058-packages-sell-redeem/spec.md` (FR-020 … FR-035, FR-070, FR-071, rows 43-1 … 44),
  `docs/specs/058-packages-sell-redeem/plan-43-2.md`, `plan-43-3.md`, `plan-42-4r.md`.
