# 68 · Staff app link and QR — لينك تطبيق الموظفات والـ QR

**Status / الحالة:** shipped in #638 (069-1: the admin screen on `/staff/employee-app-link`, spec 069, M-1g),
merged. The manager gets **one link per business** and its QR code to give to her team; an employee opens it (or
pastes it in the app, [63](63-native-app-shell.md)) to connect the staff app to that business. **Runs on staging**
(`https://app.staging.pospay.systems/staff/employee-app-link`). **Not built yet:** the **طباعة** print sheet of spec
069 FR-004, and the in-app QR scan (M-1h). The link gives no access by itself: the employee still signs in with the
code sent to her own phone, and that OTP is **OFF** on staging ([22](22-personal-phone-passkey.md)).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the admin; or the staging admin with the demo company
  «صالون الأميرة (تجريبي)».
- The `staff` feature on; a user who may add and edit employees of the business (`manage:employees:business`), and a
  second user without it.
- A business chosen in the workspace selector ([02](02-admin-workspace-selector.md)).

## العربي

1. **افتح الشاشة:** من القائمة الجانبية دوس **تطبيق الموظفات**، أو من صفحة الموظفين دوس **لينك تطبيق الموظفات** ←
   عنوان **تطبيق الموظفات** وتحته «ابعتي اللينك ده أو الكود لفريقك. كل موظفة بتدخل بكود بيوصل على موبايلها.»
2. **اللي على الشاشة:** اسم **النشاط** المفتوح دلوقتي، و**لينك التطبيق** بالشكل
   `https://<pos host>/personal?company=…&business=…`، وكود QR محتواه نفس اللينك بالظبط.
3. **نسخ:** دوس **نسخ اللينك** ← **اتنسخ اللينك.** لو المتصفح منع النسخ ← **النسخ ما نفعش. حدّدي اللينك وانسخيه
   بإيدك.**
4. **واتساب:** دوس **ابعتي على واتساب** ← واتساب بيفتح على جهازك والرسالة مكتوبة: «افتحي اللينك ده عشان توصّلي تطبيق
   الموظفات بصالون {اسم الصالون}» وبعدها اللينك. إنتي اللي بتختاري المستلم؛ السيستم ما بيبعتش حاجة.
5. **نشاط تاني:** غيّر النشاط من فوق ← الاسم واللينك والـ QR بيتغيروا للنشاط التاني.
6. **من غير صلاحية:** مستخدم ملوش إضافة وتعديل الموظفين ← المدخل والزرار مش ظاهرين، ولو فتح العنوان مباشرة ← رسالة
   رفض.
7. **البيئة مش متظبطة:** لو عنوان الكاشير مش متظبط في البيئة ← **لينك تطبيق الموظفات مش متظبط في النسخة دي.**

**ممنوع يحصل:**
- لينك مختلف لكل موظفة، أو لينك فيه رقم موبايل أو اسم.
- محتوى الـ QR يختلف عن اللينك المكتوب.
- السيستم يبعت رسالة واتساب بنفسه أو يقرا رقم حد.
- اللينك يدّي دخول من غير كود الموظفة.
- لينك نشاط يظهر وإنت فاتح نشاط تاني.

## English

1. **Open the screen:** in the sidebar click **Staff app**, or on the employees page click **Staff app link** → the
   heading **Staff app** with "Give this link or QR to your team. Each employee signs in with a code sent to her own
   phone."
2. **On the screen:** the name of the **Business** open now, the **App link** in the form
   `https://<pos host>/personal?company=…&business=…`, and a QR code whose content is exactly that link.
3. **Copy:** click **Copy link** → **Link copied.** If the browser blocks copying → **Could not copy. Select the link
   and copy it by hand.**
4. **WhatsApp:** click **Send on WhatsApp** → WhatsApp opens on your own device with the text "Open this link to
   connect the staff app to {name}" followed by the link. You pick the recipient; the system sends nothing.
5. **Another business:** change the business at the top → the name, the link and the QR change to the other business.
6. **No permission:** a user who may not add and edit employees → the sidebar entry and the button are hidden, and
   opening the address directly shows a refusal.
7. **Environment not set up:** if the POS address is not configured for the environment → **The staff app link is
   not set up for this environment.**

**Must NOT happen:**
- A different link per employee, or a link carrying a phone number or a name.
- QR content that differs from the written link.
- The system sending a WhatsApp message itself, or reading anyone's number.
- The link giving access without the employee's own code.
- One business's link shown while another business is open.

## For an agent

- **Screen:** `/staff/employee-app-link` (local `http://localhost:3001`, staging
  `https://app.staging.pospay.systems`); page `apps/admin/src/staff/pages/employee-app-link-page.tsx`, actions
  `apps/admin/src/staff/ui/employee-app-link-actions.tsx`, the employees-page button
  `apps/admin/src/staff/ui/employee-app-link-button.tsx`.
- **Selectors:** sidebar link **تطبيق الموظفات** / **Staff app** (shown only when the read succeeds); buttons **نسخ
  اللينك** / **Copy link** and **ابعتي على واتساب** / **Send on WhatsApp** (a plain `https://wa.me/?text=…` link);
  the QR by its label **كود QR للينك تطبيق الموظفات** / **QR code of the staff app link**. Text in
  `packages/i18n/src/employee-app-link-catalog.ts`.
- **API:** `GET /v1/businesses/<BUSINESS_ID>/staff/employee-app-link` with `x-company-id`; permission
  `manage:employees:business` + the `staff` feature
  (`apps/api/src/modules/staff/http/employee-app-link.controller.ts`). Read only; it writes nothing.
- **Assertions:** the link parses with the `personalWorkspace` schema of `packages/contracts`
  (`apps/pos/src/app/employee-app-link-cross-check.spec.ts`); a refused read shows `errors.FORBIDDEN`.
- **Sources:** `docs/specs/069-mob-employee-link-qr/spec.md` (FR-001 … FR-008, BR-001).
