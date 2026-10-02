# 10 · Find or create a customer by phone — البحث عن عميل أو إضافته برقم الموبايل

**Status / الحالة:** shipped in #71 (PR 34). **API only** — the reception form with the country selector arrives
with PR 35. Local only.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), signed in to the admin as a user of the demo company
  ([01](01-admin-sign-in-and-totp.md)).
- The user needs the permission `create:customers:company` (no role gets it by default until PR 7a) and the company's
  plan must include the `customers` feature. Ask Claude to grant both for the test company.
- **Second company (step 6):** a second test company with the `customers` feature, and a session whose membership
  in that company has `create:customers:company` — changing `x-company-id` alone answers 403. Ask Claude to prepare it.
- **Authenticated requests:** the API needs the admin session cookie. From the admin tab (`http://localhost:3001`) open
  the browser console and send the request with `credentials: 'include'`:
  `fetch('http://localhost:3000/v1/customers/find-or-create', { method: 'POST', credentials: 'include', headers:
  { 'content-type': 'application/json', 'x-company-id': '<company id>' }, body: JSON.stringify({...}) })`.
  Without the cookie the answer is 401.
- Use **synthetic** phone numbers only.

**قبل ما تبدأ (بالعربي):** شركة تانية فيها ميزة `customers` وجلسة لمستخدم عنده `create:customers:company` فيها (للخطوة 6 —
تغيير `x-company-id` لوحده بيرجّع 403)؛ والطلبات لازم تتبعت بالـ cookie: من تبويب لوحة الإدارة افتح الـ console وابعت
`fetch(...)` بـ `credentials: 'include'` زي المثال اللي فوق، وإلا الرد 401.

## العربي

1. **عميل جديد:** ابعت `POST /v1/customers/find-or-create` مع الهيدر `x-company-id` والجسم
   `{ "name": "عميل تجربة", "locale": "ar", "phone": { "calling_code": "965", "national_number": "9xxxxxxx" } }`
   (8 أرقام لرقم كويتي) ← رد **200** فيه `id` والاسم واللغة و`opted_out: false`، والموبايل **مخفي** (`***` + آخر 3 أرقام).
2. **نفس الرقم تاني:** ابعت نفس الطلب باسم مختلف ← **نفس الـ `id`**، والاسم القديم **ما بيتغيرش**.
3. **صيغة الرقم:** الـ API بيقبل **أرقام بس** في `national_number` — مسافة أو قوس أو شرطة ← **400** (`INVALID_CUSTOMER_PHONE`). الأصفار في أول الرقم بتتشال: `"09xxxxxxx"` = نفس العميل.
4. **رقم كويتي غلط:** 7 أرقام، أو 9 أرقام مش بادئة بصفر، مع `965` ← **400** برسالة **اختر رمز اتصال بلد صالحاً وأدخل أرقام الهاتف الوطني؛ الكويت
   تتطلب ثمانية أرقام** — والرقم نفسه مش موجود في الرد.
5. **اسم فيه رموز تحكم مخفية** ← **400** (`VALIDATION_FAILED`).
6. **شركة تانية بنفس الرقم:** عميل منفصل تمامًا بـ `id` تاني، ومفيش أي حاجة بتقول إن الرقم موجود في شركة تانية.
7. **طلبين في نفس اللحظة بنفس الرقم:** عميل واحد بس.
8. **سجل التدقيق:** إنشاء العميل بيتسجل (من غير الرقم الكامل)؛ إيجاد عميل موجود ما بيتسجلش.

**ممنوع يحصل:** الرقم الكامل في أي رد أو رسالة خطأ أو log أو سجل التدقيق؛ عميلين بنفس الرقم في نفس الشركة؛ تعديل بيانات
عميل موجود من غير قصد؛ أي إشارة لعملاء شركة تانية.

## English

1. **New customer:** `POST /v1/customers/find-or-create` with header `x-company-id` and body
   `{ "name": "Test customer", "locale": "en", "phone": { "calling_code": "965", "national_number": "9xxxxxxx" } }`
   (8 digits for Kuwait) → **200** with `id`, name, locale and `opted_out: false`; the phone is **masked** (`***` and
   the last 3 digits).
2. **Same phone again** with another name → the **same `id`**; the stored name is **not** changed.
3. **Number format:** the API accepts **digits only** in `national_number` — a space, bracket or dash → **400**
   (`INVALID_CUSTOMER_PHONE`). Leading zeros are removed:
   `"09xxxxxxx"` is the same customer.
4. **Wrong Kuwaiti length** (7 digits, or 9 digits not starting with 0, with `965`) → **400** "Choose a valid country calling code and enter national
   digits; Kuwait requires eight digits" — the number is not echoed back.
5. **Hidden control characters in the name** → **400** (`VALIDATION_FAILED`).
6. **Another company, same phone:** a separate customer with another `id`; nothing reveals the phone exists elsewhere.
7. **Two simultaneous requests, same phone:** exactly one customer.
8. **Audit:** creating a customer is audited (without the full phone); finding an existing one is not.

**Must NOT happen:** the full phone in any response, error, log or audit entry; two customers with one phone in one
company; an existing customer silently changed; any hint of another company's customers.

## For an agent

- Replace `9xxxxxxx` with a synthetic 8-digit number; never use a real customer's phone.
- Assert the response body never contains the national number, and `phone` matches `^\*\*\*\d{3}$`.
- Coverage: `apps/api/src/modules/customers/__tests__/` (HTTP, persistence privacy, concurrency) and
  `packages/db/src/__tests__/rls-customers.spec.ts` (tenant isolation).
