# 27 · Import employees from Excel — استيراد الموظفين من Excel

**Status / الحالة:** shipped in #107 (Phase 1 PR 11). Admin not deployed (issue #54), so this runs **locally only**. The
commit runs as a **worker job**: the API accepts it (202) and the screen polls for the result, so the worker and Redis
must be running. Phone/user linking is **not** part of the import (IM-Q1, recommended: keep it an explicit edit on the
employee, [16](16-update-employee.md)). Deleting old previews is a later cleanup slice (IM-Q3).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with Redis running, `pnpm db:migrate`, `pnpm db:seed`, then start `api`, `worker`
  and `admin`. Private files must work ([14](14-private-files.md)): R2 or the local Garage container.
- Sign in as an owner or a manager with `manage:employees:business` ([01](01-admin-sign-in-and-totp.md)) and choose the
  company and business ([02](02-admin-workspace-selector.md)). The business needs at least one branch.
- Use synthetic names only. Never put a real person's data in a test workbook.

## العربي

1. افتح **استيراد الموظفين** (`/staff/import`) ← يظهر **نزّل القالب واملأه وارفعه ثم عاينه قبل الحفظ.**
2. دوس **تنزيل القالب** ← ينزل ملف `.xlsx` واحد، العناوين بالعربي والإنجليزي، وفيه ورقة مرجع بالأدوار وأسماء
   الفروع. الأعمدة: **الاسم بالإنجليزية**، **الاسم بالعربية**، **الدور الوظيفي**، **تاريخ التعيين**، **نهاية العقد**،
   **الفرع الرئيسي**.
3. املأ صفين صح وصف فيه غلطة (مثلاً نهاية العقد قبل تاريخ التعيين). دوس **اختر ملف xlsx المكتمل** ثم **معاينة** ←
   يظهر **صفوف تحتاج تصحيحاً** وجدول فيه **الصف** و**العمود** و**السبب**، مثلاً **يجب أن تكون نهاية العقد في تاريخ
   التعيين أو بعده.** زرار **حفظ الاستيراد** مقفول. **مفيش ولا موظف اتحفظ.**
4. صلّح الصف وارفع الملف تاني ودوس **معاينة** ← **لا أخطاء — يمكنك الحفظ.** والزرار يفتح.
5. دوس **حفظ الاستيراد** ← **تمت إضافة الاستيراد إلى قائمة الانتظار. جارٍ انتظار النتيجة…** وبعد ثواني ←
   **الموظفون المستوردون:** والعدد. افتح قايمة الموظفين ← كلهم موجودين مرة واحدة بس.
6. **كله أو ولا حاجة:** لو حاجة اتغيرت بين المعاينة والحفظ (مثلاً الفرع اتمسح) ← **فشل الاستيراد ولم يُحفظ أي موظف.**
7. **لو الاستيراد اتأخر:** الشاشة بتستنى دقيقتين بس، وبعدها ← **الاستيراد لا يزال قيد التنفيذ. أعد فتح الصفحة لاحقاً
   لمعرفة النتيجة. لا ترفع المصنف مرة أخرى إلا إذا ظهر أن الاستيراد فشل.** إعادة فتح الصفحة بتعرض نتيجة نفس الطلب. لو
   الطلب فضل معلّق أكتر من 10 دقايق، الـ worker بيقفله كفشل، وساعتها بس ترفع الملف تاني.
8. **حدود الملف:** أكبر من 2 ميجا ← **حجم ملف الاستيراد يتجاوز 2 ميجابايت.** أكتر من 500 صف ← **عدد صفوف الاستيراد
   يتجاوز 500 صف.** عناوين مختلفة عن القالب ← **عناوين أعمدة الملف غير مطابقة للقالب.** ملف بايظ أو مضغوط بشكل مريب ←
   **محتوى ملف الاستيراد غير صالح أو تعذّرت قراءته.**
9. **المعاينة لمرة واحدة ولمدة 24 ساعة:** حفظ نفس المعاينة تاني بيرجّع نفس النتيجة من غير استيراد تاني. بعد 24 ساعة ←
   **انتهت صلاحية معاينة الاستيراد (24 ساعة).**

**ممنوع يحصل:**
- موظف واحد يتحفظ من ملف فيه صف غلط، أو نص الموظفين يتحفظوا ونص لأ.
- نفس الملف يتستورد مرتين (ضغطتين على الزرار، أو إعادة إرسال بنفس Idempotency-Key).
- معاينة أو ملف أو نشاط لشركة تانية يرد بحاجة غير **غير موجود** — بالظبط زي حاجة مش موجودة.
- الشاشة تفضل تلف للأبد على **جارٍ انتظار النتيجة…**.
- ملف Excel يتقبل كـ مستند موظف ([14](14-private-files.md)): المستندات PDF/JPEG/PNG بس.

## English

1. Open **Import employees** (`/staff/import`) → **Download the template, fill it, upload it and preview before
   committing.**
2. **Download template** → one `.xlsx` workbook with bilingual headers and a reference sheet of roles and branch names.
   Columns: **Name (English)**, **Name (Arabic)**, **Role**, **Hire date**, **Contract end**, **Primary branch**.
3. Fill two good rows and one bad row (contract end before hire date). **Choose the filled .xlsx file**, then
   **Preview** → **Rows to fix**, a table with **Row**, **Column**, **Reason** (e.g. **Contract end must be on or after
   the hire date.**). **Commit import** is disabled. **No employee is written.**
4. Fix the row, upload again, **Preview** → **No errors — you can commit.** and the button enables.
5. **Commit import** → **Import queued. Waiting for the result…**, then **Employees imported:** with the count. Every
   employee appears exactly once in the employee list.
6. **All or nothing:** if something changed between preview and commit (e.g. the branch was deleted) → **The import
   failed. No employees were saved.**
7. **A slow import:** the screen polls for two minutes, then → **The import is still running. Reopen this page later to
   see the result. Do not upload the workbook again unless the import shows as failed.** Reopening the page shows the
   same request's result. A request stuck for more than 10 minutes is failed by the worker sweep; only then upload again.
8. **File limits:** over 2 MiB → **The import file exceeds 2 MiB.**; over 500 rows → **The import has more than 500
   data rows.**; wrong headers → **The file column headers do not match the template.**; a corrupt or suspicious
   archive → **The import file content is invalid or unreadable.**
9. **Single use, 24 hours:** committing the same preview again returns the stored result without a second import. After
   24 h → **The import preview expired after 24 hours.**

**Must NOT happen:**
- Any employee saved from a workbook with an invalid row, or a partial import.
- The same workbook imported twice (double click, or a replay with the same Idempotency-Key).
- Another tenant's preview, file or business answering with anything but the plain not-found.
- The screen spinning forever on **Waiting for the result…**.
- An Excel file accepted as an employee document ([14](14-private-files.md)): documents are PDF/JPEG/PNG only.

## For an agent — للـ agent

- Page: `/staff/import` (admin). Find controls by visible text in either language (quoted above).
- API: `GET /v1/businesses/{businessId}/employees/import/template`, `POST …/previews` (`{ file_id }`),
  `GET …/previews/{previewId}`, `POST …/commits` (`{ preview_id }`) with an `Idempotency-Key` header → `202`; poll the
  preview until its status moves from `commit_requested` to `committed` or `failed`.
- Assert: after a preview with errors the employee count is unchanged; after a clean commit the count rises by exactly
  the row count and a replay with the same key does not change it again; a cross-tenant `previewId` returns `404`
  `NOT_FOUND` identical to a random UUID.
