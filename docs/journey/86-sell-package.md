# 86 · Sell a package at reception — بيع باقة من الريسبشن

**Status / الحالة:** shipped in #756 (42-1: sale contracts, the catalog read and the sell permission), #778 (42-2:
package storage), #815 and #834 (42-3a: price, discount and the pure sale rules), #929 (42-3b1a: the pending-request
table), #1025 (42-3b1b: the worker that completes the sale, with its recovery sweep), #1051 and #1052 (42-3b2a/b:
accepting a sale over HTTP and reading its status) and #1073 (the sale screen with its package picker), all merged
(spec 058 row 42). **Runs on staging** on `/orders/package-sales/new`; needs the `orders`, `catalog` and `customers`
features and the worker. A sale is accepted first and completed by the worker a moment later, so the screen shows
**قيد التنفيذ** / **Processing** and then the result. **No payment is captured:** the method is only recorded. The
package types themselves are [37](37-package-types.md); using a sold session is [87](87-redeem-package-session.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and admin; or the staging admin with the demo company
  «صالون الأميرة (تجريبي)».
- A package type on sale ([37](37-package-types.md), [91](91-stop-resume-selling-package.md)).
- هبة (Heba), a receptionist with **بيع الباقات** / **Sell packages** on Salmiya and a discount limit
  ([15](15-discount-limit.md)); منى (Mona), an employee active at Salmiya today, as the seller.
- A customer with a synthetic phone number ([10](10-customer-find-or-create.md)).

## العربي

1. **افتح الشاشة:** من القائمة الجانبية دوس **بيع باقة** ← شاشة **بيع باقة**.
2. **العميلة:** دوّر على العميلة برقمها أو ضيفها ([10](10-customer-find-or-create.md)).
3. **نوع الباقة:** في **نوع الباقة** كل باقة معروضة بسعرها (**السعر (د.ك)**)، و«الصلاحية: … يوم»، وعدد جلسات كل
   خدمة. لو مفيش ← **مفيش باقات متاحة للبيع.** الباقات اللي بيعها متوقف مش بتظهر.
4. **المبلغ والطريقة:** اكتب **المبلغ المدفوع (د.ك)** (ممكن أقل من سعر الباقة = خصم)، واختار **طريقة الدفع**:
   **كاش** أو **بطاقة**.
5. **البائعة:** في **الموظفة البائعة** اختار منى (**اختاري الموظفة البائعة**). البائعة لازم تكون شغالة في الفرع في
   تاريخ البيع.
6. **عضوية التسجيل:** لو هبة عندها أكتر من عضوية تسمح بالبيع ← لازم تختار **عضوية تسجيل البيع**.
7. **بيعي:** دوس **بيع الباقة** ← **جاري بيع الباقة…** وبعدها **قيد التنفيذ**، وبعدها **اتباعت الباقة** ومعاها
   **التفاصيل**: **الخصم (د.ك)** و**تنتهي في** (تاريخ البيع + أيام الصلاحية).
8. **لسه بيتنفّذ:** لو التنفيذ طوّل ← **ما زال قيد التنفيذ** وزرار **تحقق مرة أخرى**.
9. **خصم فوق الحد:** المبلغ المدفوع أقل من السعر بنسبة أعلى من حد هبة ← **الخصم أكبر من حدك.** ومفيش بيع.
10. **البائعة هي نفسها:** هبة تختار الموظفة المربوطة بحسابها ← **مينفعش تسجّلي نفسك بائعة.**
11. **البائعة مش في الفرع:** ← **البائعة مش شغالة أو مش تبع الفرع في التاريخ ده.**
12. **الأسعار اتغيّرت:** لو أسعار خدمات الباقة اتغيّرت وهي فاتحة الشاشة ← **راجعي الباقة والأسعار المحدّثة وأكديهم**،
    والبيع ما يتمش غير بعد ما تأكّد.
13. **الباقة اتوقف بيعها:** وهي بتبيع ← **الباقة دي متوقف بيعها.**
14. **النت قطع بعد الضغط:** ← **البيع السابق ممكن يكون اتقبل. التعديل مقفول؛ أعيدي محاولة البيع الأصلي فقط.** وزرار
    **إعادة محاولة البيع الأصلي**. إعادة المحاولة بتبعت نفس الطلب بنفس المفتاح، فمفيش بيع مرتين. لو المهلة خلصت ←
    **انتهت مهلة إعادة المحاولة. تحققي من نتيجة البيع الأصلي مع المدير قبل بدء بيع جديد.**
    التفاصيل كلها (المهلة، مراجعة المدير، تجاهل المحاولة، تحذير الجهاز) في [96](96-package-sale-recovery.md).
15. **ناقص حاجة:** ← **اختاري الزبونة والباقة والبائعة وعضوية التسجيل، واكتبي سعر صحيح.**

**ممنوع يحصل:**
- باقة تتباع مرتين بسبب ضغطتين أو إعادة محاولة.
- بيع من غير بائعة، أو والبائعة هي اللي بتسجّل.
- خصم أعلى من حد اللي بتسجّل.
- المبلغ المدفوع ما يتوزّعش بالكامل على جلسات الباقة (مجموع قيم الجلسات = المبلغ بالفلس).
- تعديل نوع الباقة بعد البيع يغيّر جلسات أو قيم أو تاريخ انتهاء باقة اتباعت.
- بيع يتسجّل في فرع أو شركة تانية.

## English

1. **Open the screen:** in the sidebar click **Package sale** → the **Sell a package** screen.
2. **The customer:** find the customer by phone or add her ([10](10-customer-find-or-create.md)).
3. **The package type:** under **Package type** each package on sale shows its **Price (KWD)**, "Validity: … days"
   and the sessions of each service. With none → **No packages are available for sale.** Types whose selling is
   stopped are not listed.
4. **Amount and method:** type the **Price paid (KWD)** (it may be below the type's price, which is a discount) and
   pick the **Payment method**: **Cash** or **Card**.
5. **The seller:** under **Seller employee** pick Mona (**Choose the seller**). The seller must be active at the
   branch on the sale date.
6. **Recorder membership:** if Heba holds more than one membership that may sell → she must pick the **Recorder
   membership**.
7. **Sell:** click **Sell package** → **Selling package…**, then **Processing**, then **Package sold** with
   **Details**: **Discount (KWD)** and **Expires on** (the sale date plus the validity days).
8. **Still running:** if it takes long → **Still processing** with **Check again**.
9. **A discount above the limit:** the price paid is below the price by more than Heba's limit → **The discount is
   above your limit.** and no sale.
10. **The seller is herself:** Heba picks the employee linked to her own account → **You cannot name yourself as the
    seller.**
11. **The seller is not at the branch:** → **The seller is not active at this branch on that date.**
12. **Prices changed:** if the package's service prices changed while the screen was open → **Confirm the refreshed
    package and prices**, and the sale goes through only after she confirms.
13. **Selling was stopped:** while she is selling → **This package is not on sale.**
14. **The network dropped after the click:** → **The previous sale may have been accepted. Edits are locked; retry
    only the original sale.** with **Retry original sale**. The retry sends the same request with the same key, so
    nothing is sold twice. When the window is over → **The retry window has expired. Verify the original sale with
    your manager before starting another sale.**
    The full flow (the window, the manager check, discarding the attempt, the device warning) is in
    [96](96-package-sale-recovery.md).
15. **Something is missing:** → **Choose a customer, package, seller and recorder, and enter a valid price.**

**Must NOT happen:**
- A package sold twice because of a double click or a retry.
- A sale with no seller, or with the recorder as the seller.
- A discount above the recorder's limit.
- The price paid not fully split over the package's sessions (the session values sum to the amount, to the mill).
- A later edit of the package type changing the sessions, values or expiry of a package already sold.
- A sale recorded in another branch or company.

## For an agent

- **Screen:** `/orders/package-sales/new` (local `http://localhost:3001`, staging
  `https://app.staging.pospay.systems`); page `apps/admin/src/orders/pages/package-sale-page.tsx`; sidebar link
  **بيع باقة** / **Package sale**. Text in `packages/i18n/src/package-sale-catalog.ts`.
- **API** (prefix `/v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>`, all `sell:packages:branch` + the `orders`
  feature): `GET /sellable-package-types` (the picker) · `GET /package-sales/context` ·
  `GET /package-sales/seller-options` · `POST /package-sales` (202, with `Idempotency-Key`) ·
  `GET /package-sales/<SALE_REQUEST_ID>` (status: pending, completed or failed).
- **Worker:** `apps/worker/src/modules/orders/use-cases/execute-package-sale` and `recover-package-sales`.
- **Errors** (`packages/i18n/src/catalog-package-types.ts`): `PACKAGE_SALE_QUOTE_STALE` ·
  `PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT` · `PACKAGE_SELLER_NOT_ELIGIBLE` · `PACKAGE_SELLER_SELF_FORBIDDEN` ·
  `PACKAGE_TYPE_NOT_SELLABLE` · `PACKAGE_SALE_BRANCH_INACTIVE` · `PACKAGE_SALE_FAILED` ·
  `PACKAGE_SALE_REQUEST_NOT_FOUND` · `PACKAGE_SALE_TOO_OLD` · `PACKAGE_SALE_IN_FUTURE` ·
  `PACKAGE_CUSTOMER_NOT_FOUND`.
- **Assertions:** `paid_method` is `CASH` or `CARD` and no payment row is created (spec 058 FR-015); a sale adds no
  visit line (FR-019); a `package_sale_requests` row moves `pending → completed / failed` only.
- **Sources:** `docs/specs/058-packages-sell-redeem/spec.md` (FR-010 … FR-019b, FR-072, rows 42-1 … 42-4),
  `docs/specs/058-packages-sell-redeem/plan-42-3b1.md`, `plan-42-3b2.md`, `plan-42-picker.md`, journey
  [07](07-package-allocation.md) for how the price is split.
