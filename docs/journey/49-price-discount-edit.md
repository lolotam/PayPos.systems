# 49 · Edit the price or discount of a saved service — تعديل سعر أو خصم خدمة محفوظة

**Status / الحالة:** row 35d, all merged. The screens shipped in #354 (35d-5b: branch day list, edit form, history panel) and #357
(35d-6: edit from the reception screen and the «edited» mark), with the user-visible fixes #360 and #361. Underneath them: contracts and
bell template #253, permission and history storage #254, bell consumer #266, performer and editor snapshots #288, editor label #304, edit
rules #312, edit use case #323, `PATCH` route #334, history read and the day-list `edited` flag #353.

Since #533 (2026-10-23) the admin runs on staging at https://app.staging.pospay.systems with demo data only (company «صالون الأميرة
(تجريبي)», branches Salmiya and Hawalli), so both screens can be tried there. The bell is delivered by the worker. Since #503 it also follows the
alert rules: a saved `SERVICE_LINE_EDITED` rule or the business alerts switch can narrow or silence it; with no saved rule it goes to the
four default roles. There are no browser (Playwright) tests for this flow yet; component and API tests only.

Not here: asking approval for a discount above your limit (spec 057), cancelling a line, changing performers, tips. Their buttons sit on the
same day-list line but belong to other journeys.

**Before you start / قبل ما تبدأ:**
- Everything from [47](47-record-visit-reception.md): services «قص شعر» / "Haircut" `25.000` and «تنظيف بشرة» / "Facial" `7.125`, employees
  سارة / Sara, هبة / Heba, منى / Mona, ريم / Reem, customer calling code `999` number `00000001`. The `orders` feature is enabled.
- A visit saved today in the branch ([47](47-record-visit-reception.md)): «قص شعر», price `25.000`, discount `2.000`, net `23.000`, performer سارة.
- **A manager:** منى / Mona as branch manager, linked to her employee record, with a personal discount limit of **20%** ([15](15-discount-limit.md)).
  Branch managers hold `edit:service-line-prices:branch` and `read:service-sessions:branch` by default (owner, general manager and
  business manager too).
- **A receptionist** for step 7: the cashier recorder of [47](47-record-visit-reception.md), with `edit:service-line-prices:branch` set to
  **Allow** ([12](12-permissions-screen.md)) and **no** branch read. Cashiers do not get the edit permission by default.
- The worker running, for the bell (step 8).

## العربي

1. **افتح قائمة اليوم:** بحساب منى، من القائمة الجانبية دوس **قائمة اليوم** ← `/orders/service-sessions`.
   - لو مفيش نشاط مختار: **اختر النشاط**. لو مفيش فرع: **اختار فرع قبل تسجيل الزيارة.**
   - **التاريخ** بيبدأ بالنهارده بتوقيت الفرع، وتقدر تختار يوم تاني. **المتأخر بس** بيعرض الزيارات المتأخرة بس، و**المزيد** بيجيب صفحة كمان.
   - يوم فاضي: **مفيش زيارات في اليوم ده.**
   - كل خدمة فيها **السعر (د.ك)** و**الخصم (د.ك)** و**الصافي (د.ك)** واسم الموظفة.
2. **افتح التعديل:** على «قص شعر» دوس **تعديل السعر والخصم**.
   - فوق: **المحفوظ دلوقتي** `25.000` `2.000` `23.000`.
   - غيّر **مبلغ الخصم (د.ك)** لـ `4.000` (أو حوّل لـ **الخصم (%)**) ← بيظهر **بعد التعديل** `4.000` `21.000`.
   - اكتب **السبب** «خصم عميلة دائمة». العداد **الحروف {count}/500**؛ سبب فاضي أو أطول من 500: **اكتب سبب من حرف واحد لحد 500 حرف.**
3. **احفظ:** **حفظ** ← **جاري الحفظ…** ← **اتسجل السعر والخصم**.
   - السطر بقى عليه **اتعدّل** والصافي `21.000`، وظهر زرار **السجل**.
4. **السجل:** دوس **السجل** ← لكل تعديل: **المراجعة**، **قبل** (سعر، خصم، صافي)، **بعد**، الوقت بتوقيت الفرع، **المعدّل** «منى»، والسبب.
   - **سجلات تانية** لو التعديلات كتير. الزرار ده بيظهر بس على سطر اتعدّل.
5. **الرفض:**
   - خصم `6.000` (24%) فوق حدها ← **الخصم الفعلي أعلى من حدك. عدّلي هذا البند.** ومعاه **الخصم الفعلي (%)** و**حد الخصم (%)** و**أقل صافي مسموح (د.ك)** و**أقصى خصم إضافي (د.ك)**.
   - نفس السعر والخصم ← **السعر والخصم زي ما هما، مفيش تعديل يتحفظ.**
   - سارة تعدّل خدمة عملتها بنفسها (حتى لو مالكة) ← **لا يمكنك تنفيذ هذا الإجراء على خدمة قمت بها بنفسك.**
   - زيارة أقدم من أول الشهر اللي فات ← **الجلسة أقدم من أول الشهر السابق.**
   - حد غيّر السطر قبلك (تبويبين) ← **اتغيّر السطر من حد تاني. حدّثي الصفحة وحاولي تاني.** القائمة بتتحدّث، والحفظ التاني بإيدك؛ مفيش إعادة لوحدها.
   - زرار التعديل ظاهر لكل سطر نشط. من غير صلاحية التعديل الحفظ بيرجع **غير مسموح بهذا الإجراء** والفورم بيتقفل.
6. **النتيجة مش معروفة:** لو الطلب طلع وما رجعش رد ← **النتيجة مش معروفة. نفس زر الحفظ هيعيد التعديل ده بأمان.**
   - الحقول بتتقفل، و**حفظ** بيبعت نفس الطلب بنفس المفتاح؛ التعديل ما بيتكررش.
7. **من الريسبشن:** المسجّلة تحفظ زيارة «تنظيف بشرة» `7.125` ([47](47-record-visit-reception.md))، وتحت البند المحفوظ تدوس **تعديل السعر والخصم**، خصم `0.500`، سبب، **حفظ**.
   - من غير صلاحية قراءة الفرع: الأرقام والإجمالي بيختفوا ومكانهم **السعر اتعدّل. الأرقام بتظهر للمديرين بس.** ومعاهم **اتعدّل**. مفيش **السجل** هنا.
   - لو فتحت التعديل تاني، السعر والخصم فاضيين.
   - مدير بيسجّل من نفس الشاشة: الأرقام والإجمالي بيتحدّثوا عادي.
   - لو حد غيّر السطر قبلها، الشاشة بتعيد مرة واحدة بس لوحدها؛ لو فشلت تاني بيظهر الخطأ.
8. **الجرس:** المديرين الأربعة في نطاق الفرع بيوصلهم في **الإشعارات** إشعار **غير مقروء**، وده يشمل منى نفسها لأنها مديرة (اللي عدّل ما بيتشالش):
   `عدّل {{editor_name_ar}} خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان الصافي {{previous_net}} دينار وأصبح {{new_net}} دينار.`
   - هنا: منى، «قص شعر»، الصافي من `23.000` لـ `21.000`.
   - المعدّل من غير ملف موظف بيظهر بالدور: **المالك** أو **المدير**. جرس واحد لكل تعديل.

**ممنوع يحصل:**
- خصم فوق حد المعدّل يتحفظ، أو حد يعدّل خدمة عملها بنفسه.
- تعديل يتحفظ مرتين بسبب ضغطتين أو رد ضاع، أو إعادة لوحدها على قائمة اليوم.
- علامة **اتعدّل** على سطر اتغيّر رقم مراجعته بس (إلغاء أو تغيير موظفات) من غير تعديل سعر.
- الريسبشن تشوف أرقام أو السجل أو السبب أو اسم المعدّل من غير صلاحية قراءة الفرع.
- السبب يظهر في الجرس.

## English

1. **Open the day list:** as Mona, in the sidebar press **Day list** → `/orders/service-sessions`.
   - With no business: **Choose a business**. With no branch: **Choose a branch before recording a visit.**
   - **Date** starts at today in the branch timezone; pick another day if you like. **Late only** keeps the late visits; **Load more** fetches another page.
   - An empty day: **No visits on this day.**
   - Each service shows **Price (KWD)**, **Discount (KWD)**, **Net (KWD)** and the performer.
2. **Open the edit:** on "Haircut" press **Edit price/discount**.
   - On top: **Saved now** `25.000` `2.000` `23.000`.
   - Change **Discount amount (KWD)** to `4.000` (or switch to **Discount (%)**) → **After this edit** `4.000` `21.000`.
   - Type the **Reason** "Loyal customer discount". The counter reads **Characters {count}/500**; empty or over 500: **Enter a reason of 1 to 500 characters.**
3. **Save:** **Save** → **Saving…** → **Price and discount saved**.
   - The line now shows **Edited** and net `21.000`, and a **History** button appears.
4. **History:** press **History** → for each edit: **Revision**, **Was** (price, discount, net), **Now**, the time in the branch timezone, **Editor** "Mona", and the reason.
   - **More** loads older edits. The button exists only on an edited line.
5. **Refusals:**
   - Discount `6.000` (24%), above her limit → **Effective discount exceeds your limit. Edit this line.** with **Effective discount (%)**, **Discount limit (%)**, **Minimum net (KWD)** and **Maximum additional discount (KWD)**.
   - The same price and discount → **Price and discount are unchanged; nothing to save.**
   - Sara editing a service she performed (even as owner) → **You cannot perform this action on a service you performed yourself.**
   - A visit older than the first day of the previous month → **Session predates the first day of the previous month.**
   - Someone changed the line first (two tabs) → **The line was changed by someone else. Refresh and try again.** The list refreshes; the second save is yours, nothing retries by itself.
   - The edit button shows on every active line. Without the edit permission, Save answers **This action is not allowed** and the form closes.
6. **Unknown outcome:** if a request left and no answer came back → **The result is unknown. The same Save replays this edit safely.**
   - The fields lock, and **Save** resends the same request under the same key; the edit is never applied twice.
7. **From reception:** the recorder saves a visit with "Facial" `7.125` ([47](47-record-visit-reception.md)), then under the saved line presses **Edit price/discount**, discount `0.500`, a reason, **Save**.
   - Without branch read: the figures and the total are replaced by **Price edited. Figures are shown to managers only.** with **Edited**. There is no **History** here.
   - Opening the edit again shows empty price and discount.
   - A manager recording on the same screen sees the figures and the total update.
   - If someone changed the line first, the screen retries once by itself; a second failure shows the error.
8. **The bell:** the four manager roles in the branch's scope get an **Unread** item in **Notifications**, Mona included because she is a manager (the editor is not left out):
   `{{editor_name_en}} edited {{service_name_en}} at {{branch_name_en}} dated {{business_date}}: the net was {{previous_net}} KWD and is now {{new_net}} KWD.`
   - Here: Mona, "Haircut", net from `23.000` to `21.000`.
   - An editor with no employee record shows as a role: **Owner** or **Manager**. One bell per edit.

**Must NOT happen:**
- A discount above the editor's limit saved, or anyone editing a service they performed.
- An edit applied twice because of a double click or a lost answer, or an automatic retry on the day list.
- **Edited** on a line whose revision changed only through a cancel or a performer change.
- The receptionist seeing figures, history, the reason or the editor's name without branch read.
- The reason inside the bell.

## For an agent

- **Admin:** local `http://localhost:3001/orders/service-sessions` (day list) and `http://localhost:3001/orders/service-sessions/new` (reception);
  staging `https://app.staging.pospay.systems/orders/service-sessions` and `…/orders/service-sessions/new`. Credentials come from the owner privately.
  - Sidebar link **Day list** / **قائمة اليوم**; buttons by visible text (`packages/i18n/src/service-line-edit-catalog.ts`): **Edit price/discount**,
    **Save**, **Close**, **History**, **More**, **Load more**, **Retry**.
  - The date input is `#service-day`; the form fields are `#edit-price`, `#edit-discount`, `#edit-reason`.
  - The saved notice is a `role="status"`; refusals are `role="alert"`. A membership select (**Membership {n}**) appears only after
    `SESSION_EDITOR_MEMBERSHIP_REQUIRED`.
- **API** (session cookie + `x-company-id`, individual admin login, feature `orders`):
  - Day list: `GET /v1/businesses/<B>/branches/<BR>/service-sessions?date=<YYYY-MM-DD>[&late=true][&cursor=…]` (`read:service-sessions:branch`);
    each line carries the boolean `edited`.
  - Capabilities (used by the day page): `GET …/service-sessions/capabilities` (`read:service-sessions:branch`).
  - Edit: `PATCH …/service-sessions/<SESSION>/lines/<LINE>` (`edit:service-line-prices:branch`, `Idempotency-Key` required, 200). Body
    `{ price, discount: { kind: 'AMOUNT', amount } | { kind: 'PERCENT', bps }, reason, expected_revision, editor_membership_id? }`. Response:
    `{ line (edited: true), session: { id, total_net } }` with branch read, otherwise only `{ saved: true, edited: true }`.
  - History: `GET …/service-sessions/<SESSION>/lines/<LINE>/edits?cursor&limit` (`read:service-sessions:branch`; the edit permission does not grant
    it; limit default 50, max 200). Items: `revision`, `previous`, `new`, `changed_at`, `editor_label_ar`, `editor_label_en`, `reason`.
  - Bell: worker consumer `orders.price-edit-notice-v1`, template `service_line_price_edited`, ledger `service_line_edit_notices`; history rows in
    `service_line_edits`; alert-rule kind `SERVICE_LINE_EDITED`.
- **Errors:** 409 `SESSION_LINE_REVISION_STALE` (details `current_revision` only) · 422 `SESSION_EDIT_NO_CHANGE`, `SESSION_LINE_NOT_EDITABLE`,
  `SESSION_EDIT_REASON_INVALID`, `SESSION_EDITOR_MEMBERSHIP_REQUIRED` (details `editor_membership_ids`), `SESSION_EDIT_IDENTITY_UNKNOWN`,
  `SESSION_DISCOUNT_ABOVE_LIMIT` (limit details), `SESSION_TIME_TOO_OLD` · 403 `SESSION_PERFORMER_SELF_FORBIDDEN`, `FORBIDDEN` (also a line of
  another session, branch or company) · `FEATURE_DISABLED` · `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` · 400 bad body.
- **Assertions:**
  - the mark comes only from `edited`, never from `revision` (a `revision: 5` line without `edited` shows no mark);
  - a stale edit and a refused edit leave no history row, no audit row and no outbox row;
  - one `ServiceLineChanged` with a `change` block per saved edit, and one bell per `(line, revision)`, even when the event is delivered twice;
  - the edit response never carries the previous figures, the editor, the time or the reason; the narrow response carries no number at all;
  - the reason appears only in the history read;
  - the reception screen makes no history or day-list request.
- **Tests:** API `apps/api/src/modules/orders/__tests__/service-session-line-edit*.spec.ts` and `service-line-edits*.spec.ts`; worker
  `apps/worker/src/modules/orders/__tests__/price-edit-notice*.spec.ts` and `alert-rule-price-edit-bell.spec.ts`; admin component specs
  `apps/admin/src/orders/{pages,ui,api}/*` (day page, edit form, saved visit, edit hooks).
- **Sources:**
  - `docs/specs/050-orders-record-service-session/{spec-35d,plan-35d}.md`; ADR-0044, ADR-0045;
  - `apps/admin/app/(dashboard)/_frame/{service-session-day-route,session-day-nav-item}.tsx`;
  - `apps/admin/src/orders/ui/{service-session-day-line,edit-service-line-form,edit-service-line-fields,edit-service-line-preview,service-line-edit-history,session-saved-line}.tsx`;
  - `packages/i18n/src/{service-line-edit-catalog,service-session-catalog,service-session-errors,in-app-catalog,editor-label}.ts`;
  - `apps/api/src/modules/orders/http/service-sessions.controller.ts`.
