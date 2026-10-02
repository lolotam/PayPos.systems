# 06 · Commission engine I — حساب العمولة (المرحلة الأولى)

**Status / الحالة:** shipped in #64 (PR 29). **No screen yet** — this is the calculation core that later slices
(PR 30 versions and validation, then the statement screens) call. You check it through its tests and the worked
examples below. Nothing to deploy.

**Before you start / قبل ما تبدأ:** [00 Local setup](00-local-setup.md) steps 1–3 only. No database is needed.

## العربي

1. شغّل اختبارات العمولة لوحدها:
   `pnpm --filter @pospay/api exec vitest run --config vitest.unit.config.ts src/modules/commissions`
   **لازم تشوف:** كل الاختبارات خضرا (`passed`)، ومن غير ما Postgres يكون شغّال.
2. **مثال المالك:** الموظفة نصيبها من البند 1000 د.ك، والشريحة الأولى بتبدأ من 500 د.ك بنسبة 5٪، والأساسي مقفول ←
   العمولة **25.000 د.ك** (الـ 500 الأولى ما عليهاش عمولة، والـ 500 اللي بعدها × 5٪).
3. **حدود الشرايح:** شرايح 0 ← 5٪، 50 د.ك ← 10٪، 100 د.ك ← مبلغ ثابت. الموظفة كانت عاملة 40 د.ك قبل البند ده،
   ونصيبها في البند 60 د.ك ← **5.500 د.ك** (10 د.ك × 5٪ + 50 د.ك × 10٪). البند خلّصها عند 100 بالظبط، فالشريحة
   الثابتة ما اتلمستش.
4. نفس المثال بس النصيب 60.001 د.ك ← لمس الشريحة الثابتة، فالبند كله يتحسب بالنسبة اللي كانت شغالة في أوله (5٪)
   ← **3.000 د.ك**. البند اللي بعده هو اللي يبدأ بالشريحة الجديدة.
5. **تقسيم البند بين موظفتين:** صافي 10.001 د.ك بنسبة 50٪ / 50٪ ← 5.000 و 5.001؛ الفلس الزيادة بيروح للموظفة
   صاحبة الـ id الأصغر، ومجموع النصيبين دايمًا = الصافي بالظبط.
6. **الترتيب:** لو البنود اتسجلت متلخبطة (مثلاً بند اتسجل متأخر من الأوفلاين) ← الحساب بيرتبها بوقت الحدوث، فالنتيجة
   واحدة مهما كان ترتيب الإدخال.

**ممنوع يحصل:** فلس يضيع أو يزيد في التقسيم؛ تقريب أكتر من مرة على نفس البند؛ أي حساب بـ `number` بدل الفلوس
الصحيحة (`bigint`)؛ نتيجة تختلف لو اتغيّر ترتيب البنود.

## English

1. Run the commission tests alone:
   `pnpm --filter @pospay/api exec vitest run --config vitest.unit.config.ts src/modules/commissions`
   **You must see:** every test passed, with Postgres not running.
2. **Owner example:** an employee's share of a line is 1,000 KWD, the first tier starts at 500 KWD at 5%, base pay
   off → **25.000 KWD** (nothing on the first 500, 5% on the next 500).
3. **Tier edges:** steps 0 → 5%, 50 KWD → 10%, 100 KWD → a fixed amount. The employee had 40 KWD before this line
   and their share is 60 KWD → **5.500 KWD** (10 × 5% + 50 × 10%). The line ends exactly at 100, so the fixed step is
   not touched.
4. Same, with a share of 60.001 KWD → the fixed step is touched, so the whole line is priced at the rate active at
   its start (5%) → **3.000 KWD**. The next line starts on the new step.
5. **Two performers:** net 10.001 KWD split 50% / 50% → 5.000 and 5.001; the extra fils goes to the lower employee
   id, and the shares always add up to the net exactly.
6. **Order:** lines recorded out of order (for example a late offline sync) are priced in the order they happened,
   so the result never depends on input order.

**Must NOT happen:** a fils lost or created in a split; rounding more than once per line; any arithmetic in
`number` instead of integer fils (`bigint`); a result that changes with line order.

## For an agent

- No browser step. Run the command in step 1 and assert exit code 0 and `passed` in the summary.
- The worked examples are tests in `apps/api/src/modules/commissions/domain/__tests__/` (`marginal-tiers.spec.ts`,
  `line-order-and-shares.spec.ts`); amounts there are in mills (1 KWD = 1000).
