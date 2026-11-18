# أسئلة المالك وإجاباته — PR 33: أنواع الباكدجات

## فهرس الباقات النشطة — 2026-11-18، الجلسة الأصلية

**السؤال:** هل مدير migration lane منح «lane granted» لتوليد migration التالية؟

**الاختيارات:** انتظار التصريح (المقترح)، أو التوليد بعد تصريح صريح فقط.

**الإجابة بالنص:**

> No lane granted yet. Your plan is right: finish schema, test and docs locally; do NOT run the final db:generate/renumber and do NOT push. Report the draft with the migration content, sha256 of the SQL, and EXPLAIN results. The manager will grant the lane after checking that no other migration PR is in flight.

**الحالة السابقة:** `PENDING` / `TODO(spec)` لتوليد migration وترقيمها وjournal وsnapshot والـpush فقط.

**تحديث المدير، 2026-11-18، الجلسة الأصلية — بالنص:**

> Manager: **lane granted** for the active-packages index. No open PR carries a migration, and the latest on main is 0230_2026-11-13_package-type-selling-stopped-at (#1073 is merged, 1105b98a). Your migration is **0231**. Steps: (1) in your worktree `git fetch origin main` and rebase your local commit 4bbdc705 onto current origin/main (no conflicts expected); (2) renumber to 0231, run db:generate, verify journal idx and snapshot prevId = the id of 0230, run the migration-chain check, and recompute the sha256 of the final SQL; (3) re-run the DB test for the query and your EXPLAIN check; (4) push with `git push origin HEAD:perf/pp-active-packages-index` (explicit branch, never main), open the PR against main (body: feature line «فهرس الباقات النشطة»; Arabic simple summary; expand-only index, no data change; migration flag; EXPLAIN before/after; sha256; checklist; end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). Do not request reviews, do not merge, do not touch any server. Last line: PR URL, head SHA, migration file name + sha256.

**الحالة الحالية:** `ANSWERED`؛ تصريح توليد 0231 ونشر الفرع وفتح PR فقط، بدون طلب مراجعات أو merge أو لمس سيرفرات.
التنفيذ والدليل: [الفهرس وقياسات EXPLAIN](active-packages-index.md).

**المالك:** وليد · **التاريخ:** 8 أكتوبر 2026 · **المواصفات:** [spec.md](spec.md) (الأرقام PT-Q1 … PT-Q11)

السؤال مكتوب زي ما اتسأل، والاختيار اللي كان مقترح عليه علامة ⭐، وإجابة المالك بخط عريض.

**الفكرة:** الباكدج هو اللي الصالون بيبيعه للعميلة. مثال: "10 جلسات سشوار بـ 25 دينار، صالحة 3 شهور".

---

### 1. تعديل الباكدج بعد ما اتباع (PT-Q4)
**السؤال:** لو غيّرت باكدج بعد ما اتباع (مثلًا "10 سشوار" من 25 لـ 27.500 دينار)، إيه اللي يحصل؟
- ⭐ كله يتعدل، واللي اشترى ياخد اللي دفعه. البيع بياخد نسخة من الباكدج وقت الشراء.
- الخدمات تتقفل بعد أول بيعة.
- مايتعدلش خالص بعد أول بيعة.

**الإجابة: كله يتعدل، واللي اشترى ياخد اللي دفعه.**

### 2. خدمة مجانية في الباكدج (PT-Q7)
**السؤال:** باكدج فيه خدمة مجانية (مثلًا "5 قصات + 5 غسيل مجاني"). الغسيل المجاني قيمته 0، فاللي بيغسل ماياخدش عمولة عليه. مسموح؟
- ⭐ مسموح، والجلسات المجانية مالهاش عمولة.
- ممنوع.

**الإجابة: مسموح.**

### 3. عمولة بيع الباكدج
**الخلفية:** الخطة فيها رأيين متعارضين. قرار D-55 (7 أكتوبر) بيقول بيع الباكدج مالوش عمولة، والقرار D-51 والجزء §5.6 من المواصفات العامة بيقولوا فيه عمولة بيع.

**السؤال:** الموظفة اللي باعت الباكدج نفسه (مش اللي بتعمل الجلسات) تاخد عمولة على البيعة؟
- ⭐ حسب خطة العمولة. النظام يسمح بعمولة بيع، بس خطط الصالون الحالية (سارة، هبة، سوسن، روان) مابتديش. ولو صالون تاني عايز، يفعّلها في خطته.
- لأ، أبدًا.
- أيوه، دايمًا.

**الإجابة: حسب خطة العمولة.** والقرار ده بيوفّق بين D-55 وD-51.

### 4. باقي الأسئلة (PT-Q1، PT-Q2، PT-Q3، PT-Q5، PT-Q6، PT-Q8 … PT-Q11)
**السؤال:** باقي أسئلة PR 33، موافق على كل اللي بنصح بيه؟ وده اللي اتعرض عليه:
- صلاحية منفصلة للباكدجات، لنفس المديرين التلاتة بتوع الخدمات (PT-Q1).
- صلاحية الباكدج من يوم لحد 730 يوم، يعني سنتين (PT-Q2).
- "30 يوم" معناها: اتباع 1 أكتوبر يبقى شغال لحد 31 أكتوبر (PT-Q3).
- "وقف البيع" بند منفصل (33b)، قبل بيع الباكدجات (PT-Q5).
- مفيش شرط على سعر الباكدج مقارنة بمجموع أسعار خدماته (PT-Q6).
- اسم الباكدج مايتكررش في نفس النشاط (PT-Q8).
- أقصى 20 خدمة في الباكدج (PT-Q9).
- الباكدج شغال في كل فروع النشاط (PT-Q10).
- شاشة الإدارة تتعمل في نفس الـ PR، زي الخدمات (PT-Q11).

**الإجابة: موافق على الكل.**

---

## حاجة فنية اتقررت من غير سؤال (TD-1)
قواعد صحة الباكدج موجودة أصلًا في قسم الطلبات، وقواعد المشروع مابتسمحش لقسم الكتالوج يستخدمها مباشرة. فقسم الكتالوج هياخد نسخة منها، ومعاها اختبارات مشتركة بنفس الأمثلة في القسمين، عشان النسختين مايختلفوش عن بعض أبدًا. ودي نفس الطريقة اللي اتعملت قبل كده في ADR-0035.
