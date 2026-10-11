# 40 · Employee IBAN (bank account) — الحساب البنكي للموظف (الآيبان)

**Status / الحالة:** shipped in #140 (PR 9b, merged). The three API routes are **live on staging** (api + worker at commit
`6c220e4`, 2026-10-11); the **admin screen is not deployed** (issue #54), so the section runs locally only. No OTP involved.
Your decisions of 2026-10-09 (IB-Q1 to IB-Q11) apply, with Abu Salem's choice differing only on IB-Q2:
[owner-questions.ar.md](../specs/040-staff-employee-iban/owner-questions.ar.md). The IBAN lives on the employee record, not
in employee documents. Every IBAN in this file is **fake**: the first is the ISO 13616 registry's published Kuwait sample.
Never type a real IBAN while testing.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (the append-only `employee_ibans` table) and `pnpm db:seed`.
  API and admin running; the company's `staff` feature enabled.
- Three synthetic users, each with their own session: the **Owner** (holds the salary read and manage permissions by
  default, [18](18-set-salary.md)); a **Branch Manager** of Salmiya with `manage:employees:business` but **no** salary
  permission (sees the last 4 only); and a user with neither (for the not-found check).
- Synthetic employees ([13](13-create-employee.md)): **Sara Ahmed** and **Heba**, both in Salmiya, in one business; a
  third employee in a **second business** of the same company; and an employee in another company for the API check.
- Fake values used below: IBAN A = `KW81 CBKU 0000 0000 0000 1234 5601 01` (bank code `CBKU`, so the form picks
  **Commercial Bank of Kuwait**), IBAN B = `KW86 NBOK 0000 0000 0000 1234 5601 02` (bank code `NBOK`, **National Bank of
  Kuwait**), holder name `SARA AHMED ALI`.

## العربي

1. **قسم الحساب البنكي:** كمالك افتح **الموظفون** ← `/staff` ← **تعديل** على سارة. تحت بيانات الموظف وبعد قسم المرتب
   هتلاقي قسم **الحساب البنكي (الآيبان)**. موظفة من غير حساب: **لا يوجد آيبان مسجل**، وتحتها الفورم (لأنك صاحب صلاحية
   التعديل). مدير الفرع من غير صلاحية المرتب بيشوف القسم بس بالرقم المخفي (الخطوة 6).
2. **الإدخال مع التلميح:** في **الآيبان** اكتب IBAN A بمسافات وحروف صغيرة (`kw81 cbku 0000 …`) ← تحت الحقل
   **صيغة الآيبان وأرقام التحقق صحيحة.** وحقل **البنك** اتختار لوحده **بنك الكويت التجاري** (من الكود `CBKU`)، لكن
   تقدر تغيّره من القايمة (**اختر البنك**). غلّط رقم واحد في الآخر (`…0102`) ← **أرقام التحقق في الآيبان غير متطابقة —
   راجع الرقم.** اكتب `GB82 WEST 1234 5698 7654 32` ← **تُقبل الحسابات البنكية في الكويت ودول الخليج فقط.** اكتب رقم
   ناقص ← **أدخل الآيبان بصيغة صحيحة.**
3. **الحفظ:** رجّع IBAN A الصح، **اسم صاحب الحساب بالإنجليزية** = `SARA AHMED ALI`، **السبب** = `new employee`
   (إلزامي، من 1 لـ 500 حرف) ← **حفظ الحساب البنكي** ← **تم حفظ الحساب البنكي.** القسم دلوقتي بيعرض الآيبان كامل
   مقسوم أربعات (`KW81 CBKU 0000 0000 0000 1234 5601 01`)، واسم البنك، واسم صاحب الحساب، وجدول **تاريخ الحساب البنكي**
   فيه صف واحد: **النسخة** 1، الآيبان، البنك، الاسم، **السبب**، **تاريخ التعيين**، **عيّنه**. من غير سبب، أو اسم عربي في
   خانة الاسم، أو بنك غير بنك بلد الآيبان ← **راجع بيانات الحساب وأدخل سببًا من ١ إلى ٥٠٠ حرف.** ومفيش حفظ.
4. **التغيير:** غيّر لـ IBAN B (البنك بيتغير لـ **بنك الكويت الوطني**) والسبب `changed bank` ← **حفظ الحساب البنكي** ←
   النسخة 2، والصف القديم يفضل في التاريخ (الأحدث فوق). حفظ نفس القيم بالظبط ما بيعملش نسخة ولا سطر تدقيق.
5. **المسح:** دوس **مسح الحساب البنكي** ← الفورم يتحول لتأكيد (**تأكيد مسح الحساب البنكي**) ← اكتب سبب `account
   closed` ← **تأكيد مسح الحساب البنكي** ← القسم يرجع **لا يوجد آيبان مسجل**، والتاريخ فيه صف جديد **تم المسح**.
   **إلغاء** يرجّعك للفورم من غير مسح. مسح حساب فاضي أصلاً ما بيعملش حاجة.
6. **اللي بيشوف آخر 4 بس:** ادخل كمدير سالمية (تعديل موظفين من غير صلاحية المرتب) وافتح **تعديل** على سارة ← القسم
   بيعرض **•••• 0101** بس. من غير اسم البنك، ومن غير اسم صاحب الحساب، ومن غير جدول التاريخ، ومن غير فورم. الإخفاء بيحصل في
   السيرفر: حتى رد الـ API مفيهوش الآيبان الكامل.
7. **آيبان واحد لموظف واحد (IB-Q11):** سجّل IBAN A لسارة، وبعدين حاول تسجّله لهبة (حتى لو في نشاط تاني من نفس الشركة)
   ← **هذا الآيبان مسجل بالفعل لموظف آخر في الشركة.** (`EMPLOYEE_IBAN_ALREADY_USED`، 409) من غير ما تعرف مين. بعد ما سارة
   تغيّر أو تمسح الآيبان (أو تتمسح هي)، هبة تقدر تسجله. نفس الآيبان في شركة تانية مسموح.
8. **تعارض التعديل:** افتح سارة في تابين، واحفظ في الأول، واحفظ في التاني من غير إعادة تحميل ← **تغيّر الحساب البنكي.
   حدّث البيانات وحاول مرة أخرى.** (`EMPLOYEE_IBAN_REVISION_CONFLICT`، 409). الحفظ الأول يفضل.
9. **التدقيق:** كل تغيير فعلي (إدخال أو تغيير أو مسح) بيكتب صف تاريخ وسطر تدقيق `employee_iban` في نفس المعاملة، فيه
   آخر 4 والبنك ورقم النسخة وهل اتمسح. **مفيش آيبان كامل ولا اسم صاحب الحساب ولا سبب** في التدقيق ولا في اللوجات.

**ممنوع يحصل:**
- الآيبان الكامل أو اسم صاحب الحساب أو البنك يوصل لحد معاه تعديل موظفين بس، في الشاشة أو في رد الـ API.
- آيبان من بلد برّه الكويت والخليج (KW, SA, AE, BH, QA, OM)، أو أرقام تحقق غلط، أو بنك مش مطابق، يتحفظ.
- نفس الآيبان يبقى الحالي لموظفين في نفس الشركة، أو الرفض يكشف اسم الموظف التاني.
- تغيير من غير سبب، أو تغيير يمسح صف تاريخ قديم (التاريخ ما بيتعدلش ولا بيتمسح).
- حفظ بنفس القيم يعمل نسخة جديدة أو سطر تدقيق.
- موظف من نشاط أو شركة تانية، أو محذوف، يرد بحاجة غير `NOT_FOUND`.

## English

1. **The bank-account section:** as the Owner open **Employees** → `/staff` → **Edit** on Sara. Under the employee
   details and after the salary section is **Bank account (IBAN)**. An employee with nothing recorded shows "No IBAN on
   file" and, because you can manage it, the form. The Salmiya manager without the salary permission sees only the masked
   number (step 6).
2. **Typing with live hints:** in **IBAN** type IBAN A with spaces and lower case (`kw81 cbku 0000 …`) → under the field
   "IBAN format and check digits are valid." and **Bank** pre-selects "Commercial Bank of Kuwait" from the code `CBKU`;
   you may change it from the list ("Choose a bank"). Change the last digit (`…0102`) → "The IBAN check digits do not
   match — re-check the number." Type `GB82 WEST 1234 5698 7654 32` → "Only Kuwait and GCC bank accounts are accepted."
   Type a short number → "Enter a valid IBAN format."
3. **Save:** restore IBAN A, **Account holder name in English** = `SARA AHMED ALI`, **Reason** = `new employee`
   (required, 1–500 characters) → **Save bank account** → "Bank account saved." The section now shows the full IBAN in
   groups of four (`KW81 CBKU 0000 0000 0000 1234 5601 01`), the bank, the holder name and a **Bank account history**
   table with one row: **Revision** 1, IBAN, **Bank**, holder, **Reason**, **Set at**, **Set by**. With no reason, an Arabic
   name in the holder field or a bank that is not the IBAN's country's → "Check the bank account fields and enter a reason
   (1–500 characters)." and nothing is saved.
4. **Change:** switch to IBAN B (the bank becomes "National Bank of Kuwait") and reason `changed bank` → **Save bank
   account** → revision 2; the old row stays in the history (newest first). Saving exactly the same values makes no
   revision and no audit entry.
5. **Clear:** press **Clear bank account** → the form turns into a confirmation ("Confirm clearing the bank account") →
   type reason `account closed` → **Confirm clearing the bank account** → the section returns to "No IBAN on file" and
   the history gains a row marked "Cleared". **Cancel** returns to the form without clearing. Clearing an already empty
   account does nothing.
6. **Last 4 only:** sign in as the Salmiya manager (employee management, no salary permission) and open **Edit** on Sara
   → the section shows only "•••• 0101". No bank, no holder name, no history table, no form. The masking is done on the
   server: even the API response holds no full IBAN.
7. **One IBAN, one employee (IB-Q11):** record IBAN A for Sara, then try it for Heba (even in the other business of the
   company) → "This IBAN is already registered to another employee in the company." (`EMPLOYEE_IBAN_ALREADY_USED`, 409)
   without saying who. After Sara changes or clears hers (or is deleted), Heba may record it. The same IBAN in another
   company is allowed.
8. **Edit conflict:** open Sara in two tabs, save in the first, save in the second without reloading → "The bank account
   has changed. Refresh and try again." (`EMPLOYEE_IBAN_REVISION_CONFLICT`, 409). The first save stays.
9. **Audit:** every actual change (set, replace, clear) writes one history row and one `employee_iban` audit entry in the
   same transaction, holding last 4, bank, revision and whether it was cleared. **No full IBAN, holder name or reason**
   appears in the audit or in logs.

**Must NOT happen:**
- The full IBAN, holder name or bank reaching someone with only employee management, on screen or in the API response.
- An IBAN outside Kuwait and the GCC (KW, SA, AE, BH, QA, OM), with wrong check digits or a mismatched bank, being saved.
- One IBAN being current for two employees of a company, or the refusal revealing the other employee.
- A change with no reason, or a change that deletes or edits an old history row (the history is append-only).
- A same-values save creating a revision or an audit entry.
- An employee of another business or company, or a deleted one, answering with anything but `NOT_FOUND`.

## For an agent

- Admin: `http://localhost:3001/staff` → **Edit** on an employee; the section has `aria-label` "Bank account (IBAN)" /
  «الحساب البنكي (الآيبان)». Inputs by id: `#employee-iban`, `#employee-iban-bank` (a select), `#employee-iban-holder`,
  `#employee-iban-reason`. Buttons by text **Save bank account**, **Clear bank account**, **Confirm clearing the bank
  account**, **Cancel**. Success is `role="status"` "Bank account saved."; failures `role="alert"`. A masked reader sees
  `•••• 0101` and none of the inputs.
- API (session cookie + `x-company-id`; no `Idempotency-Key`; revision-based). Base
  `/v1/businesses/{businessId}/employees/{employeeId}/iban`:
  - `GET` → 200 `{ status: "SET"|"NOT_SET", iban_last4, iban, bank_id, holder_name_en, revision, set_at, set_by,
    can_read_full, can_manage }`. `iban`, `bank_id`, `holder_name_en`, `set_by` are non-null only when `can_read_full`;
    `revision` is always given. 404 `NOT_FOUND` when you hold neither full read nor employee management, or the employee is
    unknown, foreign or deleted.
  - `GET …/iban/history?cursor=<revision>&limit=1..100` → 200 `{ items: [ { revision, iban, bank_id, holder_name_en,
    cleared, set_at, set_by, reason } ], next_cursor }`, newest first; full-read holders only, everyone else 404.
  - `PUT …/iban` body (strict) `{ "iban": "KW81CBKU0000000000001234560101", "bank_id": "kw-cbk", "holder_name_en":
    "SARA AHMED ALI", "reason": "new employee", "expected_revision": 0 }` → 200 with the view above. To clear send
    `iban`, `bank_id` and `holder_name_en` all `null` (all null or all strings) with a reason. Spaces, lower case and
    Arabic-Indic digits in `iban` are normalised.
  - Errors: 400 `IBAN_FORMAT_INVALID`, `IBAN_COUNTRY_NOT_ALLOWED`, `IBAN_CHECKSUM_INVALID`, `IBAN_BANK_INVALID` ("The bank
    does not match the IBAN."), `IBAN_HOLDER_NAME_INVALID` ("Enter the account holder's name in English."),
    `VALIDATION_FAILED` (reason or shape); 409 `EMPLOYEE_IBAN_ALREADY_USED`, `EMPLOYEE_IBAN_REVISION_CONFLICT`; 404
    `NOT_FOUND`; `FEATURE_DISABLED`. Bank ids are `kw-nbk`, `kw-cbk`, `kw-gulf`, … (country prefix, then the bank).
- Permissions: full read `read:salaries:business`; change also needs `manage:salaries:business`; masked read
  `manage:employees:business`. No new permission codes, no role bundle (owner by default, grantable as a personal ALLOW).
- Assertions: the masked reader's JSON never contains the full IBAN, bank or holder name; the audit entry
  (`employee_iban`) contains `iban_last4` but no `iban` and no `holder_name_en`; the history only grows.
- Sources: `docs/specs/040-staff-employee-iban/spec.md` and `contracts/employee-iban-api.md`,
  `apps/admin/src/staff/ui/{employee-iban-section,iban-form,iban-banking-fields,iban-input,iban-history-table}.tsx`,
  `apps/api/src/modules/staff/http/employee-iban.controller.ts`, `packages/domain` (`iban.ts`, `gcc-banks.ts`),
  `packages/i18n/src/employee-iban-catalog.ts`.
