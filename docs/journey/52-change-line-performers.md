# 52 · Change who performed a saved service — تغيير منفّذين خدمة محفوظة

**Status / الحالة:** row 37b, all merged. The screen shipped in #445 (37b-5: the **تغيير المنفّذين** / **Change performers** dialog, the
«changed» mark and the history panel) and #456 (37b-6, PP-19: the names list opens to the change permission, and the button hides from
anyone without it). Underneath them: bell contracts and template #330, permission and history storage #333, bell consumer #405, change
rules #414, retained identities for the other writers #430 (with the refactor #448), change use case #433, history read #432, `PUT` route and
the day-list mark #437.

Since #533 (2026-10-23) the admin runs on staging at https://app.staging.pospay.systems with demo data only (company «صالون الأميرة
(تجريبي)», branches Salmiya and Hawalli), so this journey can be tried there. The bell is delivered by the worker. Since #503 it also follows
the alert rules: a saved `SERVICE_LINE_PERFORMERS_CHANGED` rule or the business alerts switch can narrow or silence it; with no saved rule it
goes to the four default roles. There are no browser (Playwright) tests for this flow yet; component and API tests only.

The price, discount, net and the visit total never move; only who shares the line's commission does.

**Before you start / قبل ما تبدأ:**
- Everything from [47](47-record-visit-reception.md) and the day list of [49](49-price-discount-edit.md). The `orders` feature is enabled.
- A visit saved today in the branch, customer `999` `00000001`: «قص شعر» / "Haircut" `25.000` by سارة / Sara alone (100%).
- **A manager:** منى / Mona as branch manager, linked to her employee record. The four default roles (owner, general manager, business
  manager, branch manager) hold `change:service-line-performers:branch` (**تغيير منفّذي بند الخدمة** / **Change service line performers** in
  [12](12-permissions-screen.md)) and `read:service-sessions:branch`. Any other role needs an explicit **Allow**.
- For step 10: on منى's membership set `record:service-sessions:branch` to **Deny** ([12](12-permissions-screen.md)).
- The worker running, for the bell (step 7).

## العربي

1. **افتح قائمة اليوم:** بحساب منى، من القائمة الجانبية دوس **قائمة اليوم** ← `/orders/service-sessions`.
   - زرار **تغيير المنفّذين** بيظهر على كل سطر لسه شغال، بس لو معاك صلاحية التغيير على الفرع (PP-19.2). من غيرها الزرار مش ظاهر.
2. **افتح التغيير:** دوس **تغيير المنفّذين** على «قص شعر» ← حوار بنفس العنوان **تغيير المنفّذين**.
   - فوق **المنفّذين دلوقتي**: سارة `100.00%`.
   - تحته **الموظفات** و**البحث عن الموظفات**. الأسماء بتتقرا في وقت الزيارة الأصلي، مش النهارده.
3. **التقسيم:** دوس **إضافة موظفة** واختار هبة ← اختار **نسب مخصصة** واكتب سارة `70` وهبة `30`.
   - **تقسيم بالتساوي تلقائيًا** بيقسم لوحده. سطر محفوظ بنسب مختلفة بيفتح على **نسب مخصصة** بنسبه.
   - من موظفة لـ 4. **حذف الموظفة {n}** بيشيل واحدة. **مجموع كل النسب لازم يكون 100%.**
   - لو الموظفة الجديدة ما سجلتش حضور يظهر **لم تسجل حضورها**، ولو في إجازة **إجازة مقبولة**. ده تحذير ومش بيمنع الحفظ.
   - اللي فاضلة على السطر (سارة) مش بتتفحص تاني، حتى لو سابت الشغل بعد الزيارة (PF-Q5).
4. **السبب:** اكتب في **السبب** «هبة ساعدت في الغسيل». العداد **الحروف {count}/500**.
   - فاضي ← **اكتب سبب تغيير المنفّذين (لحد 500 حرف).**
5. **الحفظ:** دوس **حفظ المنفّذين** ← **جاري الحفظ…** ← الحوار بيتقفل وفوق القائمة **اتغيّر المنفّذين.**
   - **إغلاق** بيقفل الحوار من غير ما يبعت حاجة.
6. **العلامة والسجل:** السطر بيظهر عليه **اتغيّر المنفّذين** وجنبها تاريخ اليوم. السعر والخصم والصافي زي ما هما، وعلامة **اتعدّل** ما بتظهرش.
   - دوس **سجل المنفّذين** ← الأحدث الأول: الوقت، **اللي غيّر** واسم منى أو دورها، **السبب**، **قبل** سارة `100.00%`، **بعد** سارة `70.00%`، هبة `30.00%`.
   - تغييرات كتير ← **سجلات تانية**. السجل محتاج صلاحية قراءة قائمة اليوم.
7. **الجرس:** مديرين الفرع (ومعاهم منى) بيوصلهم إشعار بالقالب
   «تغيّر منفّذو خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: صافي السطر {{line_net}} دينار.»،
   يعني اسم الخدمة والفرع والتاريخ وصافي السطر `25.000`. **مفيش** سبب ولا أسامي منفّذين ولا اسم اللي غيّر.
8. **مفيش تغيير:** افتح تاني واحفظ بنفس الموظفات والنسب ← جوه الحوار **المنفّذين والنسب زي ما هما، مفيش تغيير يتحفظ.**
9. **نفسك:** منى تضيف نفسها على السطر، أو تغيّر سطر هي منفّذاه ← الحوار بيتقفل وفوق القائمة
   **لا يمكنك تنفيذ هذا الإجراء على خدمة قمت بها بنفسك.** المالك نفس الكلام.
   - موظفة اتشالت من سطر بتفضل ممنوعة على السطر ده: ماتقدرش تغيّره ولا تعدّل سعره ولا تلغيه.
10. **صلاحية التغيير بس (PP-19.1):** منى والتسجيل عليها **Deny** ← زرار **تغيير المنفّذين** موجود، وقايمة الأسامي بتشتغل،
    لكن زرار **تسجيل البقشيش** مش ظاهر.
11. **مديرين في نفس الوقت:** تبويبين على نفس السطر، احفظ من الأول وبعدين من التاني ← **اتغيّر السطر من حد تاني. حدّثي الصفحة وحاولي تاني.**
    والقائمة بتتحدّث. لو السطر اتلغى في النص: الحوار بيتقفل وفوق القائمة **السطر ده اتلغى في الوقت ده، فمينفعش المنفّذين يتغيّروا.**
12. **العضوية والنت:**
    - أكتر من عضوية ← **اختاري العضوية اللي بتغيّري بيها المنفّذين.** وقايمة **العضوية**.
    - من غير نت **حفظ المنفّذين** متقفل. رد ضاع ← **النتيجة مش معروفة. نفس الزر هيعيد التغيير ده بأمان.** والفورم بيتقفل على نفس الطلب.
13. **البقشيش:** لو شلت موظفة عليها بقشيش في الزيارة، التغيير بيعدّي والبقشيش بيفضل زي ما هو (TP-Q6).

**ممنوع يحصل:**
- السعر أو الخصم أو الصافي أو إجمالي الزيارة يتغيّروا.
- حد يحط نفسه على سطر، أو يغيّر سطر هو منفّذه أو اتشال منه، حتى المالك.
- أكتر من 4 موظفات، أو نسبة صفر، أو مجموع غير 100%.
- السبب أو أي اسم يظهر في الجرس.
- نفس التغيير يتحفظ مرتين أو الجرس يرن مرتين.

## English

1. **Open the day list:** as Mona, in the sidebar press **Day list** → `/orders/service-sessions`.
   - A **Change performers** button shows on every active line, only if you hold the change permission on the branch (PP-19.2). Without it
     the button is hidden.
2. **Open the change:** press **Change performers** on "Haircut" → a dialog titled **Change the performers**.
   - At the top **Performers now**: Sara `100.00%`.
   - Below it **Performers** and **Search performers**. Names are read at the visit's original time, not today.
3. **The split:** press **Add performer** and choose Heba → choose **Custom shares** and enter Sara `70` and Heba `30`.
   - **Equal split automatically** splits by itself. A saved line with unequal shares opens on **Custom shares** with its shares.
   - One to four performers. **Remove performer {n}** removes one. **All shares must total 100%.**
   - A newly added performer who has not clocked in shows **Not clocked in**; one on leave shows **Approved leave**. Warnings only.
   - The performer who stays (Sara) is not checked again, even if she left after the visit (PF-Q5).
4. **Reason:** type "Heba helped with the wash" in **Reason**. Counter **Characters {count}/500**.
   - Empty → **Enter the reason for the performer change (up to 500 characters).**
5. **Save:** press **Save performers** → **Saving…** → the dialog closes and above the list **The performers were changed.**
   - **Close** closes the dialog and sends nothing.
6. **Mark and history:** the line shows **Performers changed** with today's date. Price, discount and net are unchanged, and no **Edited** mark appears.
   - Press **Performer history** → newest first: the time, **Changed by** with Mona's name or role, **Reason**, **Before** Sara `100.00%`,
     **After** Sara `70.00%`, Heba `30.00%`.
   - Many changes → **More**. The history needs the day-list read permission.
7. **The bell:** the branch managers (Mona included) get a notice from the template
   "The performers of {{service_name_en}} at {{branch_name_en}} dated {{business_date}} were changed: the line net is {{line_net}} KWD.",
   that is the service, branch, date and the line net `25.000`. **No** reason, no performer names and no changer name.
8. **No change:** open again and save the same performers and shares → inside the dialog
   **Performers and shares are unchanged; nothing to save.**
9. **Yourself:** Mona adds herself to the line, or changes a line she performs → the dialog closes and above the list
   **You cannot perform this action on a service you performed yourself.** The owner too.
   - A performer removed from a line stays barred from that line: she cannot change it, edit its price or cancel it.
10. **Change permission only (PP-19.1):** with recording set to **Deny** for Mona → **Change performers** is there and the names list
    works, but **Record tip** is hidden.
11. **Two managers at once:** two tabs on the same line, save in the first, then in the second → **The line was changed by someone else.
    Refresh and try again.** and the list refreshes. If the line was cancelled meanwhile: the dialog closes and above the list
    **This line was cancelled meanwhile, so its performers cannot be changed.**
12. **Membership and connection:**
    - More than one membership → **Select the membership you are changing the performers under.** and a **Membership** list.
    - Offline, **Save performers** is disabled. A lost answer → **The result is unknown. The same button replays this change safely.** and
      the form locks on the same request.
13. **Tips:** removing a performer who has a tip on the visit is allowed, and the tip stays as it is (TP-Q6).

**Must NOT happen:**
- The price, discount, net or visit total changing.
- Anyone putting themselves on a line, or changing a line they perform or were removed from, owner included.
- More than four performers, a zero share, or shares not totalling 100%.
- The reason or any name in the bell.
- The same change saved twice, or the bell ringing twice.

## For an agent

- **Admin:** local `http://localhost:3001/orders/service-sessions`; staging `https://app.staging.pospay.systems/orders/service-sessions`
  (demo company «صالون الأميرة (تجريبي)», branch Salmiya or Hawalli; the owner gives the credentials privately). Make the visit first; do not
  rely on demo visits. Sidebar link **Day list** / **قائمة اليوم**.
  - Labels are in `packages/i18n/src/service-line-performers-catalog.ts` (`serviceLinePerformers.*`); the picker labels in
    `service-session-catalog.ts` (`serviceSessions.*`). The button and the Arabic dialog title are the same text.
  - The reason input is `#performers-reason`; the membership list has `aria-label` **Membership**; the share mode buttons use `aria-pressed`.
  - Dialog refusals are a `role="alert"` inside the dialog; success, 403 refusals and the cancelled-meanwhile message are the `role="status"`
    above the list.
- **API** (session cookie + `x-company-id`; the write needs `Idempotency-Key`; base `/v1/businesses/<B>/branches/<BR>/service-sessions`):
  - `GET …/capabilities` (`read:service-sessions:branch`) → `can_change_performers` (the button), `can_record_sessions` (the tips button),
    `can_cancel_lines`.
  - `GET …/performer-options` and `GET …/recording-context`: `@Authenticated()`, then `record:service-sessions:branch` **or**
    `change:service-line-performers:branch` (each net of its own DENY) and feature `orders`, checked inside the read. `GET …/service-options`
    stays record-only. No selected company → 400.
  - `PUT …/<SESSION_ID>/lines/<LINE_ID>/performers` (`change:service-line-performers:branch`, feature `orders`, admin login only, 200) with
    `{ performers: [{ employee_id, share_bps? }], reason, expected_revision, changer_membership_id? }` → with the branch read
    `{ line, session: { id, total_net } }`, without it `{ changed: true }`.
  - `GET …/<SESSION_ID>/lines/<LINE_ID>/performer-changes?cursor&limit` (`read:service-sessions:branch`; the change permission alone does not
    grant it) → newest first `{ items: [{ revision, changed_at, changer_label_ar, changer_label_en, reason, before, after }], next_cursor }`.
  - Day list `GET …?date=<YYYY-MM-DD>`: `performers_changed_at` (business-timezone date of the latest change), absent if never changed.
- **Errors:** `SESSION_PERFORMERS_NO_CHANGE` · `SESSION_PERFORMERS_REASON_INVALID` · `SESSION_CHANGER_MEMBERSHIP_REQUIRED`
  (`details.changer_membership_ids`) · `SESSION_LINE_PERFORMERS_NOT_CHANGEABLE` (reserved) · `SESSION_PERFORMER_SHARES_INVALID` ·
  `SESSION_PERFORMER_NOT_ELIGIBLE` · `SESSION_LINE_IDENTITY_UNKNOWN` · `SESSION_LINE_NOT_EDITABLE` (cancelled line) · `SESSION_TIME_TOO_OLD` —
  all 422; `SESSION_LINE_REVISION_STALE` 409 · `SESSION_PERFORMER_SELF_FORBIDDEN` 403 · `FORBIDDEN` 403 (same body for any foreign or unknown
  scope) · `IDEMPOTENCY_KEY_REUSED` · `FEATURE_DISABLED`.
- **Assertions:**
  - `price`, `discount`, `net`, `status`, `edited` and `session.total_net` unchanged; `revision` up by one;
  - one history header with BEFORE and AFTER rows; a kept performer keeps her recording-time snapshot and warnings;
  - the event (`ServiceLineChanged`, `change.kind = "PERFORMERS_CHANGE"`), the audit row and the notice carry no reason, phone, customer or
    performer name; one notice row per change (`service_line_performer_notices`);
  - the same key replays the same 200 with no second write and no second bell;
  - a removed performer's linked user is refused `SESSION_PERFORMER_SELF_FORBIDDEN` on the price edit, the cancel, this change and her tip entry.
- **Automated tests:** component tests `apps/admin/src/orders/{pages/service-session-day-performers.spec.tsx,pages/service-session-day-capability.spec.tsx,
  ui/change-line-performers-dialog.spec.tsx}`; API and worker integration tests from #433, #437, #430, #432, #456 and #405. No Playwright suite.
- **Sources:**
  - `docs/specs/055-orders-change-line-performers/{spec.md,owner-questions.ar.md}` (PF-Q1…PF-Q7, D-12, D-13);
  - `apps/admin/src/orders/ui/{service-session-day-line,change-line-performers-*,service-line-performer-history,session-performers-field}.tsx`;
  - `apps/admin/src/orders/pages/service-session-day-page.tsx`;
  - `packages/i18n/src/{service-line-performers-catalog,service-session-catalog,service-session-errors,in-app-catalog}.ts`;
  - `apps/api/src/modules/orders/http/{service-sessions,service-session-form}.controller.ts`;
  - `apps/worker/src/modules/orders/use-cases/request-performers-change-notice/`.
