# 07 · Package value and sessions — قيمة الباقة وجلساتها

**Status / الحالة:** shipped in #65 (PR 31). **No screen yet** — package types arrive with PR 33 and selling and
redeeming with later slices. This is the rule core they will call. You check it through its tests and the
worked examples below. Nothing to deploy.

**Before you start / قبل ما تبدأ:** [00 Local setup](00-local-setup.md) steps 1–3 only. No database is needed.

## العربي

1. شغّل اختبارات الباقات لوحدها:
   `pnpm --filter @pospay/api exec vitest run --config vitest.unit.config.ts src/modules/orders`
   **لازم تشوف:** كل الاختبارات خضرا، من غير Postgres.
2. **توزيع السعر على الخدمات:** باقة اتباعت بـ 10.001 د.ك فيها خدمتين وزنهم 20 : 10 (سعر القائمة × عدد الجلسات) ←
   الأولى **6.667** والتانية **3.334**. المجموع 10.001 بالظبط — الفلس الزيادة بيروح للخدمة اللي كسرها أكبر.
3. **تعادل الكسور:** لو خدمتين ليهم نفس الكسر، الفلس بيروح للخدمة صاحبة الـ id الأصغر، ومهما غيّرت ترتيب الإدخال
   النتيجة واحدة.
4. **قيمة كل جلسة:** خدمة قيمتها 0.010 د.ك على 3 جلسات ← **0.003 ، 0.003 ، 0.004** (الباقي في آخر جلسة).
5. **باقة مستوردة مستخدمة جزئيًا:** 3 جلسات أصلًا والمتبقي 1 ← الجلستين الأولى والتانية **مستخدمة قبل الاستيراد**،
   والتالتة **متاحة** — وقيمتها نفس قيمتها في الباقة الجديدة.
6. **الاستخدام والاسترداد:** الاستخدام بياخد أقل جلسة متاحة؛ الاسترداد بياخد أعلى الجلسات المتاحة بالعدد المطلوب
   بالظبط، ولو مفيش كفاية بيترفض كله (`INSUFFICIENT_SLOTS`).
7. **الصلاحية:** الاستخدام مسموح **يوم** تاريخ الانتهاء نفسه (بتوقيت الفرع)، ومرفوض من اليوم اللي بعده.
8. **حد الجلسات (قرارك 2026-10-03):** خدمة فيها **365** جلسة مقبولة؛ **366** مرفوضة (`INVALID_SESSIONS`).

**ممنوع يحصل:** مجموع قيم الخدمات أو الجلسات يختلف عن المدفوع ولو بفلس؛ نتيجة تتغير بترتيب الإدخال؛ باقة بأكتر من
365 جلسة في الخدمة؛ أي حساب بـ `number` بدل الفلوس الصحيحة (`bigint`).

## English

1. Run the package tests alone:
   `pnpm --filter @pospay/api exec vitest run --config vitest.unit.config.ts src/modules/orders`
   **You must see:** every test passed, with no Postgres.
2. **Price across services:** a package sold for 10.001 KWD with two services weighted 20 : 10 (list price × sessions)
   → **6.667** and **3.334**. The total is exactly 10.001; the extra fils goes to the larger fractional remainder.
3. **Tied remainders:** the fils goes to the lower service id, whatever the input order.
4. **Value per session:** a 0.010 KWD service over 3 sessions → **0.003, 0.003, 0.004** (the remainder on the last).
5. **Imported, partly used:** 3 original sessions with 1 remaining → sessions 1 and 2 are **used before import**,
   session 3 is **free**, valued exactly as in a new package.
6. **Redeem and refund:** redemption takes the lowest free session; a refund takes exactly the requested number of
   highest free sessions, or refuses the whole request (`INSUFFICIENT_SLOTS`).
7. **Expiry:** redemption is allowed **on** the expiry date (branch-local) and refused from the next day.
8. **Session cap (your decision, 2026-10-03):** **365** sessions per service is accepted; **366** is refused
   (`INVALID_SESSIONS`).

**Must NOT happen:** service or session values that differ from the amount paid by even one fils; a result that
changes with input order; more than 365 sessions per service; any arithmetic in `number` instead of integer fils.

## For an agent

- No browser step. Run the command in step 1 and assert exit code 0 and `passed` in the summary.
- The spec scenarios `PKG-01`…`PKG-11` are covered by the tests in `apps/api/src/modules/orders/domain/__tests__/`
  (some carry the id in their name); amounts there
  are in mills (1 KWD = 1000).
