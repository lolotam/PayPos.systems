# 48 · Clear an expired recording with your own visits of that day — حسم تسجيل منتهي من زياراتك في اليوم ده

**Status / الحالة:** the panel and the two confirm buttons shipped in #233 (row 35c-13, merged). Underneath: the recovery proof
written before every save in #230 (35c-13a-1), the recovery read and confirm endpoints in #231 (35c-13a-2), and one error mapping for
them in #234 (no visible change). All merged. Since #533 (2026-10-23) the admin runs on staging with demo data only, so the panel can
be reached there, but only after a save stays unresolved **25 hours in the same open tab** (see below). No browser test covers it yet.

This finishes [47](47-record-visit-reception.md): a save whose answer never came back used to stay stuck. Your decisions apply: SS-Q18 (the
recorder confirms it herself, no manager), SS-Q19 (she sees only her own visits of that day, inside the recording screen) and SS-Q20 (the
screen states the outcome and pre-selects the matching button; Waleed's pick, Abu Salem has not answered yet).

**Before you start / قبل ما تبدأ:**
- Everything in [47](47-record-visit-reception.md) «Before you start»: branch selected, services «قص شعر» / "Haircut" `25.000` and
  «تنظيف بشرة» / "Facial" `7.125`, employees سارة / Sara and هبة / Heba, a recorder with `record:service-sessions:branch`, customer
  calling code `999` number `00000001`.
- **An unresolved save:** on **تسجيل زيارة** / **Record a visit** press **حفظ الزيارة** / **Save visit** and lose the answer, so the screen
  shows **إعادة نفس المحاولة** / **Replay original attempt**. Do **not** press it.
  - If the request reached the server, the panel later shows the server's outcome (step 3); if it never left, you get the "no
    record" state (step 4).
  - By hand: switch the network off right after pressing save. An agent can let the request through and drop the response.
- **Wait 25 hours from the last send, with the same tab open.** The attempt lives in the tab's `sessionStorage`: reloading keeps it,
  closing the tab loses it.
- On a freshly migrated local database, attempts made in the first 48 hours after migration `0135` show **no outcome and no
  pre-selection** (#226). The list still shows. The same may apply on staging if its database took `0135` recently.

## العربي

1. **الرسالة:** افتحي **تسجيل زيارة** في نفس التبويب بعد الـ 25 ساعة.
   - بيظهر **التسجيل غير محسوم. راجعي زياراتك في اليوم ده، وبعدين أكدي اتسجلت ولا لأ.**
   - وتحته **محاولة الحفظ كانت الساعة …** بتوقيت النشاط.
2. **القايمة:** بتظهر الزيارات اللي **إنتِ** سجلتيها في **الفرع ده** في **يوم المحاولة**:
   - اسم الزبونة، الرقم مخفي (`***001`)، الوقت، والخدمات اللي إنتِ سجلتيها بس (خدمات حد تاني على نفس الزيارة ما بتظهرش).
   - لو أكتر من 50 زيارة بيظهر **زيارات تانية**، والزيارات اللي اتحملت بتفضل.
3. **النتيجة من الخادم:**
   - لو اتحفظت: **الزيارة دي اتسجلت.** وزرار **اتأكدت — اتسجلت** متعلّم.
   - لو ما اتحفظتش: **الخادم ما شافش إن المحاولة دي اتسجلت. دوري على الزبونة دي في القايمة قبل ما تأكدي.** وزرار **اتأكدت — متسجلتش** متعلّم.
   - في الحالتين **راجعي زياراتك في اليوم ده قبل ما تأكدي.** التعليم اقتراح بس؛ مفيش حاجة بتتأكد غير لما تدوسي إنتِ.
4. **حالات تانية** (مفيش زرار متعلّم، والزرارين شغالين دايمًا):
   - مفيش نتيجة ومفيش زيارات: **مفيش زيارات محفوظة ليكي في الفرع ده في اليوم ده.**
   - الطلب ما وصلش أو الخادم مالوش أثر: **الخادم ماعندوش أثر للمحاولة دي. مش نقدر نراجعها؛ اطلبي من المدير.**
   - صلاحية التسجيل اتشالت: **مش نقدر نراجعها؛ اطلبي من المدير.**
   - الفحص اتقفل (عدّى 72 ساعة من آخر إرسال، أو اتأكد قبل كده): **مدة الفحص خلصت. اطلبي من المدير.**
   - الفحص لسه ما فتحش (أقل من 24 ساعة على الخادم): **الفحص هيفتح الساعة …**
5. **اتأكدت — اتسجلت:** العلامة بتتمسح فورًا، والمسودات بتتشال، والشاشة بترجع فاضية.
   - لو المحاولة كانت إضافة خدمات على زيارة محفوظة، بترجعي للزيارة دي.
6. **اتأكدت — متسجلتش:** العلامة بتتمسح، واللي لسه مكتوب في التبويب بيفضل، و**الحفظ الجاي بمفتاح جديد**.
   - بعد reload الفورم بيبقى فاضي، وتكتبي الخدمات من الأول.
7. **قفل الفحص:** أي زرار بيبعت طلب واحد يقفل الفحص على الخادم (4 ثواني، من غير إعادة).
   - لو الطلب فشل، مفيش حاجة بتقف: العلامة اتمسحت خلاص، والفحص بيتقفل لوحده بعد 72 ساعة من آخر إرسال (مش أكتر من 168 ساعة).
8. **الخروج أو تغيير الشركة أو النشاط أو الفرع** بيمسح العلامة والقايمة.
9. **لو الخادم مش قادر يسجل أثر المحاولة قبل الحفظ:** الحفظ ما بيبدأش خالص، والشاشة بتعتبره غير محسوم:
   **التسجيل لسه غير محسوم. أعيدي نفس المحاولة قبل التعديل أو بدء زيارة جديدة.** و**إعادة نفس المحاولة**.

**ممنوع يحصل:**
- القايمة تعرض زيارات موظفة تانية، أو خدمات سجلها حد تاني، أو فرع أو يوم تاني.
- الزرار المتعلّم يأكد لوحده، أو زرار من الاتنين يتقفل.
- بعد **اتأكدت — متسجلتش** الحفظ يبعت المفتاح القديم.
- فشل طلب القفل يمنع التأكيد.
- قايمة ترجع بعد ما الفحص اتقفل.
- زيارة تتحفظ من غير ما الخادم يسجل أثر المحاولة الأول.
- المفتاح يظهر في رابط أو في اللوج.

## English

1. **The message:** open **Record a visit** in the same tab after the 25 hours.
   - It shows **Recording is unresolved. Check your own visits for that day, then confirm whether it was saved.**
   - Under it **Save attempted at …** in the business time zone.
2. **The list:** the visits **you** recorded in **this branch** on **the attempt's day**:
   - customer name, masked phone (`***001`), time, and only the services you recorded (someone else's lines on the same visit are hidden).
   - Over 50 visits, **More visits** loads the next page; loaded visits stay.
3. **The server's outcome:**
   - Saved: **This visit was saved.** with **Confirmed — it was saved** pre-selected.
   - Not saved: **The server did not see this attempt saved. Find this customer in the list before confirming.** with **Confirmed — it was not saved** pre-selected.
   - Both with **Check your visits for that day before you confirm.** The pre-selection is a hint; nothing is confirmed until you press.
4. **Other states** (nothing pre-selected, both buttons always enabled):
   - No outcome and no visits: **No saved visits in this branch on that day.**
   - The request never arrived, or the server has no trace: **The server has no record of this attempt. We cannot check it; ask the manager.**
   - Recording permission removed: **We cannot check it; ask the manager.**
   - The check closed (72 h after the last send, or already confirmed): **The check window has ended. Ask the manager.**
   - Not open yet (under 24 h on the server): **The check opens at …**
5. **Confirmed — it was saved:** the marker clears at once, the drafts are dropped and the screen is empty again.
   - If the attempt was adding services to a saved visit, you return to that visit.
6. **Confirmed — it was not saved:** the marker clears, whatever is still typed in this tab stays, and **the next save uses a new key**.
   - After a reload the form is empty and you enter the services again.
7. **Closing the check:** either button sends one request that closes the check on the server (4 seconds, no retry).
   - If it fails, nothing is blocked: the marker is already gone, and the check closes by itself 72 h after the last send (never later than 168 h).
8. **Signing out, or changing the company, business or branch** clears the marker and the list.
9. **If the server cannot record the attempt's trace before saving:** the save never starts and the screen treats it as unresolved:
   **Recording is unresolved. Replay the original attempt before editing or starting a new visit.** with **Replay original attempt**.

**Must NOT happen:**
- The list shows another employee's visits, lines someone else recorded, or another branch or day.
- The pre-selected button confirms by itself, or either button is disabled.
- After **Confirmed — it was not saved**, the next save sends the old key.
- A failed close request blocks the confirmation.
- A list returned after the check is closed.
- A visit saved before the server recorded the attempt's trace.
- The key shown in a URL or written to a log.

## For an agent

- **Admin:** local `http://localhost:3001/orders/service-sessions/new`, staging `https://app.staging.pospay.systems/orders/service-sessions/new`
  (demo company «صالون الأميرة (تجريبي)», branch Salmiya or Hawalli; the owner gives the credentials privately).
  - The expired message is a `role="alert"`; the panel's lead text and any later-page notice are `role="status"`.
  - Buttons by visible text: **اتأكدت — اتسجلت** / **Confirmed — it was saved**, **اتأكدت — متسجلتش** / **Confirmed — it was not saved**,
    **زيارات تانية** / **More visits**. The pre-selected one has `aria-pressed="true"`.
  - Faking the browser clock 25 h ahead reaches EXPIRED, but the server still answers NOT_YET until 24 h after it last saw the key.
- **API** (session cookie + `x-company-id`; the key only in the `x-recovery-key` header, never in the URL):
  - `GET /v1/businesses/<B>/branches/<BR>/service-sessions/recovery?operation=record-service-session|append-service-session-lines[&cursor=…]`
    (`record:service-sessions:branch`, feature `orders`) → `{ attempt: { business_date, business_timezone, outcome? }, items, next_cursor }`,
    `Cache-Control: no-store`.
  - `POST …/service-sessions/recovery/confirm` with `{ operation, outcome: "RECORDED_ELSEWHERE" | "NOT_RECORDED" }` → 204, also for an
    unknown or expired key; the first confirm wins.
- **Errors:** `SESSION_RECOVERY_NOT_FOUND` 404 (unknown key, another recorder, branch or tenant: one code) · `SESSION_RECOVERY_NOT_YET` 409
  (`opens_at`) · `SESSION_RECOVERY_CLOSED` 409 (`EXPIRED` | `REVOKED`) · `FORBIDDEN` 403 · on save `SESSION_RECOVERY_UNAVAILABLE` 503 ·
  on an append whose key belongs to another visit `IDEMPOTENCY_KEY_REUSED` 422.
- **Assertions:**
  - one row in `service_session_recoveries` per user, place, operation and key hash; `key_hash` is sha256, the key itself is never stored;
  - a 503 on save leaves no proof row and no visit;
  - after a confirm that reached the server, `revoked_at` and `revoked_outcome` are set, one `audit_log` row is written, and the read answers `CLOSED`;
  - after **Confirmed — it was not saved** the next POST carries a new `Idempotency-Key`;
  - the read never returns lines whose `recorded_by` is another user.
- **Sources:**
  - `docs/specs/050-orders-record-service-session/plan-35c.md` (rows 35c-13a-1, 35c-13a-2, 35c-13); `docs/adr/0042-service-session-recovery-proof.md`;
  - `apps/admin/src/orders/{ui/session-own-recordings.tsx,ui/session-write-feedback.tsx,model/session-recovery-state.ts,model/session-attempt-journal.ts,api/use-own-recordings.ts}`;
  - `apps/api/src/modules/orders/http/session-recovery.controller.ts`, `queries/session-recovery.query.ts`, `persistence/session-recovery-proof.ts`;
  - `packages/i18n/src/{service-session-catalog,service-session-errors}.ts`, `packages/i18n/src/{ar,en}.ts` (`SESSION_RECOVERY_UNAVAILABLE`).
