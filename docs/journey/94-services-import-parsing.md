# 94 · Services import from Excel: the cell-reading core — استيراد الخدمات من Excel: أساس قراءة الخلايا

**Status / الحالة:** nothing to click. Shipped in #817 (32b-1a: converting a price cell to a KWD amount), #823
(32b-1c: tagging spreadsheet cells where the file is read, so a number never travels as a JavaScript number) and
#824 (32b-1d: reading the two commission cells), all merged (spec 072). These are pure functions checked by unit
tests. **There is no services import yet:** no upload route, no preview, no commit and no screen exist for services.
The pieces a services import depends on, and that you can use today, are the categories
([73](73-service-categories.md)) and the duration and category of a service
([74](74-service-duration-category.md)). Services are still created one by one ([29](29-services.md)).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md); nothing else. No database is needed for these tests.

## العربي

مفيش حاجة تدوس عليها. اللي اتبنى قواعد قراءة خلايا الملف، وبتتأكد بالاختبارات.

1. **شغّل اختبارات القواعد:** من جذر المشروع شغّل اختبارات ملفات `service-import-price-cell`،
   `service-import-commission` و`tag-cells` ← كلها تنجح.
2. **السعر نص مش رقم:** خلية سعر فيها `12.5` ← بتتحوّل لـ `12.500` دينار من نص الخلية، من غير أي حساب عشري. ده
   اللي بيمنع فلس يضيع بسبب كسور الأرقام.
3. **سعر مرفوض:** خلية فاضية في عمود مطلوب، أو خلية فيها خطأ Excel، أو رقم بأكتر من 3 خانات عشرية، أو سالب، أو بفواصل أو
   أرقام غير لاتينية ← مرفوضة بسبب مسمّى (`IMPORT_REQUIRED_CELL` أو `IMPORT_PRICE_INVALID` أو `IMPORT_CELL_INVALID`)،
   وعمرها ما تاخد قيمة افتراضية.
4. **خلايا العمولة:** خليتين (نوع القاعدة وقيمتها) بيتحوّلوا لواحدة من قواعد الخدمة الأربعة: اتبع الخطة، من غير
   عمولة، نسبة، مبلغ ثابت ([29](29-services.md)). خليتين فاضيين = الافتراضي، وبيتعلّم عليه إنه افتراضي عشان المعاينة
   تبيّنه.
5. **التوسيم عند القراءة:** كل خلية بتتوسم مرة واحدة وهي بتتقرا: نص، أو رقم بنصّه العشري، أو منطقي، أو رقم ما
   بيتمثّلش، أو خطأ Excel، أو فراغ.

**ممنوع يحصل:**
- مبلغ يعدّي كرقم JavaScript (`number`) في أي خطوة.
- خلية فاضية أو فيها خطأ تتحوّل لصفر.
- سعر يتقرّب بدل ما يترفض.
- استيراد الموظفين ([27](27-employee-import.md)) يتغيّر سلوكه بسبب التوسيم المشترك.

## English

Nothing to click. What was built is the rules for reading the file's cells, checked by tests.

1. **Run the rule tests:** from the repository root run the tests of `service-import-price-cell`,
   `service-import-commission` and `tag-cells` → all pass.
2. **A price is text, not a number:** a price cell holding `12.5` → becomes `12.500` KWD from the cell's text, with
   no decimal arithmetic. This is what stops a mill being lost to floating point.
3. **A refused price:** an empty cell in a required column, a cell holding an Excel error, a number with more than 3
   decimals, a negative one, or one with separators or non-Latin digits → refused with a named reason
   (`IMPORT_REQUIRED_CELL`, `IMPORT_PRICE_INVALID` or `IMPORT_CELL_INVALID`), and never given a default value.
4. **The commission cells:** two cells (the rule kind and its value) become one of the four service rules: follow
   the plan, no commission, a percentage, a fixed amount ([29](29-services.md)). Two empty cells mean the default,
   and the result is marked as a default so the preview can show it.
5. **Tagging at the read:** every cell is tagged once as it is read: text, a number with its decimal text, a
   boolean, a number that cannot be represented, an Excel error, or blank.

**Must NOT happen:**
- An amount passing through a JavaScript `number` at any step.
- An empty cell or an error cell turned into zero.
- A price rounded instead of refused.
- The employee import ([27](27-employee-import.md)) changing its behaviour because of the shared tagging.

## For an agent

- **Screens and routes:** none. `apps/api/src/modules/catalog/http/services.controller.ts` has no import route.
- **Code:** `apps/api/src/modules/catalog/domain/service-import-price-cell.ts`,
  `apps/api/src/modules/catalog/domain/service-import-commission.ts`, `apps/api/src/shared/import/tag-cells.ts`.
- **Tests:** `apps/api/src/modules/catalog/domain/__tests__/service-import-price-cell.spec.ts`,
  `apps/api/src/modules/catalog/domain/__tests__/service-import-commission.spec.ts` and
  `apps/api/src/shared/import/tag-cells.spec.ts`, run with the API package's `vitest run` (`pnpm --filter @pospay/api
  test`).
- **Assertions:** the price converter returns the three-decimal KWD text and its mills from the service price parser,
  or a named refusal; no test needs a database.
- **Sources:** `docs/specs/072-catalog-services-import/spec.md` (FR-005, FR-006),
  `docs/specs/072-catalog-services-import/owner-questions.ar.md`.
