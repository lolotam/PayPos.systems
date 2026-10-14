# 47 · Record a visit at reception — تسجيل زيارة من الريسبشن

**Status / الحالة:** the screen shipped in #212 (PR 35c-12a, merged). Its browser tests shipped in #215 (PR 35c-12b, merged), and
they run manually against a local stack. The recording API underneath shipped in #178 (row 35a) and is on staging. The **admin is not
deployed yet** (issue #54), so the screen runs locally only.

This is the first 35c screen a person uses. It builds on the customer field, the service lines, discounts, performers, the time field and
the result handling of 35c-5…11 and 35c-11b. Your decisions apply: SS-Q16 (the two «New visit» actions) and SS-Q17 (no reception day list).

Not here yet:
- Leaving a recording that is still unresolved after 24 h without logging out (SS-Q18, row 35c-13). The read that lists the recorder's own
  visits of that day comes first (SS-Q19, row 35c-13a, `TODO(design)`).
- Editing price or discount after saving (35d).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` and `pnpm db:seed`.
- Sign in and select a company, a business and a **branch** ([01](01-admin-sign-in-and-totp.md), [02](02-admin-workspace-selector.md)).
- The `orders` and `customers` features are enabled.
- Synthetic data in that branch:
  - services from [29](29-services.md): «قص شعر» / "Haircut" at `25.000` and «تنظيف بشرة» / "Facial" at `7.125`;
  - four employees linked to the branch: سارة / Sara, هبة / Heba, منى / Mona, ريم / Reem ([13](13-create-employee.md)).
- A **recorder**: a user with a cashier membership on the branch (`record:service-sessions:branch`) and a personal discount limit of **10%**
  ([15](15-discount-limit.md)).
- **Or let the browser-test seed make it all:** `pnpm --filter @pospay/api e2e:seed` (see the runbook section "Admin service-session browser
  tests"). Its names are generated per run, so read them from `apps/admin/e2e/.state/session.env`:
  - services `E2E <tag> Home Standard` at `25.000` (`STANDARD_SERVICE_NAME`) and `E2E <tag> Home Odd` at `7.125` (`ODD_SERVICE_NAME`) — use them
    in place of "Haircut" and "Facial" below;
  - employees `E2E <tag> Home Ada`, `… Bea`, `… Cleo`, `… Dina` — use them in place of Sara, Heba, Mona, Reem;
  - the recorder (`RECORDER_EMAIL`) has two cashier memberships, at 10% and 5%, and signs in with password and TOTP (`RECORDER_TOTP_SECRET`
    is the authenticator secret);
  - the owner (`OWNER_EMAIL`) signs in with password only and records with **no** limit (**Limit source:** **Owner**), so step 8's refusal
    needs the recorder.
- A synthetic customer phone: calling code `999`, number `00000001`.

## العربي

0. **لو استخدمت الـ seed:** أسماء الخدمات والموظفات في الملف `apps/admin/e2e/.state/session.env` (شوف «قبل ما تبدأ»): «Standard» بدل «قص شعر»، و«Odd» بدل «تنظيف بشرة»، وAda/Bea/Cleo/Dina بدل سارة وهبة ومنى وريم. ورفض الخطوة 8 محتاج المسجّلة، لأن المالك مالوش حد.
1. **افتح الشاشة:** من القائمة الجانبية دوس **تسجيل زيارة** ← `/orders/service-sessions/new` ← العنوان **تسجيل زيارة**.
   - لو مفيش نشاط مختار بيظهر **اختر النشاط**.
   - لو مفيش فرع مختار بيظهر **اختار فرع قبل تسجيل الزيارة.** والشاشة ما بتختارش أول فرع لوحدها.
2. **الزبونة:** اكتب **اسم الزبونة** و**رمز الاتصال** `999` و**رقم التليفون (من غير رمز الاتصال)** `00000001`، ودوس **إيجاد أو إنشاء الزبونة**.
   - بيظهر كارت **تم اختيار الزبونة** والرقم مخفي (`***001`).
   - الرقم الكامل ما بيتحفظش في المتصفح.
3. **الوقت:** **وقت الجلسة** على **دلوقتي**، وجنبه **المنطقة الزمنية للنشاط:**.
   - تقدر تكتب وقت قديم في حدود الشهر اللي فات (**أقدم وقت مسموح: …**).
   - الوقت في المستقبل بيترفض.
4. **العضوية والحد:** في **عضوية المسجّل** بتظهر عضويتك.
   - تحتها **حد الخصم:** `10.00%` و**مصدر الحد:** **حد شخصي**.
   - لو عندك أكتر من عضوية، اختار واحدة؛ الحد بيتغير معاها.
5. **الخدمة:** في **بند الخدمة 1** اختار **الخدمة** «قص شعر» ← **السعر (د.ك)** بيتملي `25.000` من الكتالوج، وتقدر تغيّره.
   - اكتب **مبلغ الخصم (د.ك)** `2.000`، أو حوّل لـ **الخصم (%)**.
   - في **الموظفات** اختار سارة. ولو اخترت أكتر من موظفة: يا **تقسيم بالتساوي تلقائيًا** يا **نسب مخصصة** مجموعها 100%.
   - لو الموظفة ما سجلتش حضور بيظهر جنبها **لم تسجل حضورها**، ولو في إجازة **إجازة مقبولة**. التحذير ده ما بيمنعش الحفظ.
   - **إضافة خدمة** بيزوّد بند جديد.
6. **الملخص:** **إجمالي غير المحفوظ مؤقتًا (د.ك):** بيتحسب بنفس دوال الـ API، والحد بيظهر تاني فيه.
7. **الحفظ:** دوس **حفظ الزيارة** ← **جاري حفظ الزيارة…** والفورم بيتقفل ← **اتحفظت الزيارة**.
   - البنود المحفوظة بتظهر **محفوظ · للقراءة فقط** ومعاها **إجمالي الزيارة المحفوظ (د.ك):**.
   - تحتها **زيارة جديدة** (بيمسح كل حاجة) و**زيارة جديدة لنفس الزبونة** (بيسيب الزبونة بس).
8. **بند فوق الحد:** في زيارة جديدة اختار «تنظيف بشرة» `7.125` و**الخصم (%)** `10`.
   - الخصم بيتقرّب لـ `0.713` وده أعلى من الحد `0.712`، فبعد الحفظ البند بيترفض: **الخصم الفعلي أعلى من حدك. عدّلي هذا البند.**
   - لو معاه بند تاني صحيح: **اتحفظت الخدمات الصحيحة. عدّلي المسودات المرفوضة بس.** البند الصحيح اتحفظ، والمرفوض في **المسودات المرفوضة**.
   - دوس **تعديل المسودة المرفوضة** وصلّح الخصم ← الزرار بقى **حفظ التصحيح على نفس الزيارة** ← البند بيتضاف لنفس الزيارة.
   - الزبونة والوقت والعضوية بيتقفلوا بعد أول حفظ. حد الخصم بيفضل ظاهر للتصحيح.
9. **كل البنود فوق الحد:** **مفيش خدمات اتحفظت من المحاولة دي. عدّلي المسودات المرفوضة وحاولي تاني.** ومفيش زيارة اتعملت.
10. **النت قطع:**
    - وقت الانقطاع بيظهر **الاتصال مش متاح. إيجاد الزبونة والقراءات الجديدة والحفظ متوقفين، واللي كتبتيه فاضل على الشاشة.** والحفظ متقفل.
    - لو الطلب طلع وما رجعش رد: **التسجيل لسه غير محسوم. أعيدي نفس المحاولة قبل التعديل أو بدء زيارة جديدة.** ومعاه **إعادة نفس المحاولة**.
    - لما النت يرجع **مفيش إرسال لوحده**؛ إعادة المحاولة بتبعت نفس المفتاح، فالزيارة ما بتتكررش.
    - لو عملت reload للصفحة والمحاولة معلّقة، بتظهر تاني بنفس الزرار.
11. **الصلاحية:** مستخدم من غير صلاحية التسجيل على الفرع ← **غير مسموح بهذا الإجراء** ومفيش فورم.
    - لو الصلاحية اتشالت وإنت شغال، الشاشة بتعيد قراءة الصلاحية بعد أول رفض.
12. **تغيير الهوية أو النطاق:** خروج ودخول بمستخدم تاني، أو تغيير الشركة أو النشاط أو الفرع ← الفورم والمحاولة المعلّقة بيتمسحوا.

**ممنوع يحصل:**
- زيارة تتسجل مرتين بسبب ضغطتين، أو رد ضاع، أو رجوع النت.
- إرسال لوحده بعد ما النت يرجع.
- بند فوق الحد يتحفظ، أو بند محفوظ يتغير بعد الحفظ.
- اختيار فرع لوحده.
- بيانات مستخدم أو فرع تفضل ظاهرة بعد تغيير الهوية أو النطاق.
- رقم الزبونة الكامل يتخزن في المتصفح.

## English

0. **If you used the seed:** read the service and employee names from `apps/admin/e2e/.state/session.env` (see Before you start): "Standard" for "Haircut", "Odd" for "Facial", Ada/Bea/Cleo/Dina for Sara, Heba, Mona and Reem. Step 8's refusal needs the recorder, because the owner has no limit.
1. **Open the screen:** in the sidebar press **Record a visit** → `/orders/service-sessions/new` → heading **Record a visit**.
   - With no business selected it shows **Choose a business**.
   - With no branch selected it shows **Choose a branch before recording a visit.** It never picks the first branch for you.
2. **Customer:** enter **Customer name**, **Calling code** `999` and **Phone number (without calling code)** `00000001`, then press
   **Find or create customer**.
   - A **Customer selected** card appears with the masked phone (`***001`).
   - The full number is not stored in the browser.
3. **Time:** **Session time** is **Now**, with **Business timezone:** beside it.
   - An earlier time back to the start of the previous month is allowed (**Oldest allowed: …**).
   - A future time is refused.
4. **Membership and limit:** **Recorder membership** shows your membership.
   - Under it: **Discount limit:** `10.00%` and **Limit source:** **Personal limit**.
   - With more than one membership, choose one; the limit follows it.
5. **Service:** in **Service line 1** choose the **Service** "Haircut" → **Price (KWD)** is pre-filled `25.000` from the catalog and can be changed.
   - Enter **Discount amount (KWD)** `2.000`, or switch to **Discount (%)**.
   - Under **Performers** choose Sara. With more than one performer: **Equal split automatically**, or **Custom shares** that total 100%.
   - A performer who has not clocked in shows **Not clocked in**; one on leave shows **Approved leave**. These warnings never block saving.
   - **Add service** adds another line.
6. **Summary:** **Provisional unsaved total (KWD):** is computed with the same functions as the API, and shows the limit again.
7. **Save:** press **Save visit** → **Saving visit…** and the form locks → **Visit saved**.
   - Saved lines show **Saved · read only** with **Saved visit total (KWD):**.
   - Below them: **New visit** (clears everything) and **New visit, same customer** (keeps only the customer).
8. **A line over the limit:** in a new visit choose "Facial" `7.125` with **Discount (%)** `10`.
   - The discount rounds to `0.713`, above the `0.712` maximum, so after saving the line is refused: **Effective discount exceeds your limit. Edit this line.**
   - With a valid line beside it: **Valid services saved. Edit only the rejected drafts.** The valid line is saved; the refused one is under **Rejected drafts**.
   - Press **Edit rejected draft**, fix the discount → the button now reads **Save corrections on this visit** → the line is appended to the same visit.
   - The customer, time and membership lock after the first save. The discount limit stays visible for corrections.
9. **Every line over the limit:** **No services from this attempt were saved. Edit the rejected drafts and try again.** and no visit is created.
10. **The connection drops:**
    - While offline: **No connection. Find or create, fresh reads and saving are paused. What you typed stays on this screen.** Saving is disabled.
    - If a request left and no answer came back: **Recording is unresolved. Replay the original attempt before editing or starting a new visit.**
      with **Replay original attempt**.
    - Reconnecting **sends nothing by itself**. The replay reuses the same key, so the visit is never duplicated.
    - Reloading the page while an attempt is pending brings it back with the same button.
11. **Permission:** a user without the recording permission on the branch → **This action is not allowed** and no form.
    - If the permission is removed while working, the screen re-reads it after the first refusal.
12. **Identity or scope change:** signing out and in as another user, or changing the company, business or branch → the form and any pending
    attempt are cleared.

**Must NOT happen:**
- A visit recorded twice because of a double click, a lost answer or a reconnect.
- Anything sent by itself after reconnecting.
- A line over the limit saved, or a saved line changed after saving.
- A branch picked automatically.
- Another user's or branch's data still shown after an identity or scope change.
- The customer's full phone stored in the browser.

## For an agent

- **Admin:** `http://localhost:3001/orders/service-sessions/new`; sidebar link **Record a visit** / **تسجيل زيارة**.
  - Labels are the catalog texts above (`packages/i18n/src/service-session-catalog.ts`), for example **Recorder membership**,
    **Service line {n}**, **Performer {n}**.
  - The membership limit is the `<bdi>` inside the membership field's `role="status"`.
  - Write feedback is a `role="status"` (saving, saved, partial) or a `role="alert"` (refusals, unresolved).
  - The offline notice is a `role="status"`.
- **API** (session cookie + `x-company-id`; writes need `Idempotency-Key`):
  - `GET /v1/businesses/<B>/branches/<BR>/service-sessions/recording-context` (`record:service-sessions:branch`, feature `orders`)
    returns `{ generated_at, business_timezone, recorder_membership_ids, recorder_membership_id, discount_limit }`.
  - `GET …/service-sessions/service-options` and `GET …/service-sessions/performer-options?occurred_at=…`.
  - `POST /v1/branches/<BR>/customers/find-or-create` (`create:customers:branch`).
  - Create: `POST …/service-sessions`.
  - Append: `POST …/service-sessions/<SESSION_ID>/lines`. The same key replays the stored result.
  - Day list (manager, `read:service-sessions:branch`): `GET …/service-sessions?date=<YYYY-MM-DD>`.
- **Errors:** `SESSION_DISCOUNT_ABOVE_LIMIT` (on the line) · `SESSION_RECORDER_MEMBERSHIP_REQUIRED` · `SESSION_TIME_IN_FUTURE` ·
  `SESSION_TIME_TOO_OLD` · `SESSION_LINE_CAPACITY_EXCEEDED` · `FORBIDDEN` 403 · `FEATURE_DISABLED`.
- **Automated replay:** the Playwright suite in `apps/admin/e2e/service-session*.pw.ts` runs this journey (18 tests, Arabic and English,
  RTL, 390×844) against a running local stack.
  - Commands: `pnpm --filter @pospay/api e2e:seed`, then `ADMIN_E2E_URL=http://localhost:3001 pnpm --filter @pospay/admin e2e`.
  - Stack, env vars and build steps are in the runbook section "Admin service-session browser tests".
  - The browser always signs in through `/login` → password → `/login/two-factor`.
- **Assertions:**
  - one visit per customer and day in the day list;
  - accepted line ids and the original `occurred_at` unchanged after an append;
  - a lost-response replay returns the same session id;
  - `recorded_by_membership_id` and `limit_bps_applied` on the 201 match the chosen membership;
  - `not_clocked_in_warning` and `approved_leave_warning` are persisted on the performers.
- **Open follow-ups:** #213, #214, #216, #217, #219. The SS-Q18/SS-Q19 design inputs are #209–#211.
- **Sources:**
  - `docs/specs/050-orders-record-service-session/plan-35c.md` (rows 35c-12a, 35c-12b; §1, §6);
  - `apps/admin/src/orders/{pages,ui,model}/`;
  - `apps/admin/app/(dashboard)/_frame/service-session-route.tsx`;
  - `packages/i18n/src/{service-session-catalog,service-session-errors}.ts`;
  - `apps/api/src/modules/orders/http/`.
