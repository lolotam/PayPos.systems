# 81 · A customer's profile and per-business notes — ملف العميلة وملاحظات كل نشاط

**Status / الحالة:** shipped in #766 (34-pre-1: gender, birthday and email on a customer, one note per business, and
the profile read; migration 0198), then extended by 34-pre-2 (delivered here): the reception form ([47](47-record-visit-reception.md))
now sends gender, birthday, email and the scoped note, and opens the customer card. Gender is **required for a new
customer only** (owner answer CI-Q10); an existing customer with a NULL gender still opens unchanged. The routes need
the `customers` feature. **Not built:** the customers import itself (34b), self-registration and profile editing.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API, then `pnpm db:migrate` (0198) and `pnpm db:seed`; or staging with
  the demo company «صالون الأميرة (تجريبي)». The `customers` feature on.
- A user who may create customers in the business (the same permission as [10](10-customer-find-or-create.md)).
- Synthetic values only: a made-up phone number, a made-up email.

## العربي

API بس، لسه مفيش شاشة.

1. **عميلة جديدة ببياناتها:** من مسار النشاط، اطلب «دوّر أو أضف» برقم جديد واسم ولغة، ومعاهم **النوع** (`female` أو
   `male`)، و**عيد الميلاد** (يوم وشهر، والسنة اختيارية)، و**الإيميل**، و**ملاحظة** ← العميلة بتتضاف، والرد فيه
   الاسم واللغة والرقم مخفي (`***` وآخر رقمين أو تلاتة).
2. **الملف:** اطلب ملف العميلة ← الاسم، اللغة، الرقم المخفي، عيد الميلاد، النوع، الإيميل، وقائمة **الملاحظات**:
   كل ملاحظة باسم النشاط اللي اتكتبت فيه (عربي وإنجليزي) ووقتها.
3. **عميلة موجودة:** نفس الرقم تاني ببيانات مختلفة ← بترجع نفس العميلة زي ما هي؛ النوع والميلاد والإيميل
   والملاحظة الجديدة **بيتجاهلوا** وما بيغيّروش حاجة.
4. **ملاحظة لكل نشاط:** الملاحظة بتتحفظ تحت النشاط (مسار الفرع بيحوّلها لنشاط الفرع). مسار الشركة ما بيقبلش
   ملاحظة أصلًا.
5. **كل الأنشطة تشوف:** مستخدم في نشاط تاني في نفس الشركة يفتح ملف نفس العميلة ← بيشوف ملاحظة النشاط الأول وجنبها
   اسم النشاط (قرار المالك CI-Q17).
6. **عيد ميلاد غلط:** يوم من غير شهر، أو 31 في شهر 30، أو 29 فبراير في سنة مش كبيسة ← بيترفض.
7. **إيميل غلط:** من غير `@` أو من غير نقطة، أو أقصر من 3 أو أطول من 254 ← بيترفض.
8. **ملاحظة غلط:** فاضية، أو أطول من 500 حرف ← بيترفض.
9. **عميلة شركة تانية:** رقم عميلة من شركة تانية ← مش موجودة (كأنها مش موجودة خالص).
10. **من شاشة الاستقبال:** في «تسجيل زيارة» أو بيع الباقة اختاري النوع للعميل الجديد، وادخلي الميلاد والإيميل والملاحظة (في مسار النشاط أو الفرع). البطاقة بعد الاختيار بتعرض النوع والميلاد والإيميل وملاحظات الأنشطة كلها باسم كل نشاط. عميل موجود من غير نوع بيتفتح من غير ما يتعدّل.

**ممنوع يحصل:**
- رقم العميلة الكامل يظهر في رد، أو في سجل التدقيق، أو في اللوج.
- عيد الميلاد أو الإيميل أو نص الملاحظة يظهروا في رسالة خطأ أو في اللوج.
- بيانات عميلة موجودة تتغيّر من طلب «دوّر أو أضف».
- ملاحظة تتحفظ من مسار الشركة.
- ملف أو ملاحظة عميلة يتشافوا من شركة تانية.

## English

API only, no screen yet.

1. **A new customer with her details:** on the business route, call find-or-create with a new phone, a name and a
   language, plus a **gender** (`female` or `male`), a **birthday** (day and month; the year is optional), an
   **email** and a **note** → the customer is created; the answer has her name, language and a masked phone (`***`
   and the last two or three digits).
2. **The profile:** ask for the customer's profile → name, language, masked phone, birthday, gender, email and the
   list of **notes**: each note with the business it was written in (Arabic and English name) and its time.
3. **An existing customer:** the same phone again with different details → the same customer comes back unchanged;
   the new gender, birthday, email and note are **ignored** and change nothing.
4. **One note per business:** the note is stored under the business (the branch route turns it into the branch's
   business). The company route accepts no note at all.
5. **Every business sees them:** a user of another business in the same company opens the same customer's profile →
   he sees the first business's note with that business's name next to it (owner answer CI-Q17).
6. **A bad birthday:** a day without a month, the 31st of a 30-day month, or 29 February in a non-leap year →
   refused.
7. **A bad email:** no `@` or no dot, shorter than 3 or longer than 254 characters → refused.
8. **A bad note:** empty, or longer than 500 characters → refused.
9. **Another company's customer:** the id of a customer of another company → not found (as if she did not exist).
10. **From reception:** in Record a visit or Package sale, choose a gender for a new customer and enter the birthday, email and note (business or branch entry only). The selected card shows gender, birthday, email and the notes of every business labelled with its name. An existing customer with no gender opens without any edit.

**Must NOT happen:**
- The customer's full phone in an answer, the audit log or the technical logs.
- The birthday, the email or the note text in an error message or a log.
- An existing customer's details changed by a find-or-create call.
- A note stored through the company route.
- A profile or a note read from another company.

## For an agent

- **Screens:** `apps/admin/src/orders/ui/session-customer-field.tsx` (shared by the visit and package-sale forms) with
  `customer-profile-inputs.tsx` and `session-customer-profile-card.tsx`; reads use `use-session-customer-profile.ts`
  on the same scoped profile route as entry. The company route has no note field.
- **API** (`apps/api/src/modules/customers/http/`, the `customers` feature, `x-company-id`):
  - Find or create (`customers.controller.ts`): `POST /v1/customers/find-or-create` (`create:customers:company`, no
    `note`) · `POST /v1/businesses/<BUSINESS_ID>/customers/find-or-create` (`create:customers:business`) ·
    `POST /v1/branches/<BRANCH_ID>/customers/find-or-create` (`create:customers:branch`).
  - Profile (`customer-profile.controller.ts`): `GET /v1/customers/<CUSTOMER_ID>/profile` ·
    `GET /v1/businesses/<BUSINESS_ID>/customers/<CUSTOMER_ID>/profile` ·
    `GET /v1/branches/<BRANCH_ID>/customers/<CUSTOMER_ID>/profile`, with the matching `create:customers:*`
    permission.
- **Shapes** (`packages/contracts/src/customers.ts`): `findOrCreateScopedCustomerInput` (`phone`, `name`, `locale`,
  `gender?`, `birthday?`, `email?`, `note?`) and `customerProfile` (with `notes[]` of `business_id`,
  `business_name_ar`, `business_name_en`, `note`, `created_at`).
- **Rules:** `apps/api/src/modules/customers/domain/profile.ts` (calendar birthday, email 3–254 code points with `@`
  and a dot, note 1–500 code points without NUL); an existing customer is returned as is
  (`use-cases/find-or-create-customer/find-or-create-customer.usecase.ts`).
- **Sources:** `docs/specs/073-customers-import/owner-questions.ar.md` (CI-Q8 … CI-Q17),
  `docs/specs/073-customers-import/34-pre-1-plan.md`, journey [10](10-customer-find-or-create.md).
