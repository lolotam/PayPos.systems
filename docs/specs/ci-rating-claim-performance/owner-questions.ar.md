# أسئلة المالك — إصلاح حواجز CI

التاريخ: 2026-11-10. القناة: محادثة المشروع، أداة السؤال. سؤال تقني؛ لا يُنشر على صفحة قرارات الشريك.

## CI-Q1 — توسيع النطاق المعزول

السؤال الحرفي:

> All four PRs are CI-blocked by worker performance failures; #911 also hit an admin race. Authorize separate CI-repair worktrees/PRs, one task at a time in the fifth slot, using Sol medium implementation and Astra advisory, without relaxing thresholds or mixing edits into the four current PRs?

الخيارات الحرفية:

1. `Approve repair (Recommended)` — Diagnose and repair each blocker in its own isolated PR; retain every quality gate.
2. `Keep blocked` — Leave all four draft PRs unchanged; start no additional repair work.

التوصية: الخيار الأول. إجابة المالك الحرفية:

> Approve repair (Recommended)

التطبيق: إصلاح أداء worker أولاً في worktree وPR مستقلين؛ إصلاح سباق admin في مهمة لاحقة بعد خلو الخانة الخامسة. لا تعديل على PRs #910/#911/#912/#913، ولا تخفيف حد أو assertion أو fixture. لا تفويض نشر أو تعديل خادم أو بيانات إنتاجية أو أسرار. مسار التفويض المدمج فقط؛ لا CLI بديل.

يبقى استثناء التخطيط Sol والمشورة Astra المعتمد للدفعة مرجع الأدوار لهذه المتابعة؛ لا استبدال نموذج غير مُعلن. السجل الأصلي للدفعة محفوظ خارج المستودع في `F:/Dev/Temp/opencode/pospay-batch-20261110/batch-receipt.md`.

## CI-Q2 — Redis محلي مؤقت للمهمة فقط

السؤال الحرفي:

> Authorize one disposable local Redis 7 container dedicated to this repair, with a loopback-only port, independently generated test credentials and no persistent volume, for focused correctness tests only? The performance suite stays CI-only; shared Redis and the four existing task environments remain off-limits.

الخيارات الحرفية:

1. `Approve private Redis` — Run focused correctness tests against a new task-owned local container; no production/server changes or performance-gate execution.
2. `CI verification only` — Create no local Redis; report local runtime verification unavailable and obtain correctness/performance evidence only through draft CI.

التوصية: الخيار الأول، لتشغيل اختبارات الصحة على Redis الحقيقي قبل نشر PR. الـharness الحالي يستخدم fallback مشترك عند غياب REDIS_URL؛ لن نشغّله بهذه الصورة ولن نعدّل إعداده المشترك.

إجابة المالك الحرفية عبر أداة السؤال في 2026-11-10:

> Approve private Redis

التطبيق: container محلي مؤقت واحد ببادئة وlabels للمهمة، منفذ loopback فقط وبيانات اختبار مولدة بصورة مستقلة، بلا volume دائم. اختبارات الصحة المحدودة فقط محلياً؛ مجموعة الأداء تبقى CI-only ولا تُجبر بواسطة CI=true. لا اتصال Redis مشترك أو تغيير خادم أو بيانات إنتاجية أو بيئة أي مهمة أخرى.

## CI-Q3 — فك انتظار worker وadmin مع بقاء الحواجز

الدليل: #914 نجح في worker **2276/2276** ومنها حواجز الأداء **6/6** بلا تغيير، لكن aggregate CI فشل في بوابة admin browser: **8 فشل / 3 نجاح**. لا root cause مثبت بعد، ولا نخلطها تلقائيًا مع unit race السابق. خمس PRs تشغل الخانات الخمس؛ admin مأذون سابقًا بعد خلو الخامسة فقط، و#914 لا يدمج قبل نجاح admin gate.

السؤال الحرفي:

> Worker CI now passes, but #914 is blocked by 8 admin-browser failures; the earlier admin unit-race also remains unresolved. All five slots are occupied, and admin work was approved only after the worker PR merges. Authorize expanding #914 into one CI-unblock PR covering these observed admin blockers as well—an explicit exception to separate-repair/one-use-case PR rules—while keeping five slots, #910–#913 untouched, and every quality gate unchanged?

الخيارات الحرفية:

1. `Expand #914 (Recommended)` — Diagnose admin failures first and review a bounded plan before edits. Keep every gate, the approved Sol/Astra lanes and five slots; no deployment.
2. `Keep separate and blocked` — Keep #914 worker-only; start no admin repair and make no extra push while awaiting another approved sequencing decision.

التوصية: الأول، كاستثناء صريح محدود للمهمة الحالية بدل فتح خانة سادسة أو تخفيف بوابة أو تعديل المهمات الأربع الأصلية. لا تعديل admin قبل التشخيص ومراجعة الخطة. الأداء والعتبات والتأكيدات لا تُخفّف. السؤال تقني للمالك فقط ولا يُنشر على صفحة الشريك.

إجابة المالك الحرفية عبر أداة السؤال في 2026-11-10:

> Expand #914 (Recommended)

التطبيق: استثناء صريح يسمح بجمع إصلاح worker وإصلاح عوائق admin المرصودة في PR #914 نفسه، مع بقاء الخانات خمسًا والمهمات الأربع #910–#913 بلا تعديل. تبدأ مرحلة admin بالتشخيص وكتابة خطة محدودة ومراجعتها شخصيًا قبل الكود، بمساري Sol/Astra المعتمدين. لا تخفيف بوابة أو threshold أو assertion، ولا E2E ثقيل محلي أو rerun بلا سبب أو merge أو deploy أو تعديل خادم/إنتاج/أسرار. تحديث التدقيق المحلي ليس correction push؛ يحفظ رأس دليل worker حتى تجميع إصلاح ذي صلة ومراجعته وفحصه.

## CI-Q4 — غياب نموذج Kimi القياسي في مسار التصحيح

الدليل في2026-11-10: بعد قبول handoff المصدر وبدء تصحيح نتائج CI الجديدة على15b4dc13، تنطبق قاعدة انتقال التصحيحات إلى Kimi بدل عامل initial. بحث المدير في catalog الحية، بدءًا من provider الحالي ثم البحث العام: لا يوجد `kimi-code-plan-global/k3.1-pro` القياسي المسمى في pipeline. المتاح المسمى صراحة `kimi-code-plan-global/k3.1-pro-highspeed`، وalias `kimi-code-plan-global/kimi-for-coding` لا يثبت هوية/سرعة النموذج القياسي. لم يُفوض أي منهما ولم يُفسر اختلاف model على أنه فشل quota أو availability يسمح بقفز تلقائي.

السؤال الحرفي:

> #914's next CI correction must use the Kimi correction lane after the accepted initial handoff. The live catalog offers Kimi K3.1 Pro Highspeed, not the approved standard-speed model. Which lane should this task use without silently changing model or speed?

الخيارات الحرفية:

1. `Enable standard Kimi (Recommended)` — Enable the approved standard-speed K3.1 Pro in the built-in model catalog; wait and verify its exact identity before dispatch.
2. `Authorize Sol correction` — For #914 only, authorize a fresh gpt-6.1-sol medium correction session at standard speed, retaining Astra review and the existing correction-round budget.
3. `Keep blocked` — Make no code changes or new CI push; leave the PR draft while the correction lane is unavailable.

التوصية: الأول، لحفظ pipeline وسرعة التنفيذ المتفق عليها. إجابة المالك الحرفية عبر أداة السؤال:

> Enable standard Kimi (Recommended)

تصحيح المدير بعد الإجابة: البحث الأول استعمل مرشح catalog الافتراضي newest-only؛ عند إعادة البحث بـ`all: true` ظهر النموذج المطلوب نفسه **`kimi-code-plan-global/k3.1-pro`** بحالةactive وvariants low/high/max، بجانبHighspeed. لذلك لم يكن غائبًا أو محتاجًا إلى إعداد جديد؛ السؤال كان غير لازم بسبب مرشح البحث، وهذا الخطأ محفوظ صراحة. لم يُعدل config/provider/credential، ولم تُستخدمHighspeed أو alias. يُستعمل القياسي نفسه بvariant high لمسار التصحيح القائم، لا استثناءSol. إجابة المالك لا تغير حدود النطاق أو الجولات أو CI ولا تفوضCDP أو sandbox/transport changes. السؤال تقني للمالك فقط، لا يُنشر على صفحة الشريك.

## CI-Q5 — فشل مصادقة Kimi مرتين دون كتابة

حاول المدير النموذج القياسيhigh في الجلسة `ses_e39f84b8effewnn9UiKL7Ozd5r` مرتين، مع التأكد من نهاية الأولى قبل الثانية. انتهتا بالخطأ الحرفي نفسه: `The API Key appears to be invalid or may have expired. Please verify your credentials and try again.` تحقق Git بعد المحاولة الثانية: لا تغييرات في كود admin أو وثائق العامل، فقط تدقيق المدير. لا تعديل credential أو قراءة secret أو sign-in آلي أو external CLI.

فحص المسارات التالية لم يثبت وجود transport تفويض Kimi CLI المسمى في pipeline داخل هذه البيئة. MiniMax-M3.1-Flash موجود على coding-plan لكن catalog لا تعرض له variant thinking المطلوبة؛ وجود النموذج على provider آخر لا يجيز نقله تلقائيًا. هذه حدود اكتشاف، لا ادعاء تجربة تلك المسارات أو نفاد quota لديها؛ لم يُرسل brief بديل.

السؤال الحرفي:

> Standard Kimi failed twice with an invalid/expired API-key error and made no edits. The next approved built-in fallback lanes are not exposed with their required transport/variant here. Restore the configured Kimi login, or authorize a fresh standard-speed Sol medium correction session for #914 only?

الخيارات الحرفية:

1. `Restore Kimi login (Recommended)` — Reauthenticate the configured Kimi provider yourself; leave implementation paused until you confirm, then retry the standard model.
2. `Authorize Sol fallback` — Permit a fresh gpt-6.1-sol medium correction session for #914 only, at standard speed; preserve Astra review, all gates and the existing correction-round budget.

التوصية: الأول لحفظ مسار التصحيح القياسي. إجابة المالك الحرفية عبر أداة السؤال:

> Restore Kimi login (Recommended)

التطبيق: التنفيذ متوقف حتى يعيد المالك المصادقة على provider Kimi القائم ويؤكد الجاهزية. اختيار الخيار ليس دليلًا على نجاح login؛ لا محاولة ثالثة قبل التأكيد. لا استبدال نموذج/provider أو تنفيذ جديد، ولا reset للجولات أو push/CI rerun. لا يُطلب إرسال API key في المحادثة. بعد التأكيد يُعاد التحقق بالنموذج القياسي نفسه وتبقى تجربة foreground ذات السطرين وحدها هي النطاق المأذون.

تأكيد المالك الحرفي اللاحق:

> I ALREADY REAUTH FOR KIMI CLI

استجاب المدير بprobe مصادقة فقط إلى الجلسة والنموذج القياسيين؛ لا قراءة/كتابة ملفات أو تنفيذ brief قبل نتيجته. هذا يتحقق من اتصال provider التفويض الحالي، لا يزعم اختبار CLI نفسها أو أن credential الخاصة بها تُستخدم في provider. لا إعادة مطالبة بlogin أو API key؛ نتيجة الاتصال هي الفيصل قبل استئناف التصحيح.

## CI-Q6 — توجيه مباشر لتبديل عامل التصحيح إلى GLM Coding Plan

توجيه المالك الحرفي:

> can u chang it to opencode  GLM  5.3 flash coding plane

التطبيق لهذه المهمة: استخدام GLM-5.3-Flash عبر Z.AI Coding Plan داخل تفويض OpenCode المدمج، بدل مسار Kimi المرفوض بالمصادقة. تحقق المدير من catalog الكاملة: **`zai-coding-plan/glm-5.3-flash`** active، وvariant **high** متاحة. عبارة Coding Plan اختيرت بدل نموذج `opencode/glm-5.3-flash-free` أو Highspeed أو provider مدفوعة بديلة؛ التوجيه هنا لا يغير default عام أو config أو credential ولا يفتح external CLI.

يشمل الإذن استثناء مسار تصحيح #914 الحالي فقط، بتجربة foreground ذات السطرين المراجعة سابقًا وسقف12 إضافية فوق657، مع Astra والفحوص والـ11 سيناريو وحدودها كما هي. لا reset للجولات أو slot سادس أو CDP/fixture/production permission إضافية. جلسة Kimi السابقة انتهت بفشل بلا كتابة؛ يبدأ عامل GLM جديد داخل المهمة نفسها. نجاح الوصول إلى النموذج أو التنفيذ لا يُفترض قبل نتيجة الأداة.

## CI-Q7 — تجربة CDP ضيقة لتعطيل override التركيز الاختباري فقط

الدليل بعد نشر تجربة foreground ذات السطرين: run42863036938 علىe3cb06cd بقي browser8فشل/3نجاح؛ أربع حالات ظلتvisible بدلhidden بلا focus/visibility events، وclosed blank أُغلقت فعليًا لكن parent بلا أحداث والزرdisabled. worker2276/2276 والأداء6/6 نجحا وكل check/API/build/images ناجحة. لا إعادة تشغيل بلا تغيير. مشورة Astra السابقة أوصت بتجربة foreground أولًا ثم تعطيل emulation فقط إذا بقي الفشل؛ الشرط تحقق الآن. تحقق المدير من API المثبتة `BrowserContext.newCDPSession` و`Emulation.setFocusEmulationEnabled({ enabled: boolean })`، التي تصف محاكاة صفحةfocused/active. هذا اقتراح تجربة counterfactual، لا سبب runtime مثبت قبلها.

السؤال الحرفي:

> Explicit foreground selection did not restore native focus/visibility events: #914 still has 8 browser failures. Authorize a test-scoped CDP experiment that disables only Playwright's focus-emulation override for participating pages/popups, while retaining all 11 scenarios, native hidden/visible/event assertions, timeouts and retries? Keep production, sandbox flags and transport fixtures unchanged, with the combined diff capped at 700 lines.

الخيارات الحرفية:

1. `Approve scoped CDP (Recommended)` — GLM Coding Plan implements the bounded test-only change; parent checks and Astra reviews before one relevant CI push. Await setup, reset observation counters afterward, and clean up sessions. No synthetic focus/visibility events.
2. `Keep blocked` — Leave e3cb06cd unchanged; no CDP modification or new CI push.

التوصية: الأول لإزالة override الاختبار التي تدعمها أدلة المصدر والرصد، مع إبقاء البرهان native نفسه. target20–40 إضافة+حذف، توقف41 فوق659، إجمالي<=700/hard800؛ أي تجاوز أو launch/fixture/sandbox تغيير يحتاج مراجعة أخرى قبل الكود. النطاق E2E فقط مع وثائق المهمة، بلا runtime/worker/API/auth/readiness تعديل. إجابة المالك الحرفية عبر أداة السؤال:

> Approve scoped CDP (Recommended)

التطبيق: worker GLM Coding Plan القائم يعدل E2E وملفات توثيقه المسموح بها فقط؛ يهيئtargets بawait بعدinitialization، ويعطلfocus emulation وحدها، ويثبتparent foreground ثم يصفرعداداتالرصد بعدالتهيئة؛ تُحسب بعد ذلك native transitions الحقيقية فقط، وتُنظفsessions دون حجب assertion الأصلية. لا eventdispatch أو visibility/propertyoverride أو تغييرassertion/timeouts/retries، ولا توسيعLogobserver/transport/sandbox/launch permissions. لا reset للجولات؛ هذا إن نُشر سيكون التصحيح التالي بعد رأسي15b4dc13 وe3cb06cd، وليس task جديدة أو تصريحًا غير محدود بتكرارCI. يبقى قبولnetwork/sandbox غير مثبت.

## CI-Q8 — إذن مباشر باستمرار #914 مع profiling وسقف800

توجيه المالك الحرفي في محادثة المشروع،2026-11-10:

> Authorize the recommended next step for #914 only:
> 1. Raise the combined soft source ceiling from 700 up to the existing 800-line hard limit for #914 only (keep #910–#913 untouched and retain the 5-slot cap).
> 2. Authorize a bounded, manager/Astra-reviewed CI-profiling scope (and subsequent reviewed repair rounds if needed for worker max-latency and remaining admin browser sandbox/transport blockers) using zai-coding-plan/glm-5.3-flash#high for implementation and openai/gpt-6-astra#high for advisory and actual-diff review.
> 3. Grant explicit execution and CI push budget for the reviewed rounds while preserving all thresholds, warmups, sample counts, timeouts, retries, all 11 browser scenarios/assertions, and all quality/merge gates unchanged.
> Proceed immediately with planning, Astra review, and the next consolidated CI step.

التطبيق: هذا إذن متابعة صريح للمهمة نفسها يتجاوز منعpush رابع التلقائي السابق، لا محو لتاريخ الجولات. بقيت ثلاثةpushes تصحيحية بعدinitialworker منشورة حتى89bf8c6b؛ أولpush متابعة جديد سيكون الرابع تاريخيًا. يحجز المدير الآن حدًا تنفيذيًا متحفظًا أقصاه **ثلاثةpushes متابعة مجمعة ومراجعة** تشملprofiling أولًا ثم إصلاحات مثبتة عند الحاجة؛ يسجل الاستهلاك ولا يتجاوزها دون قرار جديد. لاpush لكلfinding، ولاrerun بلا هدف دليل وتغيير مراجع. تبقى النماذج المحددة نفسها، Astra للمشورة ومراجعةdiff حقيقية مستقلة، وGLM للتنفيذ عبر التفويض المدمج فقط.

السقف الجديد **800 إضافة+حذف لكل المصدر غير التوثيقي** في#914 مقابلbase؛ يشمل fixtures والاختبارات وworkflow وأيscript تشخيصي، بلا إخفاءإعادةتنسيق أو استبعادملفconfiguration. الحالة الحالية693، فالمتبقي107. لا تعديلالأربعةالأصلية أو قواعدها ولاslot سادسة أوexternalreview trigger أوmerge/deploy/server/production/secret. تبقى كلthresholds و20warmups/100samples و75settlements وحدود100/50ms والـtimeouts/retries وكل11سيناريو وتأكيداها كما هي.

أول نطاق مقترح فيplan §24: الإبقاء علىworker suite الطبيعي بوابةً غيرinstrumented؛ خطوةprofiling إضافية منفصلة فيCI#914 فقط، موسومةتشخيصية لا قبولًا، تجمعtimings خارجالفترة المقاسة ورصدGC ومددRedisSLOWLOG المنقاة دون تغييرRedisconfig أوكشفarguments. السماح بـbuild/browser التشخيصيين لـ#914 عندفشلworker فقط معبقاءci-gate يشترطنجاحworker؛ لا reuse لإذن#909، بل نطاقجديد تحتCI-Q8 يراجعAstra قبلالكود. لا إصلاحworker أوsandbox/transport ضمنهذاpushالأول؛ النتائج تحكم خطةالجولةالتالية.
