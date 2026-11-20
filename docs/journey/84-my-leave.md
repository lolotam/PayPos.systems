# 84 · «إجازاتي»: an employee requests leave and follows it — الموظفة تطلب إجازة وتتابعها

**Status / الحالة:** shipped in #881 (57b-2a: the list of branches an employee may request leave in) and #882
(57b-2b: the **إجازاتي** / **My leave** screen in `apps/pos`), both merged (spec 060 row 57b-2, the leave part). It
gives the employee the screen that [23](23-request-leave.md) and [24](24-decide-leave.md) said was missing: she
requests leave, sees every request with its status and reason, and cancels a pending one. **On staging:** it works on
the paired reception device after the PIN sign-in ([08](08-staff-login-pos.md)), with no second PIN. On her own
phone it needs the personal session (OTP **OFF**, [22](22-personal-phone-passkey.md)). No notification is sent to
anyone, and there is no leave balance.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the POS; or the staging POS on a paired device of Salmiya.
- هبة (Heba), an employee linked to a user and attached to Salmiya, with **طلب إجازة ذاتية** / **Request own leave**,
  **عرض إجازاتي** / **Read own leave** and **إلغاء إجازتي المعلقة** / **Cancel own pending leave**.
- سارة (Sara), a manager who decides leave on the admin `/leave` screen ([24](24-decide-leave.md)).

## العربي

1. **افتح الشاشة:** هبة تدخل بالـ PIN على جهاز الريسبشن ← قسم **إجازاتي**. على الجهاز الفرع هو فرع الجهاز، من غير
   PIN تاني.
2. **على موبايلها:** في الجلسة الشخصية بتظهر **اختاري الفرع** (الفروع اللي ليها فيها ارتباط شغال). لو مفيش ← **لا
   توجد فروع متاحة**.
3. **أيام كاملة:** في **الوحدة** تختار **أيام كاملة**، وتحدد **من تاريخ** و**حتى تاريخ**، و**نوع الإجازة** (**سنوية**،
   **مرضية**، **بدون أجر**، **أخرى**)، وتدوس **إرسال الطلب** ← الطلب بيظهر في السجل بحالة **معلقة**، وفوق **آخر
   طلب**.
4. **جزء من يوم:** تختار **جزء من يوم**، و**التاريخ** و**وقت البداية** و**وقت النهاية** ← نفس النتيجة. مكتوب
   **الأوقات حسب المنطقة الزمنية للفرع المختار**.
5. **إدخال غلط:** أكتر من 90 يوم، أو وقت نهاية قبل البداية، أو أوقات مش على ربع ساعة، أو **أخرى** من غير ملاحظة ←
   **راجعي التواريخ والأوقات…** ومفيش حاجة بتتبعت.
6. **السجل:** كل الطلبات بحالاتها الأربعة: **معلقة**، **معتمدة**، **مرفوضة**، **ملغاة**، ومعاها التواريخ والأوقات.
   الأحدث فوق، و**الصفحة التالية** بتجيب الأقدم. لو مفيش ← **لا توجد طلبات إجازة**.
7. **القرار:** سارة تعتمد أو ترفض من لوحة الإدارة ← الشاشة عند هبة بتتحدّث لوحدها، ومع الرفض **سبب القرار**. لو
   الموافقة اتسحبت قبل ما الإجازة تبدأ ← **سبب سحب الموافقة**.
8. **إلغاء:** على طلب **معلقة** تدوس **إلغاء الطلب** ← الحالة تبقى **ملغاة**. الزرار بيظهر للطلب المعلق بس.
9. **من غير نت:** ← **محتاج إنترنت. بيانات الإجازات لا تُحفظ بدون اتصال.** والنموذج والسجل بيتمسحوا من الشاشة.
10. **فشل مؤقت:** ← **تعذر عرض الإجازات أو حفظها. حاولي مرة أخرى.** وزرار **حاولي مرة أخرى**؛ إعادة المحاولة ما
    بتعملش طلب تاني.
11. **موظفة تانية دخلت:** هبة خرجت وموظفة تانية دخلت على نفس الجهاز ← السجل والنموذج بتوع هبة بيتمسحوا فورًا.

**ممنوع يحصل:**
- موظفة تشوف أو تلغي إجازة موظفة تانية.
- طلب مكرر بسبب إعادة المحاولة.
- إلغاء طلب معتمد أو مرفوض من الشاشة دي.
- بيانات الإجازات تتخزّن على الجهاز أو تفضل ظاهرة بعد الخروج أو من غير نت.
- الطلب يقبل رقم موظفة من العميل (الموظفة من الجلسة بس).

## English

1. **Open the screen:** Heba signs in with her PIN on the reception device → the **My leave** section. On the device
   the branch is the device's branch, and no second PIN is asked.
2. **On her own phone:** the personal session shows **Choose a branch** (the branches she has a live attachment to).
   With none → **No eligible branches**.
3. **Full days:** under **Unit** she picks **Full days**, sets **From date** and **Through date**, a **Leave type**
   (**Annual**, **Sick**, **Unpaid**, **Other**) and clicks **Submit request** → the request appears in the history
   as **Pending**, and at the top as **Latest request**.
4. **Part of a day:** she picks **Part of a day**, a **Date**, a **Start time** and an **End time** → the same
   result. The screen says **Times use the selected branch timezone**.
5. **Bad input:** more than 90 days, an end before the start, times off the 15-minute steps, or **Other** with no
   note → **Check the dates and times. …** and nothing is sent.
6. **History:** every request in its four statuses, **Pending**, **Approved**, **Rejected**, **Cancelled**, with its
   dates and times, newest first. **Next page** loads older ones. With none → **No leave requests**.
7. **The decision:** Sara approves or rejects in the admin → Heba's screen updates by itself, with the **Decision
   reason** on a rejection. If the approval is revoked before the leave starts → the **Revocation reason**.
8. **Cancel:** on a **Pending** request she clicks **Cancel request** → it becomes **Cancelled**. The button shows
   only on a pending request.
9. **Offline:** → **Internet required. Leave data is not kept offline.**, and the form and the history are cleared
   from the screen.
10. **A passing failure:** → **Unable to load or save leave. Try again.** with **Retry**; retrying never creates a
    second request.
11. **Another operator signs in:** Heba signs out and another employee signs in on the same device → Heba's history
    and form are cleared at once.

**Must NOT happen:**
- An employee seeing or cancelling another employee's leave.
- A duplicate request because of a retry.
- An approved or rejected request cancelled from this screen.
- Leave data stored on the device, or still shown after sign-out or while offline.
- The request accepting an employee id from the client (the employee comes from the session only).

## For an agent

- **Screen:** the POS (`https://pos.staging.pospay.systems`, local `http://localhost:5173`); code in
  `apps/pos/src/my-leave/` (`ui/my-leave-screen.tsx`, `leave-form.tsx`, `leave-history.tsx`,
  `leave-branch-selector.tsx`), entered from `apps/pos/src/app/own-leave-entry.tsx` (reception device) and
  `personal-leave.tsx` (personal session). Text in `packages/i18n/src/my-leave-catalog.ts` and `leave-catalog.ts`.
- **API** (`apps/api/src/modules/staff/http/`, `@Authenticated()`, declared `PERSONAL`):
  `GET|POST /v1/staff/me/leave-requests` · `POST /v1/staff/me/leave-requests/<LEAVE_ID>/cancel` (with
  `expected_revision`) in `own-leave.controller.ts`; `GET /v1/staff/me/branches` in
  `personal-branches.controller.ts` (personal session only). Writes send an `Idempotency-Key`.
- **Rules:** full days at most 90 inclusive days; a partial day uses increasing times on 15-minute steps; `OTHER`
  needs a note of at most 500 characters; a row is cancellable only when the API marks it `can_cancel`.
- **Assertions:** the history is newest first by request id, with a bare-id cursor (spec 060 MY-16b, issue
  #885); the history has no months-back limit; the history is cleared on an identity change
  (`apps/pos/src/my-leave/ui/my-leave-screen.spec.tsx`).
- **Sources:** `docs/specs/060-ratings-and-staff-app/plan-57b-2.md`,
  `docs/specs/060-ratings-and-staff-app/57b-2a-validation.md`, `57b-2b-validation.md`, journeys
  [23](23-request-leave.md) and [24](24-decide-leave.md).
