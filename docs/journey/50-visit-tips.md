# 50 · Record a visit's tips — تسجيل بقشيش الزيارة

**Status / الحالة:** the screen shipped in #398 (row 36-4, merged): a **تسجيل البقشيش** / **Record tip** button on each visit of the day list
and on the saved visit of the recording screen. Underneath, all merged: storage in #336 (36-1), the pure rules and the suggested split in
#339 (36-2), contracts and error codes in #345 (36-3a), the save use case in #366 (36-3b), and the `PUT`/`GET …/tips` routes in #383
(36-3c). Since #533 (2026-10-23) the admin runs on staging with demo data only, so this journey runs there.

Your decisions apply: TP-Q1 (same permission as recording a visit, nobody records her own tip), TP-Q2 (same time window as recording),
TP-Q3 and TP-Q5 (a change replaces the set with a written reason; no reason the first time), TP-Q4 and TP-Q8 (split by each employee's
share of the visit net), TP-Q7 (no ceiling, only a warning).

Not here yet: tips are stored but nothing counts them in commissions or statements (row 50 and the 36-5 reader are not built).

**Before you start / قبل ما تبدأ:**
- Everything in [47](47-record-visit-reception.md) «Before you start», then record **today** one visit for the synthetic customer (calling
  code `999`, number `00000001`) with two lines, no discount:
  - «قص شعر» / "Haircut" `25.000` by سارة / Sara;
  - «تنظيف بشرة» / "Facial" `7.125` by هبة / Heba. The visit net is `32.125`.
- **Who sees the button:**
  - On the day list: a user with `read:service-sessions:branch` **and** `record:service-sessions:branch` on the branch (by default Owner,
    General Manager, Business Manager, Branch Manager). A user without the record permission sees the list with no tip button.
  - A Cashier has no day list by default; she uses the same button under the saved visit on **تسجيل زيارة** / **Record a visit**.
- For step 9 only: a user who is linked to سارة's employee record and holds the record permission.

## العربي

1. **قائمة اليوم:** من القائمة الجانبية دوس **قائمة اليوم** ← `/orders/service-sessions` ← العنوان **قائمة اليوم**. **التاريخ** على النهارده.
   - لو مفيش فرع مختار: **اختار فرع قبل تسجيل الزيارة.**
2. **افتح البقشيش:** على الزيارة دوس **تسجيل البقشيش** ← نافذة **بقشيش الزيارة** بالبقشيش الحالي (أول مرة فاضي).
   - الكاشير: نفس الزرار تحت الزيارة المحفوظة في **تسجيل زيارة**.
3. **الاقتراح:** اكتب **إجمالي البقشيش** `8.000`، واختار **طريقة الاقتراح** **بطاقة**.
   - **التقسيم المقترح** بيظهر: سارة `6.226` وهبة `1.774`، على حسب نصيب كل واحدة من صافي الزيارة. المجموع `8.000` بالظبط.
   - دوس **استخدم الاقتراح** ← المبالغ بتتملي في **بقشيش بطاقة** لكل موظفة.
4. **التعديل:** تقدر تغيّر أي مبلغ بإيدك، مثلًا سارة `5.000` وهبة `3.000`، أو تكتب **بقشيش نقدي**.
   - **إجمالي النقد** و**إجمالي البطاقة** بيتحدثوا.
   - مبلغ مش صحيح (أكتر من 3 خانات، أو سالب، أو حروف): **اكتبي كل مبلغ بالدينار الكويتي بثلاث خانات.** الصفر بيتحسب خانة فاضية.
5. **الحفظ:** دوس **حفظ البقشيش** ← **جاري الحفظ…** ← **اتحفظ البقشيش.** أول مرة من غير سبب. المحفوظ هو أرقامك بالظبط، مش الاقتراح.
6. **تحذير الحجم:** لو البقشيش أكبر من صافي الزيارة (مثلًا نقدي `40.000`): **البقشيش أكبر من صافي الزيارة. تقدري تحفظيه برضو.** التحذير ما بيمنعش الحفظ.
7. **التغيير:** افتح البقشيش تاني، غيّر مبلغ، ودوس **حفظ البقشيش**.
   - بيظهر حقل **السبب** ومعاه **الحروف 0/500**. من غير سبب: **اكتبي سبب تغيير البقشيش (لحد 500 حرف).**
   - اكتب سبب واحفظ ← **اتحفظ البقشيش.** المجموعة القديمة بتفضل في السجل، والجديدة بتحل محلها.
   - حفظ من غير أي تغيير: **البقشيش زي ما هو، مفيش تغيير يتحفظ.**
   - تمسح كل المبالغ وتكتب سبب ← الزيارة بتبقى من غير بقشيش، كمراجعة جديدة.
8. **اتنين في نفس الوقت:** افتح نفس الزيارة في تبويبين، احفظ من الأول وبعدين من التاني ← **البقشيش اتغيّر من حد تاني. حدّثي الصفحة وحاولي تاني.**
   - الشاشة بتجيب البقشيش الحالي قبل أي حفظ جديد. لو الجلب فشل: **إعادة المحاولة**.
9. **بقشيشك إنتِ:** المستخدمة المربوطة بسارة تحاول تسجل أو تغيّر بقشيش سارة ← **ماينفعش تسجّلي أو تغيّري بقشيشك إنتِ.** ومفيش حاجة بتتحفظ.
10. **النت:** وإنت أوفلاين **حفظ البقشيش** متقفل. لو الطلب طلع وما رجعش رد: **النتيجة مش معروفة. نفس الزر هيعيد الحفظ ده بأمان.**
    - الزرار بقى **أعيدي نفس الحفظ**، وبيبعت نفس المفتاح، فالبقشيش ما بيتسجلش مرتين.
11. **العضوية:** لو عندك أكتر من عضوية على الفرع، الخادم بيرد **اختاري عضويتك التي تسجلين الجلسة بها.** وبيظهر اختيار **العضوية**.
12. **الصلاحية:** لو صلاحية التسجيل اتشالت وإنت فاتح النافذة، النافذة بتتقفل وزرار **تسجيل البقشيش** بيختفي من الزيارة.

**ممنوع يحصل:**
- موظفة تسجل أو تغيّر بقشيشها هي.
- تغيير من غير سبب، أو مسح صفوف فلوس قديمة بدل مراجعة جديدة.
- حفظين متزامنين ينجحوا على نفس المراجعة.
- بقشيش يتسجل مرتين بسبب إعادة أو رجوع النت.
- الاقتراح يتحفظ بدل اللي كتبه الكاشير، أو مجموع الاقتراح يختلف عن الإجمالي.
- رقم عشري تقريبي في المبالغ.

## English

1. **Day list:** in the sidebar press **Day list** → `/orders/service-sessions` → heading **Day list**. **Date** on today.
   - With no branch selected: **Choose a branch before recording a visit.**
2. **Open the tips:** on the visit press **Record tip** → dialog **Tips for this visit** with the current tips (empty the first time).
   - A Cashier: the same button under the saved visit on **Record a visit**.
3. **The suggestion:** enter **Tip total** `8.000` and choose **Suggestion method** **Card**.
   - **Suggested split** shows Sara `6.226` and Heba `1.774`, by each one's share of the visit net. The sum is exactly `8.000`.
   - Press **Use the suggestion** → the amounts fill **Card tip** for each employee.
4. **Editing:** change any amount by hand, for example Sara `5.000` and Heba `3.000`, or use **Cash tip**.
   - **Cash total** and **Card total** update.
   - An invalid amount (more than 3 decimals, negative, or letters): **Enter each amount in Kuwaiti dinars, with three decimal places.**
     A zero counts as an empty field.
5. **Save:** press **Save tips** → **Saving…** → **The tips were saved.** No reason the first time. What is stored is exactly your numbers,
   not the suggestion.
6. **Size warning:** a tip larger than the visit net (for example cash `40.000`): **This tip is larger than the visit net. You can still save it.**
   The warning never blocks saving.
7. **Changing:** open the tips again, change an amount and press **Save tips**.
   - A **Reason** field appears with **Characters 0/500**. With no reason: **Enter the reason for changing the tips (up to 500 characters).**
   - Enter a reason and save → **The tips were saved.** The old set stays in the history; the new one replaces it.
   - Saving with nothing changed: **The tips are unchanged; nothing to save.**
   - Clearing every amount with a reason → the visit has no tips, as a new revision.
8. **Two at once:** open the same visit in two tabs, save in the first, then in the second → **The tips were changed by someone else. Refresh and try again.**
   - The dialog loads the current tips before any new save. If that load fails: **Retry**.
9. **Your own tip:** the user linked to Sara tries to record or change Sara's tip → **You cannot record or change your own tip.** Nothing is saved.
10. **Connection:** while offline **Save tips** is disabled. If a request left and no answer came back: **The result is unknown. The same button replays this save safely.**
    - The button becomes **Retry the same save** and sends the same key, so the tip is never recorded twice.
11. **Membership:** with more than one membership on the branch, the server answers **Select your recorder membership.** and a
    **Membership** picker appears.
12. **Permission:** if the record permission is removed while the dialog is open, the dialog closes and **Record tip** disappears from the visit.

**Must NOT happen:**
- An employee recording or changing her own tip.
- A change without a reason, or old money rows deleted instead of a new revision.
- Two concurrent saves both succeeding on the same revision.
- A tip recorded twice because of a replay or a reconnect.
- The suggestion saved instead of what the cashier typed, or a suggestion whose sum differs from the total.
- A floating-point amount.

## For an agent

- **Admin:** local `http://localhost:3001/orders/service-sessions` (day list) and `http://localhost:3001/orders/service-sessions/new`
  (saved visit); staging `https://app.staging.pospay.systems/orders/service-sessions` (demo company «صالون الأميرة (تجريبي)», branch
  Salmiya or Hawalli; the owner gives the credentials privately). Make the visit first on staging; do not rely on demo visits.
  - Sidebar **قائمة اليوم** / **Day list**; the button **تسجيل البقشيش** / **Record tip**; the dialog title **بقشيش الزيارة** / **Tips for this visit**.
  - Fields: `#tip-total`, `#tip-method` (options `CASH`, `CARD`), `#tip-reason`; per employee inputs `#tip-cash-<n>` / `#tip-card-<n>`
    whose accessible name is the employee's name followed by **بقشيش نقدي** / **Cash tip** or **بقشيش بطاقة** / **Card tip**.
  - The suggestion is a list named **التقسيم المقترح** / **Suggested split**. On the saved visit, while a price edit's outcome is still
    unknown, the suggestion and the size warning are hidden and amounts are typed by hand (`netsKnown`). The size warning is a `role="status"`; refusals and the saved
    notice are a `role="alert"`.
- **API** (session cookie + `x-company-id`; feature `orders`; both under `record:service-sessions:branch`):
  - `GET /v1/businesses/<B>/branches/<BR>/service-sessions/<SESSION_ID>/tips` → `{ revision, tips, total_cash, total_card }`; no tips
    yet → `{ revision: 0, tips: [], total_cash: "0.000", total_card: "0.000" }`.
  - `PUT …/service-sessions/<SESSION_ID>/tips` with `Idempotency-Key` and
    `{ expected_revision, tips: [{ employee_id, method: "CASH" | "CARD", amount: "6.226" }], reason?, recorder_membership_id? }` → 200 with
    the new set.
  - Day list and its flags: `GET …/service-sessions?date=<YYYY-MM-DD>` and `GET …/service-sessions/capabilities`
    (`read:service-sessions:branch`; `can_record_sessions` decides the tip button).
- **Errors:** `SESSION_NOT_FOUND` 404 (unknown, foreign or out-of-branch visit, the same body) · `TIP_REVISION_CONFLICT` 409 ·
  422: `TIP_SELF_FORBIDDEN`, `TIP_IDENTITY_UNKNOWN`, `TIP_EMPLOYEE_NOT_PERFORMER`, `TIP_WINDOW_CLOSED`, `TIP_REASON_REQUIRED`,
  `TIP_NO_CHANGE`, `TIP_TOTAL_TOO_LARGE` · `SESSION_RECORDER_MEMBERSHIP_REQUIRED` · `FORBIDDEN` 403 · `FEATURE_DISABLED` ·
  `IDEMPOTENCY_KEY_REUSED` (same key, other body).
- **Assertions:**
  - each save adds one `session_tip_revisions` row (revision 1, 2, …) and its `session_tips` rows; earlier revisions stay; the screen
    asks for a reason only from revision 2, and revision 1 has none;
  - one `audit_log` row and one `SessionTipsChanged` outbox event per save, in the same transaction, with no customer name, phone or reason;
  - the same `Idempotency-Key` and body returns the first result and writes nothing;
  - stored amounts equal what was sent, not the suggestion; `8.000` over nets `25.000` / `7.125` suggests `6.226` / `1.774`.
- **Sources:**
  - `docs/specs/053-orders-record-tip/spec.md` (TP-Q1…TP-Q8, TP-01…TP-14), `owner-questions.ar.md`;
  - `apps/admin/src/orders/ui/{service-session-day-list,session-saved-visit,session-tips-*}.tsx`, `apps/admin/src/orders/model/session-tip-*.ts`;
  - `apps/admin/app/(dashboard)/orders/service-sessions/page.tsx`, `_frame/session-day-nav-item.tsx`;
  - `apps/api/src/modules/orders/http/session-tips.controller.ts`, `queries/session-tips-current.query.ts`, `packages/domain/src/tip-split.ts`;
  - `packages/i18n/src/{session-tips-catalog,service-session-errors,service-line-edit-catalog}.ts`; `packages/db/src/role-defaults.ts`.
