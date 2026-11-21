# 99 — شاشة باقات العميلة — Customer packages screen

**Status / الحالة:** shipped in this PR (42-4: the admin screen listing a customer's packages and one package's
detail; spec 058 row 42-4, Story 8 CP-01…CP-03). **Staging:** the route
`/orders/customers/{customerId}/packages` becomes available at `https://app.staging.pospay.systems` after the
staging batch that includes this merge. The list and detail reads behind it have been live since #931 (42-4r);
this PR adds the screen, its three entry links and nothing else — no API change.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the admin, or staging.
- Signed in to the admin ([01](01-admin-sign-in-and-totp.md)).
- A business with at least one sold package for one customer (sell one through «بيع باقة»), and ideally one
  expired or fully used package.
- To test the reader path ([PK-Q17](../specs/058-packages-sell-redeem/spec.md)): a second admin holding only
  `read:service-sessions:branch` at the branch.
- To test the refusal path: a second admin with neither session permission.

## العربية

1. **من قائمة اليوم:** افتح «زيارات اليوم» من القايمة الجانبية → لكل زيارة، تحت اسم العميلة يظهر رابط
   «باقات العميلة» → اضغطه في نفس التبويب.
2. **من نموذج تسجيل زيارة:** افتح «تسجيل زيارة» → اختر عميلة → في كارت «تم اختيار الزبونة» اضغط
   «باقات العميلة» → يفتح في تبويب جديد والنموذج يفضل زي ما هو.
3. **من نموذج بيع الباقة:** افتح «بيع باقة» → اختر عميلة → في كارت العميلة المختارة اضغط «باقات العميلة» →
   يفتح في تبويب جديد.
4. **القايمة:** العنوان «باقات العميلة» فقط — من غير اسم العميلة ولا رقمها. كل باقة تعرض اسمها، أصلها
   («مباعة هنا» أو «مستوردة»)، تاريخ الانتهاء، «السعر المدفوع»، «المرتجع»، ولكل خدمة «متبقي {n}» و
   «مستخدم {n}» و«مرتجع {n}» وقيم الخانات.
5. **الترتيب:** الباقات النشطة الأول، والمنتهية والمستنفدة في الآخر مع شارة «منتهية» أو «مستنفدة».
6. **التفصيل:** اضغط اسم الباقة → يفتح التفصيل في العنوان نفسه (`?package=`): مبيعة هنا تعرض «سعر
   الكتالوج» و«الخصم» و«طريقة الدفع» و«تاريخ البيع» و«مدة الصلاحية»؛ المستوردة تعرض «مستوردة» فقط
   من غير هذه الحقول.
7. **الجلسات خانة بخانة:** كل خدمة تعرض عدّاداتها ثم كل خانة برقمها وحالتها («مجانية» / «مستخدمة» /
   «مرتجعة» / «مستخدمة قبل الاستيراد») وقيمتها.
8. **السجلات:** «سجل الاستخدام» يعرض كل جلسة مستخدمة بتاريخ زيارتها وعلامة «ملغاة» للجلسة المرتجعة، و
   «التمديدات» يعرض من ← إلى بالتاريخ والوقت والسبب لو موجود.
9. **زر التمديد:** زر «تمديد» يظهر فقط لو الخادم رجّع `can_extend` — اضغطه، احفظ تمديدًا → التفصيل
   والقايمة يعرضان تاريخ الانتهاء الجديد بعد الحفظ.
10. **الصلاحيات:** مستخدم بلا `record:service-sessions:branch` ولا `read:service-sessions:branch` على
    الفرع يرى «لا تملك صلاحية عرض الباقات هنا.» من غير أي بيانات؛ ورابط القايمة لا يفتح له شيئًا.

**ما لا يجب أن يحدث:**
- رقم تليفون العميلة لا يظهر في الشاشة ولا في العنوان، واسم العميلة لا يدخل العنوان أبدًا.
- مستخدم بلا صلاحية لا يرى أي باقات — ولا باقة واحدة قبل رسالة الرفض، حتى لو كانت في الكاش.
- معرف باقة فاسخ في العنوان يعرض «الباقة غير موجودة.» من غير أي طلب تفصيل.
- مقطع عميلة فاسخ يعرض «لا توجد باقات لهذه العميلة.» من غير أي طلب قايمة.
- معرفات البائع والفرع ونوع الباقة لا تظهر كنصوص خام في التفصيل.
- تغيير النشاط أو الفرع أو المستخدم يقفل التفصيل والحوار المفتوح ويجيب بيانات النطاق الجديد بس.

## English

1. **From the day list:** open the day's visits from the sidebar → under each visit's customer name press
   «باقات العميلة» / "Customer's packages" → it opens in the same tab.
2. **From the record-a-visit form:** pick a customer → on the «تم اختيار الزبونة» / "Customer selected" card
   press the link → it opens in a new tab and the form stays untouched.
3. **From the sell-a-package form:** pick a customer → the selected-customer card carries the same link →
   new tab.
4. **The list:** the heading is «باقات العميلة» / "Customer's packages" only — never the customer's name or
   phone. Every package shows its name, provenance («مباعة هنا» / "Sold here" or «مستوردة» / "Imported"),
   «تاريخ الانتهاء» / "Expires", «السعر المدفوع» / "Price paid", «المرتجع» / "Refunded", and per component
   "remaining / used / refunded" counts with the slot values.
5. **Order:** active packages first; expired and fully used last with the «منتهية» / "Expired" or
   «مستنفدة» / "Fully used" badge.
6. **Detail:** press a package's name → the detail opens in the same address (`?package=`): a sold package
   shows "Catalog price", "Discount", "Payment method", "Sale date" and "Validity"; an imported one shows
   only "Imported" without those fields.
7. **Sessions one by one:** each component lists its counts, then every slot with its number, state
   ("Free" / "Used" / "Refunded" / "Used before import") and value.
8. **History:** "Redemption history" lists each used session with its visit date and a "Reversed" mark;
   "Extensions" lists from → to, when, and the reason when present.
9. **Extend:** the «تمديد» / "Extend" button appears only when the server returned `can_extend`; after a
   saved extension both detail and list show the new expiry.
10. **Permissions:** a user with neither session permission on the branch sees
    «لا تملك صلاحية عرض الباقات هنا.» / "You are not allowed to see packages here." and no package data.

## For an agent / للـ agent

- Address: `https://app.staging.pospay.systems/orders/customers/{customerId}/packages` (the customer id
  comes from a visit or a form selection; there is no search screen).
- List assertions: `role=heading` name "Customer's packages"; package names as `button` text;
  `role=status` for loading and empty; `role=alert` for 403/404/failure with the retry button only on a
  retryable failure.
- Detail assertions: open with `?package={entitlementId}`; the `aria-label` of the detail section is
  "Customer's packages"; sale-fact labels quoted from `packages/i18n` (`customerPackages.*`).
- Never assert a phone number or a customer name on the page; assert their absence.
