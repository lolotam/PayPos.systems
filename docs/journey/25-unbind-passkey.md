# 25 · Unbind a passkey — فك ربط مفتاح المرور

**Status / الحالة:** shipped in #97 (PR 21, merged) with its follow-up #100, which makes the unbind use one decision
instant for all its authorization checks. Local only (admin not deployed, issue #54). A manager reviews the passkey
status and history on the admin **Employees** page and unbinds with a reason; the employee then registers again
([22](22-personal-phone-passkey.md), whose personal session works only in tests/local seams while OTP sending is OFF).
The **shared-device signal** is built (table, privacy-limited hashing, the pure ten-minute rule and PR 27's read query) but
**nothing records it yet**: recording starts in follow-up PR 22b, so the table stays empty and no flag can fire today; the
manager-facing flag appears on the attendance board in PR 27. Unbinding does not delete the credential in the global
auth store: it stays inert and cannot clock in.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` and `pnpm db:seed` for the passkey permission catalog and
  defaults. The company's `staff` feature must be enabled.
- Signed in to the admin with a business selected ([01](01-admin-sign-in-and-totp.md),
  [02](02-admin-workspace-selector.md)). By default **Owner**, **General Manager**, **Business Manager** (own business) and
  **Branch Manager** (own branch) hold **Read employee passkey bindings** and **Unbind employee passkeys**; no other system
  role and no Device do ([20](20-role-default-permissions.md)). Unbinding needs the read permission as well.
- A synthetic employee linked to a synthetic user who has already enrolled a passkey ([22](22-personal-phone-passkey.md)),
  attached to one branch; a second employee attached to two branches; a manager who covers only one of those two
  branches; and a manager who is also an employee with their own enrolled passkey (for the self-unbind check).
  Use a controlled clock for expiry checks. Never use real people or phones.

## العربي

1. من القائمة الجانبية دوس **الموظفون** ← `/staff`. لو عندك صلاحية قراءة مفاتيح المرور بتلاقي كارت **مفاتيح مرور
   الموظفين** ومعاه **راجع الربط قبل مساعدة الموظف على تغيير وسيلة الدخول.** وقائمة بالموظفين اللي في نطاقك، لكل واحد
   زرار **عرض مفتاح المرور**. الكارت ده مستقل عن **تعديل** الموظف: مدير فرع عنده الصلاحية دي من غير ما يكون عنده
   صلاحية تعديل الموظفين. من غير الصلاحية الكارت مش بيظهر خالص. للقوائم الطويلة **الصفحة التالية** و**الصفحة الأولى**.
2. دوس **عرض مفتاح المرور** على موظف مربوط ← قسم **مفتاح مرور الموظف**: **مربوط منذ** وتاريخ الربط (بتوقيت الفرع)، وتحته
   **تاريخ الربط** بكل سجل (**مربوط منذ** … وبجانبه **تم فك الربط في** لو اتفك). لموظف ما سجّلش: **غير مربوط**. لو
   الصلاحية ناقصة على الموظف ده أو مش في نطاقك ← **مفتاح مرور هذا الموظف غير متاح لك.** ولو ميزة الموظفين مقفولة للشركة ←
   **خصائص الموظفين غير مفعّلة لشركتك.** القسم ما بيعرضش أي مفتاح أو معرّف اعتماد، بس التواريخ.
3. **الفك:** تحت التاريخ، لو الموظف مربوط وعندك صلاحية الفك: تحذير **سيحتاج الموظف إلى تسجيل مفتاح مرور جديد قبل تسجيل
   الحضور به.** وحقل **سبب فك الربط** وزرار **فك ربط مفتاح المرور**. اكتب سبب تجريبي (1–500 حرف) ← **فك ربط مفتاح
   المرور** ← **تم فك الربط. يمكن للموظف التسجيل من جديد.** الحالة تبقى **غير مربوط**، والسجل القديم يفضل ظاهر
   بتاريخ الفك. من غير سبب (أو مسافات بس) ← **اكتب سبباً من حرف واحد إلى ٥٠٠ حرف.** وما يحصلش فك.
4. **الأمر مربوط بنسخة الربط:** الزرار بيبعت رقم الربط ونسخته اللي ظهرت لك. لو الموظف سجّل من جديد أو غيرك فك الربط
   قبلك ← **تغير ربط مفتاح المرور. حدّث الحالة قبل المحاولة من جديد.** (`PASSKEY_REVISION_CONFLICT`، 409)، وما بيأثرش
   على الربط الجديد أبدًا. افتح تبويبين لنفس الموظف وافكّ من واحد ثم التاني.
5. **صلاحية على كل فروع الموظف:** الربط واحد للموظف عبر فروعه، فلازم تكون صلاحيتك مغطية الفرع الأساسي وكل ارتباط حالي
   مفتوح. موظف في فرعين ومدير بيغطي فرع واحد بس ← الفك مرفوض، حتى لو الفرع التاني مجرد ارتباط
   مستقبلي أو نهايته في المستقبل؛ الاحتساب بتاريخ فرع الارتباط بنفس لحظة القرار الواحدة. مدير النشاط يغطي النشاط كله؛
   مدير الفرع فرعه بس. موظف مجهول أو من شركة تانية أو محذوف أو خارج نطاقك، بجسم صحيح أو غير صحيح ← نفس **المسار غير
   موجود** (`NOT_FOUND`، 404).
6. **ما تفكش مفتاحك أنت:** مدير هو نفسه الموظف (أو هو اللي سجّل الربط الحالي، حتى لو اتربط بموظف تاني بعدها) بيحاول فك
   الربط ← **لا يمكنك فك ربط مفتاح مرورك بنفسك. اطلب من مدير آخر لديه الصلاحية.** (`PASSKEY_SELF_UNBIND`، 403). يُفحص
   بعد التأكد من النطاق. مدير تاني ينجح.
7. **التسجيل من جديد:** بعد الفك الموظف يفتح رابطه الشخصي على موبايله ([22](22-personal-phone-passkey.md)) ←
   **سجل مفتاح المرور من هذا الهاتف.** ← **تسجيل مفتاح مرور** ← **تم تسجيل مفتاح المرور. لتغييره اطلب من المدير فك الربط
   أولاً.** ده ربط جديد بنسخة أعلى، من غير موافقة تانية. عاود افتح **عرض مفتاح المرور**: **مربوط منذ** بتاريخ الجديد،
   و**تاريخ الربط** فيه السجلين. أي إثبات أو أمر عملية خاص بالربط القديم يترفض حتى بعد إعادة التسجيل.
8. **تحت الغطا:** كل فك ناجح يكتب سجل تدقيق `passkey.unbind` فيه مين فك والسبب، وحدث `EmployeePasskeyUnbound` (من غير
   السبب ولا أي مفتاح) في نفس المعاملة؛ فشل أو تراجع ما يسيبش تدقيق ولا حدث. المفتاح العام نفسه في مخزن الدخول
   العام بيفضل خامل ما يتحذفش، وما يظهرش لأي حد. فك وتسجيل متزامنين بيتسلسلوا من غير تعليق، والفاشل مفيش أثره.
9. **إشارة الجهاز المشترك (لسه ما اتفعلتش):** الفكرة إن لو موظفين مختلفين سجّلوا حضور من نفس تثبيت التطبيق خلال 10 دقايق
   (شاملة الحد) تتعلّم للمدير كتنبيه بس، مش منع. التسجيل نفسه بيبدأ في PR 22b، فالجدول فاضي والتنبيه مش هيظهر النهارده؛
   عرضه على لوحة الحضور PR 27. اللي بيتخزن بصمة تجزئة مفصولة بالشركة فقط، مش معرّف خام ولا بصمة متصفح. والإشارة ممكن
   تغلط (مسح التخزين، مفاتيح متزامنة، نسخ المعرّف)، وما بتثبتش جهاز فعلي.

**ممنوع يحصل:**
- فك ربط من غير سبب، أو مدير يفك مفتاح نفسه، أو مدير بصلاحية على فرع واحد يفك ربط موظف مرتبط بفرع خارج صلاحيته.
- أمر فك قديم يؤثر على ربط جديد، أو إثبات قديم يُقبل بعد الفك أو إعادة التسجيل.
- رد يفرّق بين موظف خارج النطاق وموظف مجهول، أو يعرض مفاتيح أو معرّفات اعتماد أو بيانات بيومترية.
- دور آخر غير الأربعة أو Device أو جلسة شخصية أو كشك يقرأ أو يفك الربط.
- حذف المفتاح من مخزن الدخول، أو فك الربط يمسح السجل التاريخي.
- ادعاء إن إشارة الجهاز المشترك شغالة دلوقتي، أو إنها بتمنع تسجيل حضور، أو بتثبت جهازًا فعليًا.

## English

1. Sidebar **Employees** → `/staff`. If you may read passkey bindings you see an **Employee passkeys** card with "Review
   the binding before helping an employee replace an authenticator." and a list of the employees in your scope, each with a
   **View passkey** button. This card is separate from the employee's **Edit** panel: a Branch Manager can have this
   permission without being allowed to edit employees. Without the permission the card does not appear at all. For long
   lists use **Next page** and **First page**.
2. Press **View passkey** on a bound employee → the **Employee passkey** section: **Bound since** and the bind date (in
   the branch timezone), and below it **Binding history** listing each record (**Bound since** … with **Unbound at**
   beside it once unbound). For an employee who never enrolled: **Not bound**. If a permission is missing for that
   employee or they are outside your scope → "This employee’s passkey is not available to you." If the staff feature is
   off for the company → "Staff features are not enabled for your company." The section never shows a key or a credential
   id, only dates.
3. **Unbind:** under the history, when the employee is bound and you may unbind: the warning "The employee will need to
   enroll again before clocking with a passkey.", a **Reason for unbinding** field and an **Unbind passkey** button. Enter a
   synthetic reason (1–500 characters) → **Unbind passkey** → "Passkey unbound. The employee can enroll again." The status
   becomes **Not bound** and the old record stays visible with its unbind date. With no reason (or only spaces) → "Enter a
   reason of 1–500 characters." and nothing is unbound.
4. **The command is tied to the binding version:** the button sends the binding id and revision you were shown. If the
   employee enrolled again or someone else unbound before you → "The passkey binding changed. Refresh its status before
   trying again." (`PASSKEY_REVISION_CONFLICT`, 409), and a replacement binding is never touched. Open two tabs for the
   same employee and unbind from one, then the other.
5. **Authority over every branch of the employee:** one binding covers the employee across their branches, so your scope
   must cover the primary branch and every current open attachment. An employee in two branches and a manager covering only
   one → unbind refused, even if the other branch is only a future-starting attachment or an
   attachment with a future end date; attachments are judged on the branch-local date at the single decision instant.
   A Business Manager covers the whole business; a Branch Manager only their branch. An unknown, other-company, deleted
   or out-of-scope employee, with a valid or invalid body → the same "Not found" (`NOT_FOUND`, 404).
6. **Never your own:** a manager who is themselves the employee (or who registered the active binding, even after it was
   linked to another employee) tries to unbind → "You cannot unbind your own passkey. Ask another permitted manager."
   (`PASSKEY_SELF_UNBIND`, 403), checked after scope authorization. Another permitted manager succeeds.
7. **Enrolling again:** after the unbind the employee opens their personal link on their own phone
   ([22](22-personal-phone-passkey.md)) → "Register your passkey on this phone." → **Register a passkey** → "Your passkey is
   registered. Replacement requires your manager to unbind it first." This is a new binding at a higher revision, with no
   further approval. View it again: **Bound since** shows the new date and **Binding history** lists both records. Any proof
   or operation challenge issued for the old binding is refused, even after re-enrolment.
8. **Under the hood:** each successful unbind writes a `passkey.unbind` audit entry with who and why, and an
   `EmployeePasskeyUnbound` event (with no reason and no key) in the same transaction; a failure or rollback leaves neither.
   The credential in the global auth store stays inert and is never deleted or exposed. A simultaneous unbind and enrolment
   serialize without deadlock, and the loser leaves no trace.
9. **The shared-device signal (not active yet):** if two different employees clock in from the same app installation
   within 10 minutes (inclusive), it is marked for the manager as an advisory flag, never a block. Recording begins in
   PR 22b, so the table is empty and no flag can appear today; the board that shows it is PR 27. Only a company-separated
   hash is stored, never a raw identifier or a browser fingerprint. The signal can be wrong (cleared storage, synced
   passkeys, copied identifiers) and does not prove a physical device.

**Must NOT happen:**
- Unbinding without a reason, a manager unbinding their own passkey, or a manager unbinding an employee attached to a branch
  outside their scope.
- A stale unbind command affecting a replacement binding, or an old proof accepted after the unbind or re-enrolment.
- A response that tells an out-of-scope employee from an unknown one, or exposes keys, credential ids or biometric data.
- A role other than the four, a Device, a personal session or a kiosk session reading or unbinding.
- Deleting the credential from the auth store, or unbinding erasing the history.
- Claiming the shared-device signal works today, that it blocks a clock-in, or that it proves a physical device.

## For an agent

- Admin: `http://localhost:3001/staff` → the **Employee passkeys** card. Buttons by exact text (**View passkey**,
  **Unbind passkey**, **Next page**, **First page**); reason field `#passkey-unbind-reason`. Failures are `role=alert`; the
  unavailable/disabled messages and the success message are `role=status`. History refreshes every 30 seconds.
- Manager API (session cookie and `x-company-id`; no `Idempotency-Key`, the binding id and revision make a retry safe):

  ```http
  GET  /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/passkeys?limit=20&cursor=<CURSOR>
  POST /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/passkeys/unbind
  GET  /v1/businesses/<BUSINESS_ID>/employee-passkeys
  ```

  First returns `{ status: { bound, binding_id, revision, bound_at }, can_unbind, items, next_cursor }` with each item
  `{ binding_id, revision, bound_at, unbound_at }`. Unbind sends `{ "binding_id": "<BINDING_ID>", "revision": <REVISION>, "reason": "<SYNTHETIC_REASON>" }`
  → 200 `{ binding_id, revision, unbound_at }`. The third is the scoped employee selector for managers who have the
  passkey permissions but not employee editing. The scoped guard precedes body validation, so valid and invalid bodies on
  unknown or inaccessible employees return identical `NOT_FOUND` envelopes; `FEATURE_DISABLED` when the staff feature is off.
- Assertions: after a successful unbind `revision` increments and the old binding stays in history with `unbound_at` set;
  re-enrolment chooses a higher revision. Reason is trimmed 1–500; anything else is a validation failure.
  `PASSKEY_SELF_UNBIND` is raised only after the scope check and covers the linked user and the active binding's
  `bound_by`. The clock is sampled once, after all locks (company, ordered memberships, employee, active binding), and used
  for branch attachments, membership/permission expiry, feature-override expiry and the unbind timestamp: an override that
  expires while the request waits for a lock must refuse the write (the #100 fix; use a controlled clock). Current
  attachments end at their exclusive end date in each branch's timezone; future-dated detaches and future-starting
  attachments both count. Device ALLOWs for the passkey codes → `PERMISSION_ROLE_FORBIDDEN`; historical ones grant nothing.
  A personal, kiosk or Device credential on these routes is refused. Rollback leaves binding, audit and outbox unchanged.
- Shared-device signal: nothing to click. Seeded test rows only: `attendance_device_signals` holds an installation hash,
  tenant ids and server time, with forced RLS, SELECT/INSERT only; the pure rule flags distinct employees within the
  inclusive 10-minute window and never the same employee, different installations, other tenants or out-of-window pairs.
  Sources: `docs/specs/026-staff-unbind-passkey/spec.md`, `docs/adr/0029-passkey-unbind-device-signal.md`,
  `apps/admin/src/staff/ui/{passkey-employees-panel,employee-passkey-section,passkey-binding-history,unbind-passkey-form}.tsx`,
  `apps/api/src/modules/staff/http/employee-passkeys.controller.ts`, `packages/contracts/src/staff/unbind-passkey.ts`,
  `packages/i18n/src/{passkey-admin,ar,en}.ts` and `apps/api/src/shared/errors.ts`.
