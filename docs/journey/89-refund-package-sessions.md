# 89 · Refund unused package sessions — استرداد جلسات الباقة اللي ما اتستخدمتش

**Status / الحالة:** shipped in #819 (the pure refund plan from the stored session values) and #999 (row 46: the
refund storage, use case and route), merged (spec 058 row 46). **API only, no screen:** the refund dialog, the refund
history in the package detail and the managers' bell (row 46-3) are not built. The route is on staging and needs the
`orders` feature. **No money moves in the system:** the refund records how the money went back (cash or card); no
payment gateway is called. **Imported packages cannot be refunded yet:** that needs a per-business switch which is
off by default, and no route turns it on yet (row 46-2a).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API; the `orders` feature on.
- A customer's sold package ([86](86-sell-package.md)) that has not expired, with a service of 5 sessions, 2 of them
  used ([87](87-redeem-package-session.md)).
- سارة (Sara), a manager with **استرداد جلسات الباقة** / **Refund package sessions** on Salmiya, signed in to the
  admin with her own account; هبة (Heba), a receptionist without it.

## العربي

API بس، لسه مفيش شاشة.

1. **استرداد:** سارة تبعت طلب استرداد جلستين من خدمة «قص شعر» في الباقة، بطريقة **كاش**، وسبب مكتوب ← الجلستين
   بيتحوّلوا «مستردة» (من أعلى أرقام الجلسات الفاضية)، والمبلغ = مجموع قيم الجلستين زي ما اتحسبوا وقت البيع
   ([07](07-package-allocation.md)).
2. **كله أو لا شيء:** تطلب 4 جلسات والفاضي 3 بس ← **الجلسات الفاضية أقل من المطلوب، ومحدش اترجّع.**
3. **مكوّن غلط:** خدمة مش من الباقة دي ← **المكوّن ده مش من الباقة دي.**
4. **من غير سبب:** سبب فاضي أو أطول من 500 حرف ← **اكتب سبب الاسترداد (لحد 500 حرف).**
5. **باقة منتهية:** باقة عدّى تاريخ انتهائها ← **الباقة خلصت صلاحيتها.**
6. **باقة مستوردة:** باقة جاية من الاستيراد ([90](90-import-packages.md)) ← **استرداد الباقات المستوردة مقفول في
   النشاط ده.**
7. **ما تتستخدمش تاني:** جلسة مستردة ما بتظهرش كجلسة فاضية في **من الباقة** ([87](87-redeem-package-session.md)).
8. **نفس الطلب مرتين:** نفس `Idempotency-Key` ← نفس النتيجة، من غير استرداد تاني.
9. **من غير صلاحية:** هبة تحاول ← 403. وجهاز الكاشير المربوط ما ينفعش يعمل استرداد (لازم دخول شخصي على لوحة
   الإدارة).

**ممنوع يحصل:**
- استرداد جزء من المطلوب (إما العدد كله أو مفيش).
- جلسة مستخدمة تترد.
- جلسة مستردة تتستخدم أو تترد تاني.
- المبلغ يتحسب بغير قيم الجلسات المخزّنة، أو بكسور عشرية (`number`).
- سبب الاسترداد يظهر في سجل التدقيق أو في اللوج (في سجل الاسترداد بس).
- استرداد من ضغطتين يتسجّل مرتين.

## English

API only, no screen yet.

1. **A refund:** Sara posts a refund of 2 sessions of «قص شعر» in the package, method **cash**, with a written
   reason → the two sessions become refunded (taken from the highest free session numbers), and the amount is the
   sum of those sessions' values as computed at sale time ([07](07-package-allocation.md)).
2. **All or nothing:** she asks for 4 sessions and only 3 are free → **Fewer free sessions than requested; nothing
   was refunded.**
3. **A wrong component:** a service that is not part of this package → **This component is not part of the
   package.**
4. **No reason:** an empty reason, or one over 500 characters → **Enter the reason for the refund (up to 500
   characters).**
5. **An expired package:** a package past its expiry date → **The package has expired.**
6. **An imported package:** a package that came from the import ([90](90-import-packages.md)) → **Refunds of
   imported packages are switched off for this business.**
7. **Never used again:** a refunded session does not show as free under **From package**
   ([87](87-redeem-package-session.md)).
8. **The same request twice:** the same `Idempotency-Key` → the same result, no second refund.
9. **No permission:** Heba tries → 403. A paired cashier device cannot refund (an individual admin login is
   required).

**Must NOT happen:**
- A partial refund (the whole count or nothing).
- A used session refunded.
- A refunded session used or refunded again.
- The amount computed from anything but the stored session values, or with floating point (`number`).
- The refund reason in the audit log or a technical log (it lives in the refund history only).
- A double click recorded as two refunds.

## For an agent

- **Screens:** none (row 46-3).
- **API:** `POST /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/packages/<ENTITLEMENT_ID>/refunds`
  (`apps/api/src/modules/orders/http/package-refund.controller.ts`), `refund:packages:branch` + the `orders` feature,
  with an `Idempotency-Key`; body `{ component_id, sessions, method, reason }`, `method` is `CASH` or `CARD`.
- **Errors** (`packages/i18n/src/catalog-package-types.ts`): `PACKAGE_COMPONENT_NOT_FOUND` · `INSUFFICIENT_SLOTS` ·
  `IMPORTED_REFUND_DISABLED` · `PACKAGE_EXPIRED` · `PACKAGE_REFUND_REASON_INVALID` · `PACKAGE_NOT_FOUND` ·
  `FORBIDDEN` 403.
- **Assertions:** slots move `FREE → REFUNDED` only; one `package_refunds` row and one `package_refund_slots` row
  per session; `refunded_amount` on the entitlement grows by the amount; for a sold package a `PackageSaleChanged`
  event is written in the same transaction (spec 058 FR-052). Its commission projection (spec 059 row 50-4) applies
  the refund event by revision once the slice ships, and the six-type replay brings in sales recorded before it.
- **Code:** `apps/api/src/modules/orders/use-cases/refund-package/refund-package.usecase.ts`,
  `apps/api/src/modules/orders/domain/package-refund-plan.ts`; the imported-refund switch is read by
  `apps/api/src/modules/settings/persistence/read-imported-refunds-enabled.ts`.
- **Sources:** `docs/specs/058-packages-sell-redeem/spec.md` (FR-050 … FR-057, rows 46-1 … 46-3),
  `docs/specs/058-packages-sell-redeem/plan-46.md`.
