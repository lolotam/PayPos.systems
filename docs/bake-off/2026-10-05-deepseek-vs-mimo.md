# DeepSeek 4.1 flash vs MiMo V2.6 Pro — head to head · مقارنة مباشرة

Companion to the [full bake-off report](2026-10-04-pr11-model-bakeoff.md). These are the two models that tied at the top
(39/60) on Phase 1 PR 11 (employee import). Same brief, same base commit (`6af8020`), one worktree each, no help.

ملحق لـ[تقرير المقارنة الكامل](2026-10-04-pr11-model-bakeoff.md). دول الموديلين اللي اتعادلوا في المركز الأول (39 من 60)
في PR 11 (استيراد الموظفين). نفس المهمة، ونفس نقطة البداية، وكل واحد في worktree لوحده.

---

## English

### 1. The numbers

| | DeepSeek 4.1 flash | MiMo V2.6 Pro | Better |
|---|---|---|---|
| Provider | `deepseek/deepseek-flash`, effort high | `openrouter/xiaomi/mimo-v2.6-pro`, default effort | — |
| Cost | **$0.61** | $1.89 | DeepSeek (3.1× cheaper) |
| Active minutes | **188** | 341 | DeepSeek (1.8× faster) |
| Runs needed (incl. infrastructure restarts) | **6** | 9 | DeepSeek |
| Input tokens | **1.09 M** | 2.98 M | DeepSeek |
| Output tokens | **105 K** | 119 K | DeepSeek |
| Reasoning tokens | **141 K** | 191 K | DeepSeek |
| Steps / tool calls | 368 / 587 | **343 / 524** | MiMo (slightly) |
| Lines changed | **3,248** | 4,383 | DeepSeek (smaller diff for the same coverage) |
| Production / test files | 45 / 13 | 70 / 9 | DeepSeek (more tests, fewer files) |
| Finished the task | Yes | Yes | tie |
| `pnpm check` re-run on a fresh database | ✅ green | ✅ green | tie |
| Own incidents (not infrastructure) | 1 corrupted session, 1 early turn-end (both recovered) | 3 "Session interrupted", 1 18-min stall, 1 failed provider switch | DeepSeek |

### 2. Quality (blind review, 0–10 each)

| Criterion | DeepSeek | MiMo |
|---|---|---|
| Coverage of the spec | 8 | 8 |
| Correctness | 5 | 5 |
| Architecture | 7 | 7 |
| Reuse of existing code | 5 | 5 |
| Tests | 7 | 7 |
| Docs (Arabic JSDoc, ADR, spec) | 7 | 7 |
| **Total** | **39** | **39** |
| P1 / P2 / P3 | 1 / 2 / 10 | 1 / 3 / 9 |

The totals are identical; the difference is in **what kind** of defect each one shipped.

### 3. Design choices — where they really differ

| Topic | DeepSeek | MiMo |
|---|---|---|
| Where the workbook is parsed | Synchronously in the API | **In a worker job** (async preview) — closer to the 200 ms rule |
| Where ExcelJS lives | `apps/api` | **`packages/documents`** — what CLAUDE.md §2.1 says |
| Commit | Synchronous in the API (later measured 470–634 ms for 500 rows) | Synchronous in the API |
| Database writes on commit | ~2,000 round trips for 500 rows | Batched |
| Scope discipline | Stayed inside the slice | **Changed code outside the slice** |

### 4. The serious defects

**DeepSeek — P1 inside the slice:** a 6.5 KB workbook with one cell at row 300,000 grows the API heap to ~500 MB,
because the row loop runs before the 500-row cap. Mechanical to fix (it was, in Codex round 1).
P2s: 2,000 round trips per commit; storage and parse failures surfaced as HTTP 500.

**MiMo — P1 outside the slice:** it removed the worker's notification transport while wiring its import worker, so
OTP and other messages would **never be sent**. A feature that already worked, and that nobody asked it to touch.
P2s: a preview race (COMMITTED → PREPARED) that allows a **double import**; preview ids answer 403 vs 404, which
leaks existence across tenants; a zip bomb still reaches the worker.

**Why the same score hides a real difference:** a P1 inside the slice is caught by the slice's own review. A P1 in an
unrelated module is the kind that slips through, because reviewers read the diff for the feature, not for everything
else it broke. That is the more dangerous failure class.

### 5. What each did better

| DeepSeek did better | MiMo did better |
|---|---|
| Cost and speed (a third of the price, about half the time) | Async parsing in the worker (the best architectural idea in the whole trial) |
| Stayed inside the slice | ExcelJS placed in `packages/documents` as the project rules say |
| Smaller, more focused diff; more test files | Batched writes on commit from the start |
| Fewer self-inflicted session failures | Fewer steps for the same coverage |

### 6. What happened after (DeepSeek only, as the winner)

DeepSeek's candidate went through six Codex fix rounds, three rounds of direct fixes by Claude and three review layers before merge. The review layers found
that **its design choice — parsing synchronously in the API with ExcelJS — was the root of most later P1s**: tiny
workbooks that make ExcelJS expand merged cells, data validations, defined names or column spans into millions of
objects. MiMo's choice (parse in the worker) would not have removed those attacks, but it would have moved them off
the request path, so a bad file could only slow a background job, not the API itself.

In hindsight: **DeepSeek won the race; MiMo had the better design.**

### 7. Recommendation

1. **Default implementer: DeepSeek 4.1 flash** for well-specified slices. It is cheap, fast, stays in scope, and its
   defects are local and fixable. Always follow it with Codex review + fix and a Claude review.
2. **Use MiMo V2.6 Pro for design**, not implementation. Before a slice that parses files, runs long work, or crosses
   the 200 ms line, ask MiMo for the architecture (read-only), then hand that design to DeepSeek to implement.
3. **Never let MiMo implement without a scope fence.** Its brief must list the files it may touch, and the review must
   diff everything outside that list.
4. For both: a green `pnpm check` on delivery means nothing about safety. Both shipped a P1 with green gates.

---

## العربي

### ١. الأرقام

| | DeepSeek 4.1 flash | MiMo V2.6 Pro | الأحسن |
|---|---|---|---|
| التكلفة | **0.61 دولار** | 1.89 دولار | DeepSeek (أرخص 3 مرات) |
| دقايق الشغل الفعلي | **188** | 341 | DeepSeek (أسرع حوالي الضعف) |
| عدد مرات التشغيل | **6** | 9 | DeepSeek |
| توكنز الـ input | **1.09 مليون** | 2.98 مليون | DeepSeek |
| توكنز الـ output | **105 ألف** | 119 ألف | DeepSeek |
| توكنز التفكير | **141 ألف** | 191 ألف | DeepSeek |
| الخطوات / استدعاء الأدوات | 368 / 587 | **343 / 524** | MiMo (بفرق بسيط) |
| السطور المتغيرة | **3,248** | 4,383 | DeepSeek (diff أصغر لنفس التغطية) |
| ملفات الإنتاج / الاختبارات | 45 / 13 | 70 / 9 | DeepSeek (اختبارات أكتر وملفات أقل) |
| خلّص المهمة | أيوه | أيوه | تعادل |
| `pnpm check` على داتابيز جديدة | ✅ أخضر | ✅ أخضر | تعادل |
| مشاكل التشغيل بسببه هو | جلسة باظت + وقف بدري مرة (اتعالجوا) | 3 مرات "Session interrupted" + وقف 18 دقيقة + فشل تغيير المزوّد | DeepSeek |

### ٢. الجودة (مراجعة مستقلة، من 10 لكل بند)

| البند | DeepSeek | MiMo |
|---|---|---|
| تغطية الـ spec | 8 | 8 |
| الصحة | 5 | 5 |
| المعمارية | 7 | 7 |
| إعادة استخدام الكود الموجود | 5 | 5 |
| الاختبارات | 7 | 7 |
| التوثيق | 7 | 7 |
| **المجموع** | **39** | **39** |
| P1 / P2 / P3 | 1 / 2 / 10 | 1 / 3 / 9 |

المجموع واحد بالظبط؛ الفرق في **نوع** الغلطة اللي كل واحد سلّمها.

### ٣. الفرق الحقيقي في التصميم

| الموضوع | DeepSeek | MiMo |
|---|---|---|
| قراءة ملف Excel فين | في الـ API مباشرة | **في worker job** — أقرب لقاعدة الـ 200 ملي ثانية |
| مكتبة ExcelJS فين | `apps/api` | **`packages/documents`** — زي ما CLAUDE.md بيقول |
| الحفظ | في الـ API مباشرة (اتقاس بعدين 470–634 ملي ثانية) | في الـ API مباشرة |
| الكتابة في الداتابيز | ~2000 رحلة لـ 500 صف | دفعات |
| الالتزام بحدود المهمة | فضل جوه المهمة | **غيّر كود برّه المهمة** |

### ٤. الأخطاء الخطيرة

- **DeepSeek — P1 جوه المهمة:** ملف Excel حجمه 6.5 كيلو فيه خلية في الصف 300 ألف بيخلّي الـ API ياكل ~500 ميجا رام. تصليحه
  سهل، واتصلّح فعلاً في جولة Codex الأولى. وكمان: 2000 رحلة للداتابيز في الحفظ، وأخطاء التخزين بترجع 500.
- **MiMo — P1 برّه المهمة:** وهو بيوصّل الـ worker بتاعه شال طريقة إرسال الإشعارات، فرسائل الـ OTP وغيرها **مكانتش
  هتتبعت خالص**. ميزة شغالة، ومحدش طلب منه يلمسها. وكمان: سباق في المعاينة يسمح **باستيراد مكرر**، ورد 403 مرة و404 مرة
  بيكشف وجود بيانات شركة تانية، وملف zip مضغوط بشكل خبيث بيوصل للـ worker.

**ليه نفس الدرجة بتخبّي فرق حقيقي:** غلطة جوه المهمة بتتمسك في مراجعة المهمة نفسها. لكن غلطة في جزء تاني خالص هي
اللي بتعدّي، لأن المراجع بيقرا الـ diff بتاع الميزة، مش كل حاجة تانية اتكسرت. ده النوع الأخطر.

### ٥. كل واحد كان أحسن في إيه

| DeepSeek أحسن في | MiMo أحسن في |
|---|---|
| التكلفة والسرعة (تلت السعر وحوالي نص الوقت) | قراءة الملف في الـ worker (أحسن فكرة معمارية في التجربة كلها) |
| الالتزام بحدود المهمة | مكان ExcelJS الصح في `packages/documents` |
| diff أصغر ومركّز، واختبارات أكتر | الحفظ على دفعات من الأول |
| مشاكل تشغيل أقل | خطوات أقل لنفس التغطية |

### ٦. اللي حصل بعد كده (DeepSeek بس، لأنه الفايز)

نسخة DeepSeek عدّت على 6 جولات تصليح من Codex و3 جولات تصليح مباشر من Claude و3 طبقات مراجعة قبل الـ merge. المراجعات بيّنت إن **اختياره يقرا الملف في
الـ API مباشرة بـ ExcelJS كان أصل معظم الـ P1 اللي ظهرت بعدين**: ملفات صغيرة بتخلّي ExcelJS يفرد خلايا مدموجة أو قواعد
تحقق أو أسماء معرّفة أو أعمدة لملايين العناصر. اختيار MiMo (القراءة في الـ worker) ماكانش هيمنع الهجمات دي، لكن كان
هيبعدها عن الـ API، فالملف الخبيث كان هيبطّأ job في الخلفية بس، مش السيرفر نفسه.

**بالنظر للخلف: DeepSeek كسب السباق، لكن MiMo كان تصميمه أحسن.**

### ٧. التوصية

1. **المنفّذ الأساسي: DeepSeek 4.1 flash** للمهام اللي الـ spec بتاعها واضح: رخيص وسريع وبيلتزم بالحدود، وأخطاؤه محلية
   وسهل تتصلّح. وبعده دايماً مراجعة وتصليح من Codex ومراجعة مني.
2. **MiMo V2.6 Pro للتصميم مش للتنفيذ:** قبل أي مهمة فيها قراءة ملفات أو شغل طويل أو قريبة من حد الـ 200 ملي ثانية، نطلب من
   MiMo التصميم (قراءة بس)، وبعدين DeepSeek ينفّذه.
3. **MiMo ما ينفّذش أبداً من غير حدود واضحة:** الـ brief بتاعه لازم يحدد الملفات المسموح يلمسها، والمراجعة لازم تفحص أي تغيير
   برّه القايمة دي.
4. **للاتنين:** `pnpm check` أخضر وقت التسليم مالوش علاقة بالأمان. الاتنين سلّموا P1 والـ gates خضرا.
