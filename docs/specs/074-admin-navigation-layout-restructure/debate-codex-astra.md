# 074 — Debate round with Codex

One round, 2026-11-21. Reviewer: Codex CLI, model `gpt-6.2-astra`, reasoning effort medium, read-only. The reply is kept as written (Arabic). Every finding was applied to the files in this folder the same day; finding 3 also became a release condition (NAV-Q14).

VERDICT: agree with changes

FINDINGS:

1. **P1 — `contracts/me-preferences.md:7–40`، صلاحية صاحب الحساب.** استخدام `@Authenticated()` صحيح. رفض `STAFF_POS` و`STAFF_PERSONAL` موجود فعلًا قبل الـcontroller (`packages/auth/src/config.ts:139`، `packages/auth/src/staff-sessions.ts:240`). لكن توكن `Device` الصالح له مسار مستقل، و`me` بيرفضه صراحةً لأن `principal.userId` فارغ (`apps/api/src/shared/session.guard.ts:137`، `apps/api/src/modules/identity/http/me.controller.ts:32–34`). اشترط `userId` في العمليتين، وقيّد الكتابة به داخل العملية، وسجّل PUT في `AUTHENTICATED_WRITES` طبقًا لـ`apps/api/src/modules/identity/http/route-coverage.ts:118`. اختبر رفض الجهاز بـ403 ورفض جلستي الموظف بـ401.

2. **P1 — `pr-sequence.md:28`، صفحة Authenticator.** الخطوة 7 تشترط ظهور العنصر الحالي على `/security/two-factor`، لكن الصفحة خارج `(dashboard)` وبتعرض `EnrolGate` وحده. الـshell يلتف فقط حول أبناء dashboard (`apps/admin/app/security/two-factor/page.tsx:1`، `apps/admin/app/(dashboard)/layout.tsx:9–13`). ضمّ الصفحة للـshell في نفس الخطوة مع حفظ الرابط وبوابة التسجيل، واختبر الصفحة المرسومة.

3. **P1 — `app-map.md:191`، ظهور Soon للجميع.** `NAV-Q14` ما زال `PENDING` (`owner-questions.ar.md:117–123`)، ومع ذلك `data-model.md:32` يحسمه. الـPRD يفرّق بين صلاحيات المالك والمدير، وبين مطعم مفعّل له المطبخ وصالون مفعّل له الحجز (`docs/PRD.md:121,265–274`). اسم الصفحة وحده لا يمنح صلاحية، لكن قرار إظهار كل الأسماء لم يُحسم. اجعل الإجابة شرطًا لاعتماد الخطوة 7، وطبّق القرار نفسه على القوائم والبحث والروابط المباشرة.

4. **P1 — `contracts/me-preferences.md:50–54`، أول عرض بعد تبديل الحساب.** الكتابة عند وجود قيمة فقط تترك كوكي المستخدم السابق لو انتهت جلسته دون خروج والحساب التالي قيمته `null`. الدخول العادي وTOTP ينتقلان للوحة من مسارين (`apps/admin/src/session/api/use-sign-in.ts:27`، `use-verify-totp.ts:24`). وحّد تهيئة الكوكي قبل الانتقال، وامسحه عند `null` وعند الخروج الناجح. استخدم `await cookies()` لكل طلب و`no-store` لقراءة الحساب، مثل `apps/admin/src/session/api/server-session.ts:18,31`. اختبر تبديل الحساب بعد انتهاء الجلسة.

5. **P2 — `app-map.md:95–100,160–164`، حالة المسارات.** الـ67 صف Soon موجودين، ولم أجد بينهم مسارًا قائمًا. لكن Schedule settings جزء من `/schedules`، وEmployee detail بطاقة داخل `/staff`؛ المسار الموجود هو تبويب الإجازة فقط (`design.md:107,130`، `apps/admin/app/(dashboard)/staff/[employeeId]/leave/page.tsx:1`). الخطوة 7 تسبق إنشاء الوجهتين في `pr-sequence.md:31–32`. ميّز الشاشة المضمّنة عن المسار، واربط بالموقع الحالي لحين الفصل.

6. **P2 — `app-map.md:68–89,130–156`، تغطية المنتج.** الخريطة تُسقط استثناءات الخدمات غير المسندة، وساعات العمل وقواعد الطلب، وتخلط موقع العميل مع محرّر المنيو الإداري. الـPRD يسمّيها صراحةً (`docs/PRD.md:646,745,847`). أضف الوجهات تحت أقسامها، ومثّل Grocery وGym/Education أو سجّل نطاقهما المعلّق (`docs/PRD.md:926,929`). ميّز أيضًا wallet stamp cards المخططة لتطبيق العميل في P6 عن وحدة Loyalty في P4 (`docs/PRD.md:837,932`).

7. **P2 — `research.md:13–15`، حدود `_frame`.** تجميع exports داخل `app/` مسموح؛ نقل قواعد الرؤية والتصنيف إليه يتجاوز دور التركيب (`CLAUDE.architecture.md:381,529,537–539`). خلّي كل منطقة تملك بياناتها وشروطها، و`_frame` يجمعها فقط.

8. **P2 — `research.md:19–22`، ملكية `user`.** مسار `packages/auth` يطابق ADR-0003:38. لا دليل على أن عمودًا nullable زائدًا يكسر الـadapter؛ فيه سابقة `phoneBindingApprovedAt` خارج حقول المستخدم المعلنة (`packages/db/schema/identity-auth.ts:39`، `packages/auth/src/config.ts:241–244`). احتفظ باختيار NAV-Q10، واستخدم قراءة وكتابة محدودتين بالعمود وهوية الجلسة، واختبر التسجيل والدخول بعد الترحيل. جدول تفضيلات منفصل بسياسة صف لكل مستخدم يعزل بيانات العرض لو المالك راجع قراره.

9. **P2 — `pr-sequence.md:21–23,28,33,54`، شروط الدمج.** `plan.md:51` يضع تعديلي ADR في الخطوة 0، والتسلسل يؤجل ADR-0003 إلى 12. الخطوة 7 تضيف `/soon/[page]` بينما قائمة المسارات الملزمة في `design.md:127–131` تسقطه. واختبار C يتوقع أربعة workspaces (`spec.md:25`، `quickstart.md:35`) والخريطة تحدد خمسة (`app-map.md:179`). وحّد الخطوة والمسارات والعدد قبل التنفيذ، وأدخل مفاتيح الترجمة مع أول نموذج يعتمد عليها.

NOT CHECKED: المراجعة ساكنة على `cf70114e2`. لم أشغّل migration أو اختبارات Better Auth أو SSR/cache في متصفح، ولم أتحقق من ملاءمة القوائم الكاملة على عرض 390px.
