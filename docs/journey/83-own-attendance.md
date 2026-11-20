# 83 · «حضوري»: an employee reads her own attendance — الموظفة تقرا حضورها

**Status / الحالة:** shipped in #861 (57b-1: the employee's own attendance read), merged (spec 060 part A). **API
only, no screen:** the «حضوري» screen of the staff app is not built. The route is on staging. It answers two kinds of
session: the personal session on her own phone, which needs the WhatsApp OTP (**OFF**,
[22](22-personal-phone-passkey.md)), and the staff session on the reception device, which also needs a live private
view ([82](82-private-view-window.md)).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API; the `staff` feature on.
- هبة (Heba), an employee linked to a user, with attendance sessions this month and last month (card clock,
  [30](30-employee-cards-and-clock-by-card.md)), holding **قراءة حضوري** / **Read my attendance** (the default).
- The business's «months back» setting at its default of 2 ([61](61-staff-app-columns-screen.md)).

## العربي

API بس، لسه مفيش شاشة.

1. **الشهر الحالي:** هبة تطلب حضورها من غير تحديد شهر ← جلسات الشهر الحالي: تاريخ يوم الشغل، اسم الفرع (عربي
   وإنجليزي)، وقت الحضور، وقت الانصراف (أو فاضي لو لسه مفتوحة)، دقايق التأخير، المصدر (`QR` أو `BARCODE` أو
   `MANUAL`)، والحالة (`OPEN` أو `CLOSED` أو `MISSED_OUT`).
2. **شهر فات:** تطلب `month=YYYY-MM` للشهر اللي فات ← جلساته.
3. **أبعد من المسموح:** شهر أقدم من «عدد الشهور لورا» (الافتراضي شهرين بالشهر الحالي)، أو شهر في المستقبل ← **الشهر
   ده برّه الفترة اللي تقدري تشوفيها.**
4. **اتصحّحت:** جلسة مدير صحّح وقتها ([35](35-correct-attendance.md)) ← عليها `corrected: true` بس، من غير مين صحّح
   ولا السبب.
5. **على جهاز الريسبشن:** نفس الطلب بجلسة الجهاز من غير نافذة عرض خاص شغالة ← **وقت العرض خلص. دخّلي الـ PIN تاني.**
   ومع نافذة شغالة ← نفس البيانات.
6. **منع:** هبة عليها **منع** لـ **قراءة حضوري** ← الطلب بيترفض.
7. **موظفة اتوقفت:** موظفة اتمسحت أو عضويتها انتهت بعد ما دخلت ← الطلب بيترفض حتى لو الجلسة لسه عايشة.

**ممنوع يحصل:**
- الطلب يقبل رقم موظفة أو فرع من العميل (الموظفة بتتحدد من الجلسة بس).
- موظفة تشوف حضور موظفة تانية.
- بيانات التصحيح (مين، ليه، الوقت القديم) تظهر.
- الرد يتخزّن في الكاش (`Cache-Control: no-store`).
- جلسة لوحة الإدارة أو جهاز من غير موظفة داخلة يقرا المسار ده.

## English

API only, no screen yet.

1. **The current month:** Heba asks for her attendance with no month → this month's sessions: the working date, the
   branch name (Arabic and English), clock-in, clock-out (empty while still open), late minutes, the source (`QR`,
   `BARCODE` or `MANUAL`) and the status (`OPEN`, `CLOSED` or `MISSED_OUT`).
2. **A past month:** she asks for `month=YYYY-MM` for last month → its sessions.
3. **Further than allowed:** a month older than «months back» (two by default, counting the current one), or a
   future month → **This month is outside the period you can view.**
4. **Corrected:** a session whose time a manager corrected ([35](35-correct-attendance.md)) → it carries only
   `corrected: true`, without who corrected it or why.
5. **On the reception device:** the same request with the device's staff session and no live private view → **The
   private view has expired. Enter your PIN again.** With a live window → the same data.
6. **Denied:** Heba has a **Deny** for **Read my attendance** → the request is refused.
7. **A stopped employee:** an employee deleted, or whose membership ended after she signed in → the request is
   refused even while the session is still alive.

**Must NOT happen:**
- The request accepting an employee id or a branch from the client (the employee comes from the session only).
- One employee reading another's attendance.
- Correction details (who, why, the old time) shown.
- The answer cached (`Cache-Control: no-store`).
- An admin session, or a device with no signed-in operator, reading this route.

## For an agent

- **Screens:** none.
- **API:** `GET /v1/staff/me/attendance?month=<YYYY-MM>` (`apps/api/src/modules/staff/http/own-attendance.controller.ts`,
  `@Authenticated()`). On the reception device add the `x-private-view-window-id` header
  ([82](82-private-view-window.md)).
- **Answer** (`packages/contracts/src/staff/own-attendance.ts`): `{ month, sessions: [{ id, working_date,
  branch_name_ar, branch_name_en, clock_in, clock_out, late_minutes, source, status, open_exceptions, corrected }] }`.
- **Permission:** `read:attendance:own` + the `staff` feature, rechecked with the live employee and membership inside
  the read.
- **Errors:** `MY_PERIOD_OUT_OF_RANGE` · `PRIVATE_VIEW_EXPIRED` 403 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403.
- **Code:** `apps/api/src/modules/staff/queries/own-attendance.query.ts`,
  `apps/api/src/modules/staff/domain/own-attendance-period.ts`.
- **Sources:** `docs/specs/060-ratings-and-staff-app/spec.md` (part A, row 57b-1),
  `docs/specs/060-ratings-and-staff-app/57b-1-validation.md`.
