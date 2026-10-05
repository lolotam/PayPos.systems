# Model bake-off — Phase 1 PR 11 (employee import) · مقارنة الموديلات

Date: 2026-10-04 · Task: Phase 1 PR 11 — import framework + employee import (XLSX template, upload through the
files flow, preview valid 24 h and single-use, all-or-nothing commit with Idempotency-Key + audit + outbox,
permission + existence oracle, 200 ms rule, admin UI ar/en, tests). Same brief, same base commit (`6af8020`),
one git worktree per model, no help between models.

---

## English

### 1. Contestants

| Model | Provider in OpenCode | Effort |
|---|---|---|
| GLM 5.3 flash | `zai-coding-plan/glm-5.3-flash` (Z.AI coding plan) | high |
| DeepSeek 4.1 flash | `deepseek/deepseek-flash` | high |
| Space Bunny Alpha | `openrouter/stealth/space-bunny-alpha` (free) | default |
| Xiaomi MiMo V2.6 Pro | `openrouter/xiaomi/mimo-v2.6-pro` | default |
| Qwen 3.8 27B | `openrouter/qwen/qwen3.8-27b` | default |

### 2. Cost, tokens, speed

Active minutes = sum of (last event − first event) over every run of that model; restarts caused by the shared
infrastructure are included as separate runs.

| Model | Runs | Active min | Steps | Tool calls | Input tokens | Output tokens | Reasoning tokens | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|---|---|
| DeepSeek 4.1 flash | 6 | **188** | 368 | 587 | 1.09 M | 105 K | 141 K | 98.7 M | **0.61** |
| MiMo V2.6 Pro | 9 | 341 | 343 | 524 | 2.98 M | 119 K | 191 K | 90.3 M | 1.89 |
| Space Bunny Alpha | 4 | 440 (stopped) | 970 | 1,055 | 5.70 M | 359 K | — | 307.8 M | 0 (free) |
| GLM 5.3 flash | 5 | 199 (quota) | 326 | 509 | 1.32 M | 53 K | 77 K | 68.5 M | 0 (plan) |
| Qwen 3.8 27B | 7 | 146 | 236 | 455 | 4.62 M | 49 K | 331 K | 47.3 M | 6.99 |

### 3. Delivered code

| Model | Lines changed | Production files | Test files | Finished? |
|---|---|---|---|---|
| DeepSeek | 3,248 | 45 | 13 | Yes |
| MiMo | 4,383 | 70 | 9 | Yes |
| Bunny | 5,228 | 55 | 9 | No — stopped at the time cap |
| GLM | 3,261 | 62 | 7 | No — Z.AI 5-hour quota |
| Qwen | 2,054 | 39 | 5 | No — disqualified |

### 4. Quality (independent blind review, 0–10 each)

| Model | Coverage | Correctness | Architecture | Reuse | Tests | Docs | **Total /60** | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|---|---|---|
| DeepSeek | 8 | 5 | 7 | 5 | 7 | 7 | **39** | 1 | 2 | 10 |
| MiMo | 8 | 5 | 7 | 5 | 7 | 7 | **39** | 1 | 3 | 9 |
| Bunny | 5 | 5 | 7 | 6 | 6 | 6 | **35** | 2 | 6 | 7 |
| GLM | 4 | 2 | 3 | 5 | 3 | 5 | **22** | 7 | 7 | 7 |
| Qwen | — | — | — | — | — | — | **DQ** | — | — | — |

`pnpm check` re-run independently on a fresh database: DeepSeek **green**, MiMo **green**, Bunny **red** (stale
generated `schema.d.ts`, plus two leave tests broken by a wall-clock fixture bug that was on main at the time),
GLM does not compile, Qwen not run.

### 5. Main errors and missing pieces

| Model | Most serious problems |
|---|---|
| DeepSeek | P1: a 6.5 KB workbook with one cell at row 300,000 grows the API heap to ~500 MB (row loop runs before the 500-row cap). P2: 2,000 DB round trips for a 500-row commit; storage/parse failures surface as HTTP 500. |
| MiMo | P1: regression **outside** the task — removed the worker notification transport (OTP messages would never send). Preview race allows a double import; 403/404 existence oracle; zip bomb reaches the worker. Good idea: parse in the worker, exceljs in `packages/documents`. |
| Bunny | P1: the feature is dead end-to-end (upload owned by `staff` requires `read:files:business`, import requires `manage:employees:business`). No admin UI. Unbounded grid in the worker; transient errors become permanent; 461 ms for a 500-row commit. |
| GLM | Does not compile; deleted the PR 13 seeding consumer; the READY path throws; commit always refuses; no UI, no integration tests; ADR claims things the code does not do. |
| Qwen | Ended its turn early three times, its sessions died on resume; a 414-line file in `packages/domain`. |

### 6. Reliability incidents (not counted against the models when caused by infrastructure)

- 12:15 the shared OpenCode background service crashed and killed all five runs → moved to `--standalone`.
- 12:50–16:30 the orchestrating Claude Code session was down → all runs restarted with a "continue your own work" brief.
- DeepSeek: one corrupted session after the crash, one early turn-end → both recovered.
- MiMo: three "Session interrupted: shutdown", one 18-minute stall, one failed provider switch (`xiaomi/…` direct: insufficient balance).
- Qwen: three early turn-ends, sessions dying on resume → disqualified.
- GLM: Z.AI 5-hour quota exhausted at 64 files.
- Bunny: slowest by far; stopped at the time cap at the owner's request.

### 7. Verdict and recommendation

**Winner: DeepSeek 4.1 flash.** It ties MiMo on quality (39/60) but costs a third ($0.61 vs $1.89), finished in about
half the time (188 vs 341 active minutes), had the fewest incidents, and its only P1 is inside the slice and
mechanical to fix. MiMo's P1 broke a working feature outside the slice, which is the more dangerous failure class.

Recommendation for the project:

1. **DeepSeek 4.1 flash as a cheap first-draft implementer** for well-specified slices, always followed by the
   Codex review + fix pass and the Claude review. Do not merge any of these models' output unreviewed: every
   candidate had at least one P1.
2. **MiMo V2.6 Pro as a second opinion on design** (its worker-side parse and `packages/documents` placement were the
   best architecture ideas in the trial), not as the primary implementer.
3. **Bunny** is free but too slow and incomplete for slice work; usable for small isolated tasks.
4. **GLM 5.3 flash** is not ready for this codebase at this effort level; **Qwen 3.8 27B** is not usable headless.
5. Codex (gpt-6.1-sol high) stays the reviewer and the fixer; the Codex PR bot is the third layer.

### 8. Pipeline applied to the winner

The DeepSeek candidate was kept as delivered (first commit on the PR branch) and then went through the three layers.

| Step | Who | What happened |
|---|---|---|
| Merge with main | Claude | Conflicts resolved against main; migrations renumbered (0077/0078) and the ADR renumbered to 0034. |
| Layer 1, round 1 | Codex (gpt-6.1-sol, high) | Fixed the blind-review findings: P1 bounded XLSX/ZIP reading (sparse-row cap, compressed and decompressed size limits); P2 batched commit writes (employees, audit rows and outbox events in a few statements instead of ~2,000 round trips); P2 storage and parse failures became named bilingual 422/503 errors; authorization moved before the idempotency claim; staff row rules became pure domain functions. |
| Layer 1, round 2 | Codex | Profiling showed the 500-row commit still took 470–634 ms, over the project's 200 ms rule, so the commit moved to a **worker job**: the API answers 202 and writes an outbox event, the worker commits all-or-nothing, and the admin screen polls the status. |
| Layer 2, review | Claude | **Changes requested**: P2 a request could stay "pending" forever (no recovery, no client deadline); P2 staff rules had been moved into the shared kernel `packages/domain`; ten P3s (expiry clock, 5 MiB cap, document file types, missing index, status CHECKs, dead code, cross-app test imports, BOMs, ADR wording). |
| Layer 1, round 3 | Codex | Fixed all twelve: a worker sweep fails requests stuck past 10 minutes without touching one that committed concurrently; the admin stops polling after 2 minutes; the shared kernel restored byte-for-byte; migration 0080 for indexes and CHECKs; warm 500-row preview measured at ~89 ms. |
| Layer 2, confirm | Fresh Claude reviewer | Every earlier finding confirmed fixed. One new P2: the "taking longer" message told the user to preview again, which could import every employee twice. Fixed by Claude with three P3s (constraint validation in its own migration, a `requested_at` CHECK, guarded `sessionStorage`). |
| Layer 3, review | Codex CLI (the GitHub Codex bot was out of quota) | **Changes requested**: two P1s the first two layers missed. A tiny workbook declaring a huge merged range makes ExcelJS allocate millions of cells; a crafted ZIP lets the guard and ExcelJS read different file indexes. Plus three P2s (two clock readings around expiry; a branch whose English and Arabic names match becomes unfindable; changing the file keeps the old preview committable). |
| Layer 1, rounds 4–6 + Claude | Codex, Claude | Each confirm round found another way ExcelJS expands a declared number: data validations, defined names, column spans, a `>` hidden in a quoted attribute, row numbers, `sheetId`. The design changed twice: first one aggregate expansion budget instead of a rule per tag, then the guard parsing with the same XML parser ExcelJS uses (`saxes`), so the guard and the loader can no longer disagree. The last confirm ended with a complete inventory of ExcelJS's load path. |
| Layer 3, CI | GitHub Actions | Green on every pushed head; merged only with CI green on the final commit. |

**What the pipeline caught that the model missed:** one P1 (memory blow-up from a tiny workbook), a 200 ms rule
violation that needed a different architecture (synchronous commit → worker job), an unbounded "pending" state, a
shared-kernel boundary violation, a message that would have caused duplicate imports, and a family of upload attacks (a few KB of Excel that makes the API allocate millions of objects) that took six fix rounds and a parser change to close. None of these would have
been visible from a green `pnpm check` alone: the candidate's own gates were green on day one.

**Cost of the review layers:** Codex ran six implementation rounds and five read-only reviews on the owner's subscription (no per-token bill);
Claude ran two reviews, the decisions, and three rounds of direct fixes. The candidate added 4,049 lines (excluding generated
files); the review-and-fix layers then added 4,853 and removed 775, for a final 8,208-line diff.

---

## العربي

### ١. الموديلات اللي اتسابقت

نفس المهمة بالظبط (PR 11 — استيراد الموظفين من Excel) لخمس موديلات. كل موديل في
worktree لوحده، ومن نفس نقطة البداية (`6af8020`).

| الموديل | المزوّد | المجهود |
|---|---|---|
| GLM 5.3 flash | Z.AI coding plan | high |
| DeepSeek 4.1 flash | DeepSeek | high |
| Space Bunny Alpha | OpenRouter (مجاني) | افتراضي |
| MiMo V2.6 Pro | OpenRouter | افتراضي |
| Qwen 3.8 27B | OpenRouter | افتراضي |

### ٢. التكلفة والتوكنز والسرعة

| الموديل | دقايق شغل فعلي | Input | Output | التكلفة |
|---|---|---|---|---|
| DeepSeek | **188** | 1.09 مليون | 105 ألف | **0.61 دولار** |
| MiMo | 341 | 2.98 مليون | 119 ألف | 1.89 دولار |
| Bunny | 440 (اتوقف) | 5.70 مليون | 359 ألف | مجاني |
| GLM | 199 (خلص الكوتة) | 1.32 مليون | 53 ألف | ضمن الاشتراك |
| Qwen | 146 | 4.62 مليون | 49 ألف | 6.99 دولار |

### ٣. الجودة (مراجعة مستقلة، من 60)

| الموديل | المجموع | P1 (خطير) | P2 (مهم) | P3 (بسيط) | `pnpm check` |
|---|---|---|---|---|---|
| DeepSeek | **39** | 1 | 2 | 10 | ✅ أخضر |
| MiMo | **39** | 1 | 3 | 9 | ✅ أخضر |
| Bunny | **35** | 2 | 6 | 7 | ❌ أحمر |
| GLM | **22** | 7 | 7 | 7 | ❌ مش بيعمل compile |
| Qwen | مستبعد | — | — | — | — |

### ٤. أهم الأخطاء والنواقص

- **DeepSeek:**
  - ملف Excel حجمه 6.5 كيلو، فيه خلية واحدة في الصف 300 ألف، بيخلّي السيرفر ياكل ~500 ميجا رام.
  - الـ commit بيعمل 2000 رحلة للداتابيز لـ 500 صف.
  - أخطاء التخزين بترجع 500 بدل رسالة واضحة.
- **MiMo:**
  - بوّظ حاجة **برّه المهمة**: رسائل الـ OTP مكانتش هتتبعت.
  - فيه احتمال استيراد مزدوج، وتسريب وجود السجلات (403/404).
  - بس فكرته إن قراءة الملف تحصل في الـ worker كانت أحسن فكرة معمارية في التجربة.
- **Bunny:**
  - الميزة كلها مش شغالة من أولها لآخرها (تعارض صلاحيات في رفع الملف).
  - مفيش شاشة أدمن، وبطيء جداً.
- **GLM:**
  - الكود مش بيعمل compile، ومسح consumer من PR 13.
  - مفيش UI ولا اختبارات، والـ ADR فيه كلام مش موجود في الكود.
- **Qwen:**
  - وقف شغله بدري 3 مرات، والجلسات ماتت.

### ٥. الحكم والتوصية

🏆 **الفايز: DeepSeek 4.1 flash.** متعادل مع MiMo في الجودة (39/60)، لكن:

- **تلت التكلفة:** 0.61 دولار قصاد 1.89.
- **تقريباً ضعف السرعة:** 188 دقيقة قصاد 341.
- **أقل مشاكل تشغيل.**
- **الـ P1 بتاعه جوّه المهمة وسهل يتصلّح.** أما MiMo فكسر ميزة شغالة برّه المهمة، وده أخطر.

التوصية:

1. **DeepSeek:** منفّذ أولي رخيص للمهام اللي الـ spec بتاعها واضح، وبعده دايماً Codex يراجع ويصلّح، وبعده مراجعتي. مفيش موديل فيهم يتعمله merge من غير مراجعة، لأن كل واحد طلع عنده P1 على الأقل.
2. **MiMo:** رأي تاني في التصميم والمعمارية، مش منفّذ أساسي.
3. **Bunny:** مجاني لكن بطيء ومش بيكمّل. ينفع للمهام الصغيرة المعزولة بس.
4. **GLM وQwen:** مش جاهزين لمشروع بالحجم ده دلوقتي.
5. **Codex:** يفضل المراجع والمصلّح، وبوت Codex على الـ PR هو الطبقة التالتة.

### ٦. اللي حصل للفايز في البايبلاين

نسخة DeepSeek اتحفظت زي ما سلّمها (أول commit في الفرع)، وبعدين عدّت على التلات طبقات:

| الخطوة | مين | اللي حصل |
|---|---|---|
| دمج مع main | Claude | حل التعارضات، وإعادة ترقيم الـ migrations (0077/0078) والـ ADR بقى 0034. |
| الطبقة 1، الجولة 1 | Codex | صلّح ملاحظات المراجعة: الـ P1 (قراءة Excel بحدود)، الحفظ بقى دفعات بدل ~2000 رحلة للداتابيز، أخطاء التخزين بقت رسائل واضحة بالعربي والإنجليزي (422/503)، والصلاحية بتتفحص قبل حجز الـ Idempotency-Key. |
| الطبقة 1، الجولة 2 | Codex | القياس طلّع إن حفظ 500 صف بياخد 470–634 ملي ثانية، أكتر من قاعدة الـ 200 ملي ثانية، فالحفظ اتنقل لـ **worker job**: الـ API بيرد 202، والـ worker بيحفظ الكل أو ولا حاجة، وشاشة الأدمن بتتابع الحالة. |
| الطبقة 2، مراجعة | Claude | **مطلوب تعديلات:** طلب ممكن يفضل "قيد الانتظار" للأبد، وقواعد الموظفين اتحطت غلط في `packages/domain` المشتركة، و10 ملاحظات بسيطة. |
| الطبقة 1، الجولة 3 | Codex | صلّح الـ 12: الـ worker بيقفل أي طلب متعلّق أكتر من 10 دقايق كفشل، الشاشة بتبطّل انتظار بعد دقيقتين، الـ kernel المشترك رجع زي ما كان، migration 0080 للفهارس والقيود، والمعاينة لـ 500 صف بقت ~89 ملي ثانية. |
| الطبقة 2، تأكيد | مراجع Claude جديد | أكّد إن كل الملاحظات اتصلّحت. لقى P2 جديدة: رسالة "الاستيراد متأخر" كانت بتقول للمستخدم يعمل معاينة تاني، وده كان ممكن يستورد كل الموظفين مرتين. Claude صلّحها ومعاها 3 ملاحظات بسيطة. |
| الطبقة 3، مراجعة | Codex من الـ CLI (بوت GitHub خلص رصيده) | **مطلوب تعديلات**: P1 اتنين الطبقتين الأولانيين فوّتوهم: ملف صغير بيعلن نطاق دمج ضخم فـ ExcelJS يحجز ملايين الخلايا، وملف ZIP متلاعب فيه يخلّي الفحص وExcelJS يقروا فهرس مختلف. و3 P2. |
| الطبقة 1، الجولات 4–6 + Claude | Codex وClaude | كل مراجعة تأكيد لقت طريقة تانية ExcelJS بيفرد بيها رقم معلَن: قواعد التحقق، الأسماء المعرّفة، الأعمدة، علامة `>` مستخبية في قيمة، أرقام الصفوف، `sheetId`. التصميم اتغيّر مرتين: ميزانية واحدة لكل التوسعات بدل قاعدة لكل وسم، وبعدين الفحص بقى بنفس قارئ XML اللي ExcelJS بيستخدمه (`saxes`) فمفيش اختلاف بينهم. آخر مراجعة خلصت بجرد كامل لمسار التحميل في ExcelJS. |
| الطبقة 3، CI | GitHub Actions | أخضر على كل commit اتعمله push؛ والـ merge بس لما يبقى أخضر على آخر commit. |

**البايبلاين مسك إيه الموديل فوّته:** P1 (ملف صغير بياكل رام السيرفر)، كسر قاعدة الـ 200 ملي ثانية واللي احتاج تغيير
في التصميم كله، حالة "انتظار" ملهاش نهاية، كسر حدود الـ kernel المشترك، ورسالة كانت هتعمل استيراد مكرر، ومجموعة هجمات رفع ملفات (ملف Excel كام كيلو يخلّي الـ API يحجز ملايين العناصر) احتاجت 6 جولات تصليح وتغيير قارئ الـ XML عشان تتقفل. ولا حاجة من
دول كانت هتبان من `pnpm check` الأخضر لوحده؛ الموديل سلّم gates خضرا من أول يوم.

**تكلفة طبقات المراجعة:** Codex عمل 6 جولات تنفيذ و5 مراجعات قراءة بس على اشتراك صاحب المشروع (من غير فاتورة توكنز)، وClaude عمل مراجعتين والقرارات و3 جولات تصليح مباشر. الموديل ضاف 4,049 سطر (من غير الملفات المولّدة)، وطبقات المراجعة والتصليح ضافت 4,853 وشالت 775، والـ diff النهائي 8,208 سطر.
