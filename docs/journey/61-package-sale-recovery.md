# 61 · Package sale recovery when the response is lost — استرجاع بيع الباقة لما الرد يضيع

**Status / الحالة:** the sale screen shipped in #1073 and the cross-tab journal reservation in #1077. The follow-ups of
issue #1075 hardened what the browser remembers and shows: the fail-closed expiry check with the `seenAt` high-water
mark, per-scope held attempts, the status-only record, the expiry refresh while the screen is open, the «could not be
saved on this device» warning, and the acknowledged discard of an expired attempt. It needs the `orders` feature and
reaches staging with the next daily batch after the merge. No browser test covers it yet.

This continues [47](47-record-visit-reception.md) and the package sale screen: the sell **بيع باقة** / **Sell a package**
request goes out with an idempotency key, and the response can be lost (network blip, tab crash, device sleep) after the
server accepted it. The journal in the browser's `localStorage` remembers the attempt so the same sale is retried with
the same key — never sold twice. The server stays authoritative for every sale; everything here is only what the
browser remembers and shows.

**Before you start / قبل ما تبدأ:**
- Everything a normal package sale needs: branch selected, a sellable package with a price, a seller employee, and a
  recorder membership (`sell:packages:branch`), plus a customer you can find or create.
- **An unresolved sale:** on **بيع باقة** / **Sell a package** fill the form and press **بيع الباقة** / **Sell package**,
  then lose the response — by hand: switch the network (or Wi-Fi) off in the second right after pressing. The button
  turns into **إعادة محاولة البيع الأصلي** / **Retry original sale** under the alert **البيع السابق ممكن يكون اتقبل…** /
  **The previous sale may have been accepted…**. Do **not** press it yet if you want to test the window.
- **The 23-hour window:** the retry stays possible for 23 hours from the attempt's creation, by the device clock. The
  device also remembers the latest time it *saw* the attempt (`seenAt`) and allows a five-minute clock tolerance: a
  clock more than five minutes behind that last observation expires the attempt at once, and an observed expiry is
  latched into `seenAt`, so no later clock move reopens the window.
- For the expired state by hand: change the device clock forward 23 hours (or let a real attempt age) and reload the
  screen in the same browser profile — the journal is per company, business, branch **and user**.

## العربي

1. **الرسالة بعد ضياع الرد:** الشاشة بتقفل كل الحقول وتظهر تنبيه **البيع السابق ممكن يكون اتقبل. التعديل مقفول؛ أعيدي
   محاولة البيع الأصلي فقط.** وزرار **إعادة محاولة البيع الأصلي**.
2. **إعادة المحاولة:** لما تدوسي عليها بيتبعت نفس البيع بنفس المفتاح ونفس البيانات بالظبط. لو الطلب الأصلي وصل للخادم،
   الرد بيرجع نتيجة نفس البيع — مفيش باقة تانية بتتبيع. النتيجة بتظهر كالمعتاد (قيد التنفيذ، ثم اتباعت الباقة أو رسالة
   الفشل)، وبعد نتيجة مؤكدة المحاولة بتتمسح من الجهاز. بعد فشل مؤكد الفورم بيتفتح لبيع مصحّح بمفتاح جديد.
3. **التحديث من تاب تاني:** لو فتحتي شاشة البيع في تاب تاني على نفس الفرع ونفس المستخدمة، التاب التاني بيتقفل في وضع
   الاسترجاع زي الأول، وأي تاب يأكد النتيجة بيشيلها من الباقيين.
4. **تحذير الجهاز:** لو الجهاز رفض كتابة الجورنال (وضع التصفح الخاص أو المساحة مليانة)، التنبيه **تعذّر حفظ محاولة البيع
   على الجهاز ده. خلّي الصفحة مفتوحة لحد ما النتيجة تظهر؛ إعادة التحميل ممكن تضيّع متابعتها.** بيظهر فوق رسالة
   الاسترجاع. الإعادة بتشتغل من الذاكرة، بس إعادة تحميل الصفحة ممكن تضيّع المحاولة — خلّي التاب مفتوح.
5. **بعد 23 ساعة:** رسالة الاسترجاع بتتحول لـ **انتهت مهلة إعادة المحاولة. تحققي من نتيجة البيع الأصلي مع المدير قبل بدء
   بيع جديد.** وزرار الإعادة بيتقفل. الرسالة بتتحول لوحدها والشاشة مفتوحة (بدون إعادة تحميل) لما الوقت يعدي، وعند رجوع
   التاب أو فتح النافذة.
6. **مراجعة المدير والتجاهل:** تحت الرسالة بيظهر مربع اختيار **اتحققت من نتيجة البيع الأصلي مع المدير.** وزرار **تجاهل
   المحاولة الأصلية** متقفل. بعد ما تعلّمي المربع، الزرار بيتفتح: الدوس عليه بيمسح المحاولة من الجهاز (من غير أي طلب
   للخادم) وبيفتح الفورم لبيع جديد بمفتاح جديد. المربع بيخص المحاولة دي بس؛ أي محاولة تانية بتبدأ والمربع مش معلّم.
7. **البيع المتقبل:** لو الرد وصل والطلب اتقبل، الجهاز بيحتفظ برقم الطلب بس (من غير بيانات البيع)، والشاشة بتسأل الخادم
   عن الحالة بالقراءة بس — مفيش بيع تاني — لحد ما النتيجة تتأكد أو المهلة (دقيقة) تقفل.

**ممنوع يحصل:**
- الإعادة تبعت مفتاح أو بيانات مختلفة عن المحاولة الأصلية.
- باقة تانية تتبيع من نفس الرد الضائع.
- محاولة منتهية تتبعت تاني للخادم.
- زرار **تجاهل المحاولة الأصلية** يشتغل والمربع مش معلّم.
- التجاهل يبعت أي طلب للخادم.
- تحذير «تعذّر حفظ محاولة البيع» يختفي والمحاولة لسه غير محسومة، أو يفضل ظاهر بعد ما الباقة اتباعت.
- المفتاح يظهر في رابط أو في اللوج.

## English

1. **The message after a lost response:** the screen locks every field and shows the alert **The previous sale may have
   been accepted. Edits are locked; retry only the original sale.** with the **Retry original sale** button.
2. **The retry:** pressing it sends the same sale with the same key and exactly the same body. If the original request
   reached the server, the answer is that same sale's result — no second package is sold. The result shows as usual
   (Processing, then Package sold or the failure message), and after a confirmed outcome the attempt is removed from the
   device. After a confirmed failure the form opens for a corrected sale with a new key.
3. **Another tab:** opening the sale screen in a second tab for the same branch and user locks that tab into recovery
   too, and whichever tab confirms the outcome clears it for the others.
4. **The device warning:** if the device refused the journal write (private browsing, or storage full), the alert **This
   sale attempt could not be saved on this device. Keep this page open until the result appears; reloading may lose
   track of it.** shows above the recovery message. The retry still works from memory, but reloading the page may lose
   the attempt — keep the tab open.
5. **After 23 hours:** the recovery message turns into **The retry window has expired. Verify the original sale with
   your manager before starting another sale.** and the retry button disables. The message flips by itself while the
   screen stays open (no reload) when the time passes, and when the tab regains focus or the window becomes visible.
6. **The manager check and the discard:** under the message there is a checkbox **I verified the original sale with the
   manager.** and a disabled **Discard the original attempt** button. Ticking the checkbox enables the button: pressing
   it removes the attempt from the device (no request is sent to the server) and opens the form for a new sale with a
   new key. The tick belongs to that one attempt; any other attempt starts unticked.
7. **The accepted sale:** if the response arrived and the request was accepted, the device keeps only the request ID
   (no sale body), and the screen asks the server for the status with reads only — never a second sale — until the
   outcome is confirmed or the one-minute polling window closes.

**Must NOT happen:**
- The retry sends a different key or a different body than the original attempt.
- A second package is sold from one lost response.
- An expired attempt is sent to the server again.
- **Discard the original attempt** works while the checkbox is unticked.
- The discard sends any request to the server.
- The «could not be saved on this device» warning disappears while the attempt is still unresolved, or stays after the
  package was sold.
- The key appears in a URL or is written to a log.

## For an agent

- **Admin:** local `http://localhost:3001/orders/package-sales/new`, staging
  `https://app.staging.pospay.systems/orders/package-sales/new` (demo company «صالون الأميرة (تجريبي)», branch Salmiya or
  Hawalli; the owner gives the credentials privately).
  - The recovery, expiry and device warnings are `role="alert"` elements.
  - Buttons and controls by visible text: **إعادة محاولة البيع الأصلي** / **Retry original sale**, the checkbox labelled
    **اتحققت من نتيجة البيع الأصلي مع المدير.** / **I verified the original sale with the manager.** (native checkbox),
    and **تجاهل المحاولة الأصلية** / **Discard the original attempt** (`variant="outline"`, disabled until the checkbox
    is ticked).
  - To lose a response on purpose: intercept the sale POST and drop the response (keep the request). To reach the
    expired state: fake the browser clock 23 hours forward and reload, or seed the journal record directly (below).
- **Journal** (`localStorage`, key `pospay:package-sale:[companyId,businessId,branchId,userId]` — the key itself is only
  ever in the journal and the `Idempotency-Key` header, never in a URL or a log):
  - A not-yet-accepted record holds `{ key, scope, createdAt, seenAt?, body }`; expiry allows a five-minute tolerance
    behind the last observation (`seenAt ?? createdAt`), expires at 23 h since `createdAt` measured to the later of
    the two clocks, and latches an observed expiry into `seenAt` so it stays expired.
  - An accepted record holds exactly `{ key, scope, createdAt, saleId }` — no `body`.
  - After **Discard the original attempt** the key is removed and no request was sent.
- **Assertions:**
  - retry after a lost response reuses the same `Idempotency-Key` and the same body;
  - with the screen open, the expired message flips without a reload when the clock crosses the window (the tab re-checks
    on the expiry timer, on window focus and on visibility change);
  - the discard button stays disabled until the acknowledgement checkbox is ticked, and clicking it removes the journal
    key while `saleCalls` stays unchanged;
  - when storage writes throw, the journal-unsaved alert shows and the retry still works from memory with the same key.
- **Sources:** `docs/specs/058-packages-sell-redeem/spec.md` («Sale picker recovery (PP-131.2)»),
  `docs/specs/058-packages-sell-redeem/1075-b1-plan.md`;
  `apps/admin/src/orders/api/{package-sale-attempt.ts,use-sell-package.ts,use-package-sale-window.ts}`,
  `apps/admin/src/orders/ui/{package-sale-form.tsx,package-sale-recovery-notice.tsx}`;
  `packages/i18n/src/package-sale-catalog.ts`.
