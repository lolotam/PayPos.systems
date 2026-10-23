# 51 · Cancel a saved service line — إلغاء خدمة محفوظة

**Status / الحالة:** row 37, all merged. The screen shipped in #395 (37-5: the **إلغاء** / **Cancel** button on the day list, the «cancelled»
mark and the details panel). Underneath it: bell contracts and template #322, permission and storage #341, bell consumer #346, cancel
rules #364, cancel use case #386, `POST` route and the day-list `cancelled_at` #390.

Since #533 (2026-10-23) the admin runs on staging at https://app.staging.pospay.systems with demo data only (company «صالون الأميرة
(تجريبي)», branches Salmiya and Hawalli), so this journey can be tried there. The bell is delivered by the worker. Since #503 it also follows
the alert rules: a saved `SERVICE_LINE_CANCELLED` rule or the business alerts switch can narrow or silence it; with no saved rule it goes to
the four default roles. There are no browser (Playwright) tests for this flow yet; component and API tests only.

A cancel is **final** (CX-Q5): there is no «undo». A line cancelled by mistake is fixed by recording the service again.

**Before you start / قبل ما تبدأ:**
- Everything from [47](47-record-visit-reception.md) and the day list of [49](49-price-discount-edit.md). The `orders` feature is enabled.
- A visit saved today in the branch, customer `999` `00000001`, with two lines: «قص شعر» / "Haircut" `25.000` by سارة / Sara, and
  «تنظيف بشرة» / "Facial" `7.125` by هبة / Heba.
- **A manager:** منى / Mona as branch manager, linked to her employee record. The four default roles (owner, general manager, business
  manager, branch manager) hold `cancel:service-lines:branch` (**إلغاء بنود الخدمة** / **Cancel service lines** in
  [12](12-permissions-screen.md)) and `read:service-sessions:branch`. Any other role needs an explicit **Allow**.
- For step 8: a second visit where منى herself is the performer. For step 9: a tip for هبة on the first visit ([50](50-visit-tips.md)).
- The worker running, for the bell (step 7).

## العربي

1. **افتح قائمة اليوم:** بحساب منى، من القائمة الجانبية دوس **قائمة اليوم** ← `/orders/service-sessions`.
   - لو مفيش فرع مختار: **اختار فرع قبل تسجيل الزيارة.**
   - زرار **إلغاء** بيظهر على كل سطر لسه شغال، بس لو معاك صلاحية الإلغاء على الفرع. من غيرها الزرار مش ظاهر.
2. **افتح الإلغاء:** دوس **إلغاء** على سطر «قص شعر» ← حوار **إلغاء الخدمة**.
   - فيه **السعر (د.ك)** `25.000` و**الخصم (د.ك)** و**الصافي (د.ك)** واسم سارة، عشان تتأكد إنه السطر الصح.
3. **السبب:** اكتب في **السبب** «شكوى من الزبونة». تحته عداد **الحروف {count}/500**.
   - السبب فاضي أو مسافات بس ← **اكتب سبب الإلغاء (لحد 500 حرف).**
4. **الإلغاء:** دوس **إلغاء السطر** ← **جاري الإلغاء…** ← الحوار بيتقفل وفوق القائمة **اتلغى السطر.**
   - **إغلاق** بيقفل الحوار من غير ما يبعت حاجة.
5. **العلامة:** السطر **بيفضل** في القائمة بنفس أرقامه، وجنب اسمه **اتلغى**، وتحته وقت الإلغاء بتوقيت النشاط.
   - أزرار **تعديل السعر والخصم** و**تغيير المنفّذين** و**إلغاء** بتختفي من السطر ده. سطر «تنظيف بشرة» زي ما هو.
   - الشاشة مش بتعرض إجمالي الزيارة؛ الـ API بيحسبه من السطور الشغالة بس، فبقى `7.125`.
6. **التفاصيل:** دوس **التفاصيل** على السطر الملغي ← وقت الإلغاء، **اللي لغى** واسم منى أو دورها، **السبب** والنص اللي كتبته،
   و**قبل** **السعر (د.ك)** `25.000` **الخصم (د.ك)** **الصافي (د.ك)**. اللوحة دي محتاجة صلاحية قراءة قائمة اليوم.
7. **الجرس:** مديرين الفرع (ومعاهم منى نفسها) بيوصلهم إشعار بالقالب
   «أُلغيت خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان صافي السطر {{cancelled_net}} دينار.»،
   يعني اسم الخدمة والفرع والتاريخ وصافي السطر `25.000`. **مفيش** سبب ولا اسم اللي لغى.
8. **سطرك إنت:** في الزيارة التانية دوس **إلغاء** على السطر اللي منى نفذته واكتب سبب ← الحوار بيتقفل وفوق القائمة
   **لا يمكنك تنفيذ هذا الإجراء على خدمة قمت بها بنفسك.** حتى المالك مايقدرش يلغي سطر هو نفذه.
9. **البقشيش:** في الزيارة الأولى هبة عليها بقشيش و«تنظيف بشرة» هو سطرها الوحيد. الغي السطر ده ← جوه الحوار:
   **فيه بقشيش مسجّل لموظفة ملهاش خدمة تانية في الزيارة. امسحي البقشيش الأول وبعدين الغي.**
   - امسح بقشيش هبة من **تسجيل البقشيش** بسبب مكتوب ([50](50-visit-tips.md))، وبعدين الغي تاني ← بيتلغى.
   - لو هبة ليها سطر تاني شغال في نفس الزيارة، الإلغاء بيعدّي والبقشيش بيفضل.
10. **مديرين في نفس الوقت:** افتح القائمة في تبويبين والغي نفس السطر من الأول، وبعدين من التاني.
    - التاني بيظهر فيه لحظة **اتغيّر السطر من حد تاني. حدّثي الصفحة وحاولي تاني.** والقائمة بتتحدّث؛ ولأن السطر اتلغى، الحوار بيتقفل وتبان **اتلغى**.
    - لو السطر اتعدّل سعره بس، الحوار بيفضل مفتوح بالمراجعة الجديدة وتقدر تدوس تاني.
11. **العضوية:** لو عندك أكتر من عضوية على الفرع، أول ضغطة بتطلّع **اختاري العضوية اللي بتلغّي بيها.** وقايمة **العضوية**. اختار واحدة ودوس تاني.
12. **النت:**
    - من غير نت زرار **إلغاء السطر** متقفل.
    - لو الطلب طلع وماجاش رد: **النتيجة مش معروفة. نفس الزر هيعيد الإلغاء ده بأمان.** والسبب بيتقفل. نفس الزرار بيبعت نفس المفتاح، فالسطر بيتلغى مرة واحدة.
13. **يوم قديم:** زيارة قبل أول الشهر اللي فات ← **الجلسة أقدم من أول الشهر السابق.**

**ممنوع يحصل:**
- سطر ملغي يتمسح من القائمة، أو أرقامه تتغيّر، أو يرجع شغال تاني.
- حد يلغي سطر هو نفذه، أو اتشال منه بتغيير المنفّذين، حتى المالك.
- بقشيش يتمسح لوحده بسبب الإلغاء.
- السبب أو اسم اللي لغى يظهر في الجرس.
- نفس السطر يتلغى مرتين أو الجرس يرن مرتين لنفس الإلغاء.

## English

1. **Open the day list:** as Mona, in the sidebar press **Day list** → `/orders/service-sessions`.
   - With no branch selected: **Choose a branch before recording a visit.**
   - A **Cancel** button shows on every active line, only if you hold the cancel permission on the branch. Without it the button is hidden.
2. **Open the cancel:** press **Cancel** on the "Haircut" line → dialog **Cancel the service**.
   - It shows **Price (KWD)** `25.000`, **Discount (KWD)**, **Net (KWD)** and Sara's name, so you can check it is the right line.
3. **Reason:** type "Customer complaint" in **Reason**. Below it a counter **Characters {count}/500**.
   - An empty or blank reason → **Enter the reason for the cancellation (up to 500 characters).**
4. **Cancel:** press **Cancel the line** → **Cancelling…** → the dialog closes and above the list **The line was cancelled.**
   - **Close** closes the dialog and sends nothing.
5. **The mark:** the line **stays** in the list with its figures, with **Cancelled** next to its name and the cancel time under it, in the
   business timezone.
   - **Edit price/discount**, **Change performers** and **Cancel** disappear from that line. The "Facial" line is unchanged.
   - The screen does not show a visit total; the API counts active lines only, so it is now `7.125`.
6. **Details:** press **Details** on the cancelled line → the cancel time, **Cancelled by** with Mona's name or role, **Reason** with your
   text, and **Was** **Price (KWD)** `25.000` **Discount (KWD)** **Net (KWD)**. This panel needs the day-list read permission.
7. **The bell:** the branch managers (Mona included) get a notice from the template
   "{{service_name_en}} was cancelled at {{branch_name_en}} dated {{business_date}}: the line net was {{cancelled_net}} KWD.",
   that is the service, branch, date and the line net `25.000`. **No** reason and no canceller name.
8. **Your own line:** on the second visit press **Cancel** on the line Mona performed, with a reason → the dialog closes and above the list
   **You cannot perform this action on a service you performed yourself.** Even the owner cannot cancel a line they performed.
9. **A tip:** on the first visit Heba has a tip and "Facial" is her only line. Cancel it → inside the dialog:
   **A tip is recorded for a performer who has no other service on this visit. Remove the tip first, then cancel.**
   - Remove Heba's tip from **Record tip** with a written reason ([50](50-visit-tips.md)), then cancel again → it is cancelled.
   - If Heba has another active line on the same visit, the cancel goes through and the tip stays.
10. **Two managers at once:** open the list in two tabs, cancel the same line in the first, then in the second.
    - The second briefly shows **The line was changed by someone else. Refresh and try again.** while the list refreshes; because the line
      is now cancelled, the dialog closes and **Cancelled** shows.
    - If only its price was edited, the dialog stays open with the new revision and you can press again.
11. **Membership:** with more than one membership on the branch, the first press shows **Select the membership you are cancelling under.**
    and a **Membership** list. Choose one and press again.
12. **Connection:**
    - Offline, **Cancel the line** is disabled.
    - If the request left and no answer came back: **The result is unknown. The same button replays this cancellation safely.** and the reason
      locks. The same button resends the same key, so the line is cancelled once.
13. **An old day:** a visit before the first day of the previous month → **Session predates the first day of the previous month.**

**Must NOT happen:**
- A cancelled line removed from the list, its figures changed, or made active again.
- Anyone cancelling a line they performed, or were removed from by a performer change, owner included.
- A tip removed by itself because of a cancel.
- The reason or the canceller's name in the bell.
- The same line cancelled twice, or the bell ringing twice for one cancel.

## For an agent

- **Admin:** local `http://localhost:3001/orders/service-sessions`; staging `https://app.staging.pospay.systems/orders/service-sessions`
  (demo company «صالون الأميرة (تجريبي)», branch Salmiya or Hawalli; the owner gives the credentials privately). Make the visit first; do not
  rely on demo visits. Sidebar link **Day list** / **قائمة اليوم**.
  - Labels are in `packages/i18n/src/service-line-cancel-catalog.ts` (`serviceLineCancel.*`); figures and day-list labels in
    `service-line-edit-catalog.ts` and `service-session-catalog.ts`.
  - The dialog is a modal titled **Cancel the service**; the reason input is `#cancel-reason`; the membership list has
    `aria-label` **Membership**.
  - Dialog refusals are a `role="alert"` inside the dialog; success and 403 refusals are the `role="status"` above the list.
- **API** (session cookie + `x-company-id`; the write needs `Idempotency-Key`; base `/v1/businesses/<B>/branches/<BR>/service-sessions`):
  - `GET …/capabilities` (`read:service-sessions:branch`, feature `orders`) → `can_cancel_lines` drives the **Cancel** button.
  - `POST …/<SESSION_ID>/lines/<LINE_ID>/cancellation` (`cancel:service-lines:branch`, feature `orders`, admin login only, 200) with
    `{ reason, expected_revision, canceller_membership_id? }` → with the branch read `{ line, session: { id, total_net } }`, without it
    `{ cancelled: true }`. Never the reason.
  - `GET …/<SESSION_ID>/lines/<LINE_ID>/cancellation` (`read:service-sessions:branch`; the cancel permission alone does not grant it) →
    `{ cancelled_at, canceller_label_ar, canceller_label_en, reason, previous: { revision, price, discount, net } }`.
  - Day list `GET …?date=<YYYY-MM-DD>`: a cancelled line has `status: "CANCELLED"` and `cancelled_at`.
- **Errors:** `SESSION_CANCEL_REASON_INVALID` · `SESSION_CANCEL_BLOCKED_BY_TIP` (`details.employee_ids`, no amounts) ·
  `SESSION_LINE_ALREADY_CANCELLED` · `SESSION_LINE_IDENTITY_UNKNOWN` · `SESSION_CANCELLER_MEMBERSHIP_REQUIRED`
  (`details.canceller_membership_ids`) · `SESSION_LINE_NOT_CANCELLABLE` (reserved) · `SESSION_TIME_TOO_OLD` — all 422;
  `SESSION_LINE_REVISION_STALE` 409 (`details.current_revision` only) · `SESSION_PERFORMER_SELF_FORBIDDEN` 403 · `FORBIDDEN` 403 (the same
  body for a foreign or unknown session, line, branch or business) · `IDEMPOTENCY_KEY_REUSED` · `FEATURE_DISABLED`.
- **Assertions:**
  - the line keeps `price`, `discount`, `net` and performers; `revision` goes up by one; `session.total_net` drops by the line net;
  - one `service_line_cancellations` row per line; the same key replays the same 200 with no second write and no second bell;
  - the event (`ServiceLineChanged`, `change.kind = "LINE_CANCELLED"`), the audit row and the notice carry no reason, phone or customer name;
  - one notice row per cancelled line (`service_line_cancel_notices`), recipients the four scoped roles including the canceller;
  - a later price edit of the cancelled line → `SESSION_LINE_NOT_EDITABLE`.
- **Automated tests:** component tests `apps/admin/src/orders/{pages/service-session-day-cancel*.spec.tsx,ui/cancel-service-line-dialog.spec.tsx,
  ui/service-line-cancellation-details.spec.tsx}`; API and worker integration tests from #386, #390 and #346. No Playwright suite.
- **Sources:**
  - `docs/specs/054-orders-cancel-service-line/{spec.md,owner-questions.ar.md}` (CX-Q1…CX-Q5);
  - `apps/admin/src/orders/ui/{service-session-day-line,cancel-service-line-*,service-line-cancellation-details}.tsx`;
  - `apps/admin/src/orders/pages/service-session-day-page.tsx`;
  - `packages/i18n/src/{service-line-cancel-catalog,service-session-errors,in-app-catalog}.ts`;
  - `apps/api/src/modules/orders/http/service-sessions.controller.ts`;
  - `apps/worker/src/modules/orders/use-cases/request-line-cancel-notice/`.
