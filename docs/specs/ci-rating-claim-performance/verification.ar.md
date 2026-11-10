# سجل المدير — إصلاح أداء rating claim state

التاريخ: 2026-11-10. الحالة الحالية: نجح worker في draft #914 على الرأس `89dd5cb7def2825a49fe44712f1790fdfecc57c4`، بما فيه الأداء غير المعدل، لكن aggregate CI فشل في admin browser. وافق المالك في CI-Q3 على توسيع #914 المحدود؛ تشخيص وخطة admin قيد العمل قبل أي كود. لا جاهزية دمج أو نشر. الأقسام التالية تحتفظ بتسلسل الإيصالات السابقة.

## الصلاحية والعزل

- موافقة CI-Q1 في [سجل المالك](owner-questions.ar.md): مهمة إصلاح واحدة في الخانة الخامسة، PR مستقل، لا تعديل على #910/#911/#912/#913 ولا تخفيف أي حاجز. سباق admin في مهمة لاحقة.
- راجع المدير شخصيًا spec وplan والتشخيص ومشورة Astra المستقلة قبل التفويض. التنفيذ Sol `gpt-6.1-sol` بجهد medium، النقل المدمج فقط، ضمن استثناء التخطيط والمشورة المعتمد للدفعة.
- وافق المالك على CI-Q2: Redis محلي مؤقت واحد لاختبارات الصحة المحدودة فقط. أنشأ المدير `pospay-test-rating-claim-ci-repair-20261110` عند `127.0.0.1:54896`، Redis `7.4.11`، image `sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499`.
- تحقق المدير من task/worktree labels، ومعرف container الثابت، وربط loopback الوحيد، و`/data` على tmpfs، وعدم وجود volume بيانات دائم. PING أعاد PONG. بيانات الاختبار ولّدت بصورة مستقلة وحفظت خارج المستودع بلا طباعة؛ لا نسخ environment أو اتصال Redis مشترك أو قاعدة بيانات أو خادم إنتاجي.
- runner خارجي خاص بالمهمة يتحقق من الملكية والربط قبل كل تشغيل، ويزيل CI واتصالات Redis/Postgres الموروثة، ثم يمرر Redis الخاص فقط وDB URL إلى منفذ مغلق. إعداد Vitest خارجي يجمع ثمانية ملفات Redis correctness مسماة ويزيل global setup الخاص بـPostgres غير المستخدم. لا mock أو تغيير للاختبارات القائمة أو للـtimeouts أو لإعداد متعقب.

## RED الحقيقي قبل التنفيذ

تكررت خمسة إخفاقات في مجموعة `rating-claim-state-performance.spec.ts` على main وعلى PRs الأربعة، كما يسجل [التشخيص](diagnosis.ar.md). أقرب رأس #913 في run `42773070284`، job `129685193847`: خمسة فشل و2240 نجاح. المقارنات الأربع `35.071205 > 17.091232`، `50.067554 > 50`، `35.677188 > 19.795352`، `93.264199 > 50` ms، والحالة الخامسة near-cap RETRY تجاوزت `20000ms` للاختبار الكامل. لم تُعَد هذه البوابة محليًا ولم يُفترض أن الحمل سببها.

المصدر يثبت إعادة ترميز كاملة يمكن تجنبها؛ مقدار مساهمتها في زمن CI ما زال فرضية. اختبارات الصحة الجديدة توصيف لسلوك صحيح قائم وليست RED وظيفية مصطنعة.

## أوامر المدير قبل تعديل الإنتاج

| الأمر | النتيجة الفعلية |
| --- | --- |
| `pnpm install --frozen-lockfile` | نجح، 30.6 ثانية، بلا تعديل lockfile |
| `pnpm --filter '@pospay/worker^...' --workspace-concurrency=1 run build` | نجح؛ prerequisites للحزم فقط، لا build تطبيقات أو اختبارات ثقيلة |
| runner صحة خاص بالمهمة، وضع `new` | ملف جديد واحد، 31/31 نجاح، 1.62 ثانية، exit 0 |
| runner صحة خاص بالمهمة، وضع `group` | ثمانية ملفات، 458/458 نجاح، 14.80 ثانية، exit 0، بلا skipped |

راجع المدير كل أسطر ملف الاختبار الجديد قبل تشغيله. كانت `rating-claim-state-validate.lua.ts` بلا تعديل في التشغيلين. الأوامر الأخيرة تستخدم `run-rating-ci-correctness.mjs` والإعداد `rating-ci-local.config.mjs` في مجلد الدفعة الخارجي؛ ليست واجهة تشغيل جديدة في المستودع. أثبتت ضوابط Redis الفعلية توافق الأرقام الصحيحة ذات أقل من 15 خانة على المسار native، وفقد دقة native عند `100000000000001` وإشارته السالبة، مع حفظ exact لكل حدود MAX_SAFE. لا يُستنتج من زمن مجموعة الصحة نجاح بوابة الأداء.

## أول تحقق بعد التنفيذ

قرأ المدير diff الـhelper كاملًا قبل التنفيذ. المسار الجديد يفحص كل جدول ومفتاح وقيمة متداخلة بعد قبول cjson؛ الأرقام خارج الحد أو الصفر السالب أو شكل غير متوافق يستخدم renderer الدقيق القائم. لا تعديل settle أو الاختبارات القائمة أو إعدادات cjson أو السور والكتابة.

- إعادة correctness بعد التعديل: **458/458 نجاح، ثمانية ملفات، صفر skipped، exit 0**، مدة `16.63 s`. السجل: `sh_1c46ed1c800110f99c6czPiy6B.out` في أرشيف shell الخاص بالجلسة. هذه ليست عينة أداء.
- `pnpm --filter @pospay/worker run typecheck`: نجح.
- `pnpm --filter @pospay/worker run lint`: **فشل بخطأين**: dynamic delete في الاختبار الجديد (`no-dynamic-delete`)، وتعليق عربي داخل نص Lua المضمن (`no-restricted-syntax`). تنبيهات boundaries القائمة ظهرت أيضًا. العامل الأصلي كُلّف بتصحيح هذين الموضعين فقط؛ لا تعطيل lint أو تبديل إعداد أو نقل دين إلى i18n.
- تدقيق changed paths للمهمات الخمس: صفر overlap، والـworktrees الأربعة الأصلية نظيفة ورؤوسها لم تتغير.

## تحقق المدير بعد تصحيحَي lint

راجع المدير diff التصحيح: نفس حذف `ownerToken` و`leaseUntil` و`turnStartedAt` بمفاتيح ثابتة، وسبب عربي في JSDoc خارجي بدل string مع تعليقَي Lua بالإنجليزية. لا تغيير runtime أو assertion أو إعداد. راجع clean-code/test guards مع الفحوص الفعلية التالية:

| الأمر | النتيجة الجديدة |
| --- | --- |
| `node F:/Dev/Temp/opencode/pospay-batch-20261110/run-rating-ci-correctness.mjs group` | **458/458**، ثمانية ملفات، صفر skipped، exit 0، **21.48s**؛ ليست قياس أداء |
| `pnpm --filter @pospay/worker run lint` | نجح، تنبيهات boundaries القائمة فقط |
| `pnpm --filter @pospay/worker run typecheck` | نجح |
| `pnpm exec prettier --check` للملفين ومجلد مواصفات المهمة | نجح |
| `pnpm lint:docs` | صفر أخطاء، 29 تنبيه TODO قائمة |
| `pnpm module-map:check` | `module map: ok` |
| `git diff --check` | نجح |

سجل correctness الجديد `sh_1c472b1e900288Ixb8HCZzB1WC.out` في أرشيف shell الخاص بالجلسة. راجع المدير فرق الإنتاج وعدّ الملفات: helper **54 إضافة + 6 حذف**، اختبار جديد **205 إضافة**، مجموع الإنتاج والاختبارات **265** داخل هدف 400 وحد أقصى 800. ملفات settle وperformance/harness وworkflows وlockfile بلا تعديل. تدقيق المهام الخمس مجددًا: صفر changed-path overlap؛ الأربعة الأصلية نظيفة على رؤوسها المنشورة نفسها.

الجلسة الأصلية `ses_e3ba5ef4fffetTm46CbT9S3MCz` أعادت handoff مصدريًا بلا تعديلات أو أوامر أخرى، مع بقاء الخطأين الأوليين في السجل. مراجعة مستقلة جديدة Astra `openai/gpt-6-astra#high`، جلسة `ses_e3b8c4c2bffeVG7gOlyWkZy2rv`، اكتملت من سياق مستقل: **لا عيوب كود أو اختبارات فعلية، ولا تعديل كود لازم قبل نشر draft CI**. شملت الملفين المؤلفين والمستهلكين الخمسة وcodec/harness واختبارات الأرقام والعمق والبايتات والسور والأداء. أكدت شمول المجهول والمفاتيح، وعدم قبول sparse عبر غموض `#table`، والقبول قبل المسح مع غلاف الرد وبقاء fallback. مراجعة static/read-only فقط؛ لم تشغّل أوامر أو Redis أو Git، وتعتمد إيصالات التنفيذ وفروق baseline على تحقق المدير.

يقبل المدير handoff المصدر والفحوص المحلية لنشر draft CI بموافقة CI-Q1 القائمة، لا بوصفه قبول أداء أو موافقة دمج. يبقى أي فشل في محاولة إصلاح الأداء قيد التشخيص قبل توسيع النطاق أو إعادة التشغيل؛ لا تُعفى المحاولة من البوابة الثقيلة.

## المتبقي

PR draft لاختبار CI وحده بلا طلب مراجعة خارجي، ثم قراءة نتيجة الرأس الفعلي. مجموعة الأداء الأصلية بحدودها وعيناتها وbaseline المثبت تبقى CI-only؛ لا إثبات إصلاح أو جاهزية دمج قبل إيصالات الرأس الفعلي والحواجز الأخرى المطلوبة. لا merge أو deploy أو backup/restore تشغيلي مأذون ضمن نشر draft هذا.

## نتيجة draft CI الفعلية — نجاح worker وبقاء عائق admin

نُشر draft **#914** على الرأس `89dd5cb7def2825a49fe44712f1790fdfecc57c4`. انتهى run `42779559757` بنتيجة **failure** بسبب admin browser وci-gate فقط. نجحت الفحوص العامة والحزم وAPI shards الأربعة وbuild جميع التطبيقات وDocker images. لا rerun أو correction push أو طلب مراجعة خارجي أو merge أو deploy.

تحقق المدير من checkout الفعلي في سجل worker: merge ref `dec9608952f987c945d68d8a1057d0eb2df80448`، ووالداه عبر GitHub API هما main `ff551062ce56a9a57cd6aa7a9abd6f67e1a2bbb2` ورأس المهمة أعلاه. remote main بقي مطابقًا عند الفحص.

### worker — نجاح أداء مثبت لهذا الرأس فقط

job `129706106099` نجح: **2276/2276 اختبارًا، 271/271 ملفًا**، بما فيها **6/6** في ملف الأداء غير المعدل. runtime CI: Redis **7.4.12**، image `sha256:bb8953020f6597e47d5d699a9910a25d77a69608dbd58e0f722940598ed85fc0`، بخلاف Redis المحلي 7.4.11. baseline المثبت `ec26930497f25213b62e2b60bc603af6b9ba3527` وblobs الستة ظهرت في السجل.

كل حالة أبقت 20 warmup و100 عينة لكل variant؛ الوحدات ms:

| الحالة | baseline p95 | patch p95 | patch max | الحد النسبي |
| --- | --- | --- | --- | --- |
| TERMINAL، 2048، عادية | 8.314406 | 12.886536 | 14.087612 | 16.628812 |
| RETRY، 2047، عادية | 9.490541 | 17.114933 | 19.657876 | 18.981082 |
| RETRY، 2048، OVERFLOW بالعدد | 9.060869 | 12.744447 | 14.18149 | 18.121738 |
| TERMINAL، 2048، near-cap | 22.933292 | 26.975322 | 32.112997 | 45.866584 |
| RETRY، 2047، near-cap OVERFLOW | 26.111414 | 32.742346 | 39.57254 | 52.222828 |

نجحت جميع الحدود المطلقة والنسبية بلا تخفيف. near-cap بقي **1048448 bytes** وheadroom **128 bytes**. صفحة 75 تسوية اكتملت للـbaseline في **659.870557ms** وللتعديل في **973.486375ms**. هذه مقارنة مع baseline التاريخي المثبت، وليست ادعاء أن التعديل أسرع منه أو أن نسبة التحسن إلى محاولة CI سابقة مقاسة على نفس runner. دليل النجاح يخص بوابات worker في هذا الرأس؛ لا يحوّل aggregate CI إلى نجاح.

### admin — عائق فعلي جديد في نتيجة هذه المهمة

job `129711631294`، `apps/admin/e2e/employee-document-popup.pw.ts`: **8 فشل / 3 نجاح**. أسباب الفشل الظاهرة، لا root causes مثبتة:

- اختبار sandbox عند السطر 180: `#workspace-company` غير موجود داخل iframe، وفشل `chooseStaff` عند 16 بعد 20000ms؛ diagnostics أظهرت workspaceCount صفرًا.
- اختبارات عند 200 و266: انتظار `failed.isClosed()` أعاد false بدل true حتى المهلة، عند 206 و275.
- حالات GET 403/404 عند 224، واختبارات 291 و314: `document.visibilityState` بقي `visible` بدل `hidden` في `nativeFocusCycle:134` بعد 20000ms.
- اختبار 354: زر `Open` بقي disabled بدل enabled عند 360 بعد إغلاق النافذة.

هذه بوابة E2E وليست اختبار unit race السابق في #911 (`employee-document-notification-race.spec.tsx:178`). لا دليل بعد أنهما نفس السبب أو أن عطل browser موجود مسبقًا على main. لم تُعدّل ملفات admin ولم تُشغّل E2E محليًا أو تُرخّص بوابة.

القيود السابقة صنعت انتظارًا دائريًا: #914 يشغل الخانة الخامسة ولا يدمج قبل admin gate؛ تفويض admin السابق يبدأ بعد خلو هذه الخانة. أجاب المالك CI-Q3 حرفيًا **`Expand #914 (Recommended)`**، فأجاز إصلاح worker وعيوب admin المرصودة داخل #914 نفسه كاستثناء صريح لقيد الفصل/حالة استخدام واحدة، مع خمس خانات وكل الحواجز والمهمات الأربع بلا تغيير. استؤنفت جلسة Sol الأصلية لتشخيص وخطة فقط، ونطاق كتابتها spec/plan/diagnosis؛ المدير يراجع الخطة شخصيًا قبل الكود. لا task سادس أو تشغيل E2E ثقيل محلي أو تخفيف بوابة. إيصالات logs والـJSON الحسابي محفوظة خارج المستودع في مجلد الدفعة؛ هذا تحديث تدقيق محلي غير منشور، وليس correction push.

## مراجعة خطة admin واعتماد checkpoint ضيق

الجلسة الأصلية ألحقت التشخيص والخطة في الوثائق الثلاث بلا كود. راجع المدير الوثائق كاملة وملفَي E2E والـunit race، ومنطق open/hook/section، وملفات الوحدة الخمسة وإعدادها، وsidebar/drawer، ومصادر Playwright/TanStack المثبتة التي تحقق منها محليًا. ثم استلم مشورة Astra مستقلة جديدة `ses_e3b5dc45effeOCw6Qyo0ZAmlY9`، `openai/gpt-6-astra#high`؛ مشورة تصميم read-only لا مراجعة كود جديد أو إثبات runtime.

نتيجة مراجعة المصدر:

- سبب إعداد sandbox محدد: iframe بلا أبعاد يأخذ 300x150؛ `AppSidebar` يتحول تحت 768px إلى drawer يبدأ مغلقًا، وWorkspaceSelector داخله. يُسمح بتوحيد إطارَي denied/permitted على أبعاد desktop **1280x720** مع إبقاء sandbox flags والتأكيدات الثنائية وPOST-free/native popup كما هي. ما زال CI لازمًا لاستبعاد سبب bootstrap إضافي.
- Playwright 1.63.0 المثبت يرسل `Emulation.setFocusEmulationEnabled({ enabled: true })` في `coreBundle.js:37633–37638`، بينما `bringToFront` عند 37366–37367 يرسل `Page.bringToFront` فقط. هذه آلية مصدرية مهمة لا إثبات runtime لسبب visibility؛ لا تغيير CDP أو headed/launch/config ضمن checkpoint.
- TanStack 5.104.0 المثبت متاح داخل worktree؛ `queryObserver.ts:575–577، 709–711، 805–820` يبين baseline إعادة الارتباط وحساب isFetchedAfterMount. لا يُستنتج من ذلك ترتيب فشل #911 دون characterization مضبوط. عبارات عدم توفر المصدر في المرحلة السابقة كانت نتيجة بحث محدد، وليست الحالة الحالية.
- رفض النقل وإغلاق placeholder ما زالا بلا سبب runtime حاسم؛ لا إصلاح إنتاجي تخميني أو نسخ لاختبارات الرفض/close-focus القائمة.

بعد قراءة كل الأسطر وإعداد Vitest، شغّل المدير baseline محدودًا ببرنامج خارجي `run-rating-ci-admin-correctness.mjs`: خمسة ملفات jsdom المختارة، API boundaries mocked، بلا خدمة أو متصفح. يزيل runner متغيرات CI/Redis/Postgres/Auth الموروثة ويثبت منافذ الخدمات على عنوان مغلق. النتيجة: **27/27، خمسة ملفات، صفر skipped، exit 0، 71.08s**. حالة remove/recreate القائمة نجحت خلال 187ms؛ لا يُعد هذا إعادة إنتاج لفشل #911 ولا إثبات إصلاح له، ولا قياس أداء. لم تتغير اختبارات admin عند هذا التشغيل.

القرار الشخصي للمدير: اعتماد checkpoint **85–125 إضافة+حذف admin كحد أقصى**، مجموع **350–390** مع worker 265، ضمن هدف400 وحد800. النطاق الدقيق ثلاثة ملفات فقط: `e2e/employee-document-popup.pw.ts`، وfixture المجاور إذا لزم عدّ النقل، و`src/staff/api/employee-document-notification-race.spec.tsx`. الخطة الأشمل 445–625 إجماليًا **غير معتمدة**؛ أي تجاوز125 أو إنتاج/config/workflow/launch يحتاج مراجعة جديدة قبل الكتابة.

التعديل المأذون: desktop iframe مطابق، diagnostics عند الفشل فقط بفئات route/event ثابتة وعدّادات وأعلام native مع حد retained/overflow، واستبدال طباعة sandbox غير الآمنة؛ لا raw URL أو ledger أو console/error/evaluation reason أو bodies/headers/cookies/capabilities. عدّادات response تمسك سجل test/generation الخاص بها حتى لا تلوث أحداث reset المتأخرة الحالة التالية. تبقى assertions والtimeouts والسيناريوهات الأصلية بلا تخفيف أو ترتيب مغير، ولا تزوير focus/visibility/window. characterization يمدد الحالة القائمة بهويات query وقراءات معلقة وتصريف notifications محدود داخل act، وOpen مرئي ومتاح ثم successor، مع بقاء stale/manual protections. فشل جديد في الجاهزية يوقف أي إصلاح إنتاجي حتى التشخيص والاعتماد.

العامل الأصلي عاد بهذه القيود للكتابة فقط؛ المدير يقرأ كل diff قبل الاختبارات والفحوص المحلية، ثم مراجعة Astra للفرق الفعلي قبل push تشخيصي واحد مراجع. لا E2E ثقيل محلي أو rerun بلا تغيير أو trigger مراجعة خارجي أو merge أو deploy. جميع النتائج الجديدة بعد هذه الكتابة **NOT RUN** عند هذا checkpoint.

## توقف العامل الجزئي ثم مراجعة نطاق checkpoint

توقف العامل قبل تجاوز حد125: عدّل E2E فقط، ولم يكتب characterization أو fixture. تحقق المدير من Git: **66 إضافة + 28 حذف = 94 admin**، مجموع **359** مع worker. احتوت المسودة أبعاد sandbox المطابقة وإزالة dump غير الآمن وdiagnostics أولية؛ ليست handoff تنفيذ أو push جاهزًا. لم تُشغّل المسودة أو lint أو اختبارات عليها.

صحح المدير ادعاء حد الملف من المصدر: `packages/config/eslint/index.js:321–322` يستثني السطور الفارغة والتعليقات من 400/60. وصول الملف إلى416 سطرًا ماديًا ليس وحده دليل فشل lint. مع ذلك، failure observability مسؤولية مستقلة عن سيناريوهات القبول ويُستخرج لها helper متماسك، لا تقسيم عشوائي للتحايل على الحد.

مراجعة diff كشفت نقصًا حقيقيًا في الدليل: requestfailed/response وحدهما لا يعدّان POST المعلق أو المعاد؛ native counters القائمة لا تُنشأ إلا داخل nativeFocusCycle، فلا تشخّص حالة closed blank؛ تصنيف URL قد يرمي من callback؛ وframe.evaluate بلا deadline تشخيصي قد يحجب assertion الأصلي. يلزم تسجيل request start/finish بفئات ثابتة، ومراقبة native قبل navigation ولكل document دون لمس مقاييس القبول، وfallback تشخيصي آمن فقط، وdeadline قصير مع cleanup دائم. لا طباعة URL أو ledger/error/console/body/header/capability خام.

اعتماد المدير المعدل، معلن لا ضمني: checkpoint **<=220 إضافة+حذف admin**، مجموع **<=485** مع worker265. هدف400 الأولي عُدّل لهذه المرحلة المضافة بموافقة CI-Q3؛ **hard max800 وكل حدود lint والبوابات بلا تغيير**. تقدير full repair السابق445–625 ليس إذن إنتاج مفتوحًا. النطاق الجديد الدقيق: E2E القائم، helper جديد `apps/admin/e2e/employee-document-popup-diagnostics.ts`، وunit race القائم؛ Node fixture أصبح read-only لهذه المرحلة. scope الإنتاج/config/CDP/headed/workflow ما زال غير معتمد، وأي تجاوز220 يتوقف قبل الكتابة.

العامل الأصلي استؤنف لإكمال checkpoint نفسه: helper يرصد فقط ويطبع عند الفشل بحد retention/overflow، لا أحداث أو خصائص native مزورة؛ يكتمل query-order characterization المضبوط وتبقى guards/الرفض/successor وتأكيدات المتصفح كما هي. كل diff يُقرأ قبل أي تشغيل، والفحوص الجديدة **NOT RUN** حتى تسليم مكتمل ومراجع. لا correction push أو rerun بعد هذا التوقف الجزئي.

## أول تشغيل للـcharacterization — RED محفوظ قبل أي إنتاج

راجع المدير كل الفرق المكتمل والـhelper الجديد قبل تشغيله: **218 admin** (E2E13+28، helper107، unit60+10)، مجموع **483** مع worker. Prettier المحدودة و`git diff --check` نجحا. لم يتغير production أو Node fixture أو config أو worker.

أعاد المدير runner jsdom المحدود نفسه: **2 فشل / 26 نجاح، 28 اختبارًا، خمسة ملفات، exit1، 26.13s**. التفاصيل:

- `before-rebind read keeps old open invalid`: عند سطر215 لا يوجد زر Open؛ body يحتوي `<div />`، بعد انتظار Testing Library الحالي4000ms. بقيت assertions والمهلة كما هي. هذا يعيد نفس نمط العرض الفارغ المرصود سابقًا، وليس بعدُ إثباتًا كاملاً لسبب حادث #911.
- `after-rebind read keeps old open invalid`: عند سطر205 `pending.close` متوقع مرة واحدة لكنه صفر؛ وقع قبل دخول helper القراءة المضبوطة.

فرضية عزل اختبار محددة من مراجعة ترتيب mocks: فشل before يمنع استهلاك POST successor ذي mockReturnValueOnce، ثم يضيف after ترتيب once جديدًا دون مسح القديم؛ فيمكن أن يتلقى POST الأول نتيجة success القديمة بدل held download، فتُسلَّم النافذة قبل إزالة query. لذلك لا يُفسر هذا الفشل الثاني كعيب إنتاجي قبل عزل الحالة.

التفويض اللاحق للعامل الأصلي: **سطر `api.POST.mockReset();` داخل الحالة parameterized قبل ترتيب once فقط**، بقاء كل assertion وتنسيق الوقت، وتحديث وثائق الإيصال. لا mockClear بديلًا لأنه لا يمسح طابور once. المتوقع219 admin/484 إجماليًا؛ لا تجاوز220. المدير يقرأ السطر ثم يعيد المجموعة مرة واحدة للتحقق من paired control. يجوز تقديم خطة مصدرية لإصلاح before فقط، لا كتابة إنتاج. فحوص ما بعد عزل الاختبار **NOT RUN** عند هذا التحديث، ولا push أو CI جديد.

## عزل paired control وإثبات آلية readiness

قرأ المدير سطر mockReset ثم شغّل وضع pair المحدود: **before فشل / after نجح / 3 اختبارات مرشحة مستبعدة عمدًا**، exit1، 10.25s. before سطر216 بقي body فارغًا بلا Open؛ after نجح165ms. المستبعدات ليست نجاحًا أو قبول المجموعة الكاملة. زال فشل close المبكر من control بعد مسح once، لكن لا يُمسح سجل فشل العزل الأول.

أنشأ المدير إعدادًا تشخيصيًا خارجيًا مراجعًا `rating-ci-admin-proof.config.mjs` لوضع proof في runner نفسه. يضيف ملاحظات **في الذاكرة فقط** لملف الوحدة المحدد عبر transform يتطلب anchors فريدة؛ لا تعديل tracked، أو observer جديد، أو mock لحالة المنتج، أو تغيير assertion أو scheduler أو مهلة. يسجل QueryCache success غير manual على query المثبتة وخصائص observer الحالية فقط، ويفك الاشتراك في finally. بيانات الطباعة enums/booleans/counts، لا payload أو URL.

نتيجة proof: **before فشل / after نجح / 3 مستبعدة عمدًا**، exit1، 10.00s. في الحالتين `nonmanualSuccesses=1` و`sameInstalledQuery=true` وstatus=`success` و`dataMatchesGenuineRead=true` و`dataUpdateCount=2` وobserver `isError=false` و`hasData=true` وdata مطابق. الفرق السببي المضبوط: **before: isFetchedAfterMount=false** مع DOM فارغ؛ **after: isFetchedAfterMount=true** وزر مرئي ومتاح وسور successor ناجح207ms. المصدر المثبت يفسر ذلك بتثبيت نجاح B ضمن baseline عند إعادة ارتباط observer. هذا دليل تشخيصي وليس قبولًا instrumented بدل المجموعة غير المعدلة أو ادعاء حل كل عوائق admin/حادث #911 بأسره.

فحوص المدير قبل أي إصلاح إنتاجي: typecheck الرئيسي وe2e نجحا؛ lint فشل بخطأ جديد واحد `no-empty-pattern` عند E2E129:23 ومعه14 تنبيه React Compiler قائمة. العامل صحح hook ليستخدم `afterEach(async () => …)` و`const info = test.info();` دون تغيير المنطق/ledger؛ قرأ المدير الفرق وتحقق من **220 admin / 485 combined**. إعادة lint بعد هذا التصحيح لم تُنفذ بعد، ولا يُدعى نجاحها.

## عقد readiness المراجع واعتماد الإنتاج المحدود

استلم المدير مشورة Astra العقدية المستقلة من الجلسة نفسها `ses_e3b5dc45effeOCw6Qyo0ZAmlY9` وراجعها مع المصدر والدليل أعلاه. القرار: إعادة استخدام `OpenLife.query` و`noteRead` و`witnessed` بوصفها دليل القراءة الوحيد المرتبط بعمر القسم وquery؛ **لا tracker موازي DeclaredRead أو map أو authority boolean جديدة**.

عقد readyData المقترح المأذون تنفيذه: lifetime حية تخص scope/client/key الحاليين حتى في render قبل effect البديل؛ شاهد query يطابق المثبتة بالهوية، لا بمساواة payload وحدها؛ access القائم mounted/readable؛ query المثبتة success وdata معرفة؛ observer ناجح بلا error وبياناته تطابق data الحالية للمثبتة. يُعاد projection من data المثبتة وتُعرض كل table/form منه بدل isFetchedAfterMount المحلي للـobserver. تبقى أخطاء العرض وتعطيل pending كما هي. تظل validation الأصلية للـGET والحواجز الحالية في beginOpen/settlement/epochs/keys/ownership/stale operations بلا تغيير.

تغييرات watcher المرتبطة بالقراءة/status/data/removal تُحدّث الشاهد وتتصالح مع attempts أولًا ثم تطلب render؛ إشعار/revision ليس مصدر authority آخر. لا ready=true مسبقة في queue، ولا إشعار لكل metadata observer event يسبب حلقة render/setOptions، ولا callback بعد cleanup/scope/client/key replacement. يُعاد اشتقاق الجاهزية من الحقائق الحالية.

تصحيح دلالي لازم للخطة السابقة: لا مسح للشاهد عند كل transient error أو manual update؛ هذا يغير recovery القائمة. الدليل التاريخي منفصل عن صلاحية الحالة الحالية؛ error يمنع القراءة الحالية وepochs تبطل العمليات القديمة. manual population بلا شاهد/بعد query replacement لا ينشئ دليلًا، لكنه لا يمسح دليل query نفسها المقروءة سابقًا. key disappearance/restoration تبقي العملية القديمة باطلة وتسمح successor جديدًا وفق الحواجز القائمة؛ manual can_manage recovery لا تعيد نتيجة كتابة قديمة. لا ربط لdata الحالية بآخر payload genuine تاريخية بدل query الحالية.

منح المدير نطاقًا إنتاجيًا محدودًا بعد مراجعة هذا العقد: `employee-document-open.ts` و`use-employee-documents.ts` و`employee-documents-section.tsx`، ومعها negative tests الناقصة فقط في race spec القائم. الحالتان before/after تبقيان حرفيًا كما هما. الهدف **80–140 إضافة+حذف إضافية**، سقف التوقف **160** فوق checkpoint485، أي **<=645 إجماليًا**؛ hard800 ثابت. لا موافقة عامة على بقية إنتاج admin أو Node fixture أو config/CDP/headed/workflow أو worker أو endpoint/security-header/dependency changes. كل diff يُقرأ قبل تشغيله.

البرهان اللازم: pair أخضر بلا تغيير التأكيدات، والمجموعة المركزة وكل حواجز manual/removed-query/denial/scope/unmount/StrictMode/pre-notification/stale والعرض المعتمد على data الصحيحة. تُضاف فقط الفجوات الخاصة بهوية A/B مع data نفسها، stale observer payload، وإشعارات readiness المؤخرة عبر cleanup، دون تزوير شاهد أو mock لمنطق داخلي. المشورة عقد فقط لا مراجعة كود نهائي؛ native focus/network/closed blank ما زالت تحتاج CI browser. لا push أو merge أو deploy أو trigger مراجعة خارجي عند هذا التفويض، وكل نتائج ما بعد الإنتاج **NOT RUN**.

## قراءة التنفيذ وGREEN محلي بعد إصلاح readiness

راجع المدير كل سطر إنتاج واختبار جديد قبل تشغيله. التطبيق يعيد استعمال witness القائمة، ويضيف scope/client/key binding وprojection للبيانات الحالية فقط، وrevision غير مخوَّلة لطلب render بعد أحداث القراءة/data/removal ذات الصلة. لا tracker موازية أو queue لready=true، ولا تغيير beginOpen/settlement authorizers. أُبقيت حالتا BEFORE/AFTER وأزمنتهما وتأكيداتهما كما كانتا عند RED؛ أُضيفت رحلة hook/cache حقيقية واحدة للهوية المشتركة المرجع، observer القديم والscope المتغير مع notifications متأخرة.

أول مجموعة غير instrumented بعد التعديل: **29/29 نجاح، خمسة ملفات، صفر skipped، exit0، 18.96s**، بما فيها BEFORE وAFTER والـnegative الجديد. Prettier فشل بملفين، ثم نسق المدير **فقط** `employee-document-open.ts` و`employee-document-notification-race.spec.tsx`، بلا تعديل منطقي أو ضغط أسطر. فشل التنسيق محفوظ ولا يُحوَّل إلى نجاح سابق.

الفحوص الفعلية بعد التنسيق:

| الفحص | النتيجة |
| --- | --- |
| مجموعة admin jsdom المحدودة غير instrumented | **29/29**، خمسة ملفات، صفر skipped، exit0، **19.60s** |
| حالة BEFORE | نجحت **156ms** بنفس assertions التي أعادت RED |
| حالة AFTER | نجحت **158ms**، بما فيها successor المستقل |
| admin typecheck الرئيسي وe2e | نجحا |
| admin lint | صفر أخطاء، **14** تنبيهًا قائمة في ملفات غير معدلة |
| Prettier لستة ملفات admin ومجلد المواصفات | نجح |
| docs lint | صفر أخطاء، **29** تنبيه TODO قائمة |
| module-map | `module map: ok` |
| diff check | نجح |

عدّ Git/الملف الجديد بعد التنسيق: **375 admin + 265 worker = 640 إضافة+حذف**؛ readiness فوق checkpoint485 هي **155** ضمن سقف160/645، ويبقى hard800 ثابتًا. تقدير العامل147/632 يصف المصدر قبل formatter، لا العد النهائي. كل الـdiagnostics ضمن هذا العد. إعادة تدقيق المهام الخمس: صفر overlap؛ الأربعة الأصلية نظيفة على الرؤوس المنشورة نفسها. Node fixture وsettle وperformance gate/harness وworkflows/lockfile بلا تعديل؛ worker نفسه بلا فرق منذ الرأس المنشور89dd5cb7.

مراجعة Astra فعلية جديدة مستقلة `ses_e3b006790ffeCWPRdB5zDEGbDE` قيد العمل من سياق جديد، read-only على المصدر المجمد. الجلسة الأصلية أعادت source handoff بلا تعديلات أو أوامر أخرى؛ يحتفظ المدير بأي قبول نهائي لحين المراجعة، وتعود العيوب الأولية الحقيقية للعامل الأصلي. لا commit أو push لتغييرات admin بعد، ولا browser قبول جديد. المرحلة التالية مراجعة الفرق ثم push مجمع واحد ذي إصلاح ودليل تشخيصي إلى draft914، لا إعلان حل بقية browser أو CI أخضر.

## نتيجة المراجعة الفعلية: P2 وإعادة إنتاجه قبل التصحيح

أكملت Astra `ses_e3b006790ffeCWPRdB5zDEGbDE` المراجعة read-only ووجدت **P2** في readiness refresh: error403/404 يؤدي إلى eviction في hook، ثم render مجدول من watcher يعيد إنشاء query المرفوضة ويتيح refetch تلقائيًا رغم retry=false. أشارت أيضًا إلى أن اختبار denial القديم يفرغ batch واحدة فقط، وأن المجموعة الخماسية السابقة لا تشمل رحلة UI التي تثبت eviction. لم تجد عيبًا فعليًا آخر في الملفات الستة؛ لا تُعد هذه النتيجة موافقة قبل إصلاح P2.

راجع المدير الملاحظة مقابل المصدر ولم ينفذها اعتمادًا على كلام المراجع وحده. قرأ **397 سطرًا** من الملف الصحيح `apps/admin/src/staff/ui/employee-documents-access-journey.spec.tsx` وإعداد/mock transport القائم، ثم شغّل الحالات الأربع الأصلية فقط بrunner fail-closed، بلا تعديل tests أو source. النتيجة: **4 فشل / 10 حالات مرشحة مستبعدة عمدًا، exit1، 6.34s**. فشلت ar/en لكل من403 و404 عند سطر281: cache متوقع فارغًا لكنه يحتوي Query معاد إنشاؤها، pending أو error. المستبعدات ليست نجاحًا؛ إعادة الإنشاء مثبتة runtime، أما عدد دورات refetch المستمرة فلم يُقاس بعد. تبقى29/29 السابقة إيصال المجموعة الأضيق، لا نفيًا لهذا الانحدار.

العامل الأصلي أُعيد إليه العيب ضمن ملكية المحاولة الأولية، لا handoff تصحيح إلى نموذج آخر. النطاق المأذون للإصلاح فقط: `employee-document-open.ts` وrace spec القائم مع الوثائق الثلاث؛ رحلة UI gate **read-only** وكل تأكيداتها وحدودها محفوظة. المطلوب إعادة فحص facts عند تنفيذ callback المؤجل بحيث لا يعيد إزالة query errored من cache إلى fetch تلقائي؛ لا مجرد منع جدولة removed مع ترك callbacks أقدم، ولا store صلاحية موازية أو retained private query أو تغيير retry/denial policy. يجب أن تظل genuine query B recovery وsame-query manual recovery والعمليات القديمة المنقوضة صحيحة.

تُقوّى حالة denial القائمة بتصريف كل notifications إلى quiescence ضمن cap10، لا batch واحدة، مع بقاء التأكيدات السابقة وزيادة دليل stable denial/cache-empty/no-extra-request، واستخدام403/404 دون نسخ suite واسعة. الهدف5–25 إضافة+حذف؛ سقف توقف **60 إضافية** فوق640، أي **<=700 إجماليًا**، hard800 وكل lint/gates ثابتة. هذه مراجعة نطاق صريحة لعيب مثبت، لا تفويض لبقية إنتاج admin أو config/browser/native/worker. قبل أي push يلزم قراءة المدير للفرق، ثم رفضات403/404، وكل الحالات في مجموعة موسعة من ستة ملفات، والفحوص والمراجعة المستقلة اللاحقة. التصحيح الجاري **NOT RUN** عند هذا التحديث.

## تحقق المدير بعد تصحيح P2 — المراجعة اللاحقة معلقة

قرأ المدير تصحيح callback والاختبار قبل التنفيذ. الشرط يعمل وقت تنفيذ الإشعار: يمنع refresh إن كانت query الحدث حاليًا error ولا query مثبتة، بما يشمل callbacks سبقت eviction. يبقى مسح الشاهد والمصالحة وتفويض الفتح والتعافي القائم بلا تعديل. اختبار الرفض يغطي403/404 ويفرغ الطابور إلى السكون المحدود، ويتحقق من عدد GET ثابت وفراغ الكاش ومنع late navigation. رحلة UI الأصلية وكل شروطها بقيت بلا تعديل.

إيصالات التنفيذ الفعلية:

| الأمر | النتيجة |
| --- | --- |
| runner الخارجي بوضع `refusal` بعد التصحيح | **4/4** ar/en403/404، عشر حالات مرشحة مستبعدة عمدًا، exit0، **11.24s**؛ الترشيح ليس قبولًا كاملًا |
| runner بوضع `broader` بعد التصحيح | **44/44**، ستة ملفات، صفر skipped، exit0، **23.64s** |
| إعادة `broader` بعد استئناف السياق وقبل النشر | **44/44**، ستة ملفات، صفر skipped، exit0، **26.53s** |
| `pnpm --filter @pospay/admin run typecheck` | نجح main وe2e |
| `pnpm --filter @pospay/admin run lint` | نجح، صفر أخطاء و14 تحذيرًا قائمة في ملفات غير معدلة |
| scoped Prettier للستة ملفات والوثائق | نجح |
| `pnpm lint:docs` | صفر أخطاء و29 تحذيرًا قائمة |
| `pnpm module-map:check` | `module map: ok` |
| `git diff --check` | نجح |

عدّ Git مع الملف الجديد: **392 admin + 265 worker = 657** إضافة+حذف، فرق P2 الفعلي **17** مقابل640، داخل السقف700/hard800. تقدير العامل19/659 كان محافظًا قبل عدّ المدير، وليس العد النهائي. كل التشغيل على jsdom محدود ومراجع بلا خدمات أو E2E ثقيل، لا substitute لبوابة browser أو أداء CI.

أُعيد الفرق المصحح المجمد ودليل RED/GREEN إلى نفس مراجع Astra `ses_e3b006790ffeCWPRdB5zDEGbDE`؛ إعادة المراجعة read-only قيد العمل. لا قبول handoff نظيف أو commit/push حتى نتيجتها. لا تعديل برأس #914 المنشور89dd5cb7، ولا review trigger أو merge/deploy؛ فحوص الرأس الجديد كلها مطلوبة بعد النشر. أسباب native focus/network/closed-blank وتشغيل diagnostics في browser ما زالت غير محسومة.

## إغلاق P2 في إعادة المراجعة وقبول handoff المصدر

اكتملت إعادة مراجعة Astra في الجلسة نفسها: **P2 resolved by source review؛ لا عيب فعلي متبقٍ ولا تغيير كود إضافي لازم قبل consolidated draft diagnostic CI push**. أكدت أن الشرط وقت التنفيذ يثبط callbacks السابقة للإزالة، وأن B الحقيقية والتعافي manual في query نفسها ما زالا مؤهلين، وأن مسح witness/revocation يسبقان suppression. بقيت eviction الأصلية وعرض denial في الواجهة كما هما. الاختبار يفرغ الطابور إلى quiescence ويثبت منع GET إضافية وفراغ cache وdenial مرئي وعدم navigation متأخر. المراجعة static/read-only بلا أوامر أو مقارنة Git؛ التنفيذ والعدّ مسؤولية المدير.

أعادت جلسة Sol الأصلية `ses_e3ba5ef4fffetTm46CbT9S3MCz` handoff مصدرًا مجمدًا بلا تعديل أو أمر إضافي. أعاد المدير تدقيق المهمات الخمس: رؤوس #910–#913 الأصلية نظيفة بلا تغيير، وصفر changed-path overlap. ملف رحلة UI وNode fixture وsettle وperformance/harness وworkflows/lockfile بلا تعديل، وworker بلا فرق منذ89dd5cb7. نطاق admin النهائي ستة ملفات كود/اختبار (يشمل helper التشخيص)، ووثائق المهمة الخمس؛ لا ملفات غير متعلقة.

يقبل المدير handoff المصدر والفحوص المحلية لنشر **تصحيح draft واحد مجمع** بموجب CI-Q3، لا قبول أداء/متصفح للرأس الجديد ولا merge readiness. كل failure history محفوظ: lint worker الأولية، unit RED وmock isolation، hook lint وformat ثم P2 في الرحلة الأوسع. لا مراجعات GitHub مطلوبة أو triggers خارجية؛ يبقى draft وتُقرأ نتيجة CI الجديدة بدل rerun للرأس الفاشل. native focus/network/closed blank ما زالت تستلزم الدليل التشخيصي في CI. لا merge أو deploy أو تشغيل خدمة مشتركة.

## نتيجة الرأس المجمع15b4dc13 — worker ناجح، browser ما زال مرفوضًا

نُشر commit `15b4dc1322d50b6a20801e3a2449c745653a7654` بتصحيح draft واحد. انتهى run `42802761272` **failure**. تحقق المدير من checkout worker ومن GitHub API: merge `c22bfff4034e7e55778a5f2a81376373561b7d1b`، والداه main الحالي `ff551062ce56a9a57cd6aa7a9abd6f67e1a2bbb2` والرأس المجمع. نجح check العام وAPI shards الأربعة وbuild وDocker؛ فشل browser وci-gate فقط. بقي draft ومراجعات/طلبات GitHub فارغة؛ لا rerun أو correction آخر أو merge/deploy.

worker job `129784268590`: **2276/2276** في **271 ملفًا**، والأداء غير المعدل **6/6**. Redis7.4.12، image السابقة نفسها؛ كل20 warmup و100 sample محفوظة. patch p95 للحالات الخمس: **9.780707 / 10.149432 / 7.895066 / 17.616774 / 18.265097ms**؛ maxima: **16.879222 / 12.569679 / 10.463025 / 71.232066 / 91.144759ms**. صفحات75 تسوية: baseline **400.172222ms**، patch **505.265938ms**؛ النجاح لا يعني أسرع من baseline التاريخية. بيانات الحالات والصفحات محفوظة في JSON خارجي؛ لا تخفيف لأي حد.

browser job `129789384597`: **8 فشل / 3 نجاح**. الرصد الجديد عمل في CI وأعطى دليلًا أدق من التشغيل السابق:

- sandbox تجاوز إعداد workspace هذه المرة وأكمل denied العربي بلا POST ثم permitted control. ظهر POST download واحد وresponse200 وfinish واحد، لكن popup بقيت `about:blank` بدل destination عند E2E183. إصلاح حجم iframe أزال حاجز الإعداد المرصود؛ handoff نفسه لم ينجح ولا سبب فشله مثبت بعد.
- حالتا network عند192 و261: بعد release المراجعة، يوجد start download واحد ولا response أو finish أو requestfailed حتى المهلة؛ placeholder لم تُغلق. هذا دليل طلب pending، لا إثبات وصول رفض fetch للمنتج. لا ننسبه إلى browser retry أو load بلا دليل إضافي.
- أربع حالات عند nativeFocusCycle111 ظلت visible بدل hidden. الرصد يظهر صفحات الأصل والـblank visible وfocused مع focus0/visibility changes0، ولم يصدر GET denial بعد GET200 الأول. لذلك assertions الخاصة بسحب الإذن لم تُبلَغ بعد؛ لا يُستنتج فشل authorizer من هذا التوقف.
- closed blank عند346: الرصد closed=[false,true] يؤكد أن popup أُغلقت، لكن الأصل بقي visible/focused بلا focus أو visibility event، والزر ظل disabled. آلية Playwright focus emulation المثبتة سابقًا متسقة مع الرصد، لكنها ليست تجربة counterfactual مثبتة بعد.

نجحت trusted-click delayed handoff، وemployee/panel/workspace cancellation، وCOOP/attachment observations. لا ادعاء أن window.close أو navigation يفشلان في كل السياقات. قائمة artifacts ستة telemetry فقط بلا browser trace/screenshot/error-context. سجل stdout التشخيصي آمن بفئات/counts، لا يُعوّض assertions الأصلية.

المدير أعاد قراءة ملفَي E2E/Node fixture وسجلات الفشل قبل أي اقتراح. أُعيدت الأدلة إلى جلسة Astra الاستشارية القائمة لتشخيص read-only وخطة تجارب native/transport/sandbox منفصلة. **لا كتابة كود أو تعديل sandbox flags أو focus emulation/CDP/headed/config أو transport fixture مأذون بهذه الإحالة**. source657/sقف700/hard800 كما هي؛ أي نطاق لاحق يحتاج مراجعة قبل التنفيذ. initial handoff السابق مقبول؛ تصحيحات الكود اللاحقة تتبع مسار correction المعتمد، ولا تعيد المحاولة إلى عامل initial لتجاوز هذه القاعدة. هذا تحديث تدقيق محلي فقط بلا push جديد.

## المشورة اللاحقة وعائق مسار التصحيح

اكتملت مشورة Astra: لا دليل جديد يبرر تعديل worker أو readiness الإنتاجية. أقوى آلية هي focus emulation المثبتة في Playwright مع foreground غير مُثبتة؛ أصغر تجربة تالية اختيار foreground صراحة للمنافسة/popup مع إبقاء emulation وكل التأكيدات والمهل كما هي، نحو6–12 إضافة+حذف ضمن43 المتبقية من700. تعطيل emulation عبر CDP، أو observation security عبرLog، أو stimulus نقل HTTP ناقصة تحتاج اعتمادًا منفصلًا قبل الكود؛ لا تعديل sandbox permissions أو retention opener أو تنقل Playwright مصطنع. response.destroy مع control200 لا يثبت fetch rejection؛ يلزم أولًا عدّ server download/held أو close evidence آمن. مراجعة scope الأشمل65–110 ترفع الإجمالي722–767 فتتجاوز700، لا تُنفذ ضمن الحد الحالي.

تحقق المدير من نتائج check على الرأس نفسه: admin **1679/1679**، ومنها رحلة الوصول14 واختبار notification-race7. هذا يثبت نجاح وحدة CI الحالية ولا يُحوّل browser إلى نجاح. الأصل أربعة PRs بقيت على الرؤوس المنشورة نفسها.

عائق التفويض: catalog الحالية لا تعرض Kimi القياسي `kimi-code-plan-global/k3.1-pro`؛ تعرضHighspeed وalias غير مثبت الهوية فقط. لا يُستبدل النموذج/السرعة أو يُعامل غياب model كفشل quota. سجل المدير CI-Q4 بخيارات تمكين القياسي، أو استثناء Sol medium جديدة لهذه المهمة فقط، أو إبقاء العائق. لا عامل تصحيح أو تعديل كود/CI push جديد حتى قرار المسار والتحقق منه. هذه مراجعة دورة المهمة نفسها، لا reset لميزانية الجولات ولا فتح task سادس.

تصحيح لاحق للعائق المعلن: أجاب المالك CI-Q4 بـ`Enable standard Kimi (Recommended)`، ثم أعاد المدير البحث مع `all: true` فوجد `kimi-code-plan-global/k3.1-pro` نفسهactive. المرشح newest-only السابق أخفاه؛ سؤال المالك كان غير لازم بسبب بحث المدير المحدود، لا غياب حقيقي أو quota. لا إعداد أو provider أو credential تغيرت. مسار التصحيح القياسيhigh متاح ومتحقق منه الآن، بلاHighspeed أو alias أو استثناءSol.

المدير يعتمد أصغر تجربة فقط بعد قراءة المصدر والمشورة: داخل nativeFocusCycle يُضاف foreground صريح للمنافس قبل hidden assertion؛ وفي closed-blank يُجعل popup الأصلية foreground قبل إغلاقها، مع بقاء parent.bringToFront وكل assertion/مهلة وسيناريو كما هي. هدف2–12 إضافة+حذف، سقف12 فوق657، أي<=669 وداخل700/hard800. لا CDP/launch/transport/sandbox permissions أو إنتاج. عامل تصحيحKimi جديد مستقل يملك هذه المتابعة وحدها، لا إعادة استعمالSolinitial ولا reset للجولات. المدير يقرأ كل سطر قبل checks والمراجعة وpush التشخيصي المراجع التالي؛ فشل unchanged native assertions يبقى دليلًا لا يُخفف.

## availability لمسار Kimi — المحاولة الأولى فشلت بالمصادقة

الجلسة الجديدة `ses_e39f84b8effewnn9UiKL7Ozd5r` على `kimi-code-plan-global/k3.1-pro#high` انتهت بخطأ الأداة الحرفي: `The API Key appears to be invalid or may have expired. Please verify your credentials and try again.` تحقق المدير من Git بعد النهاية: لا تعديل في E2E أو وثائق spec/plan/diagnosis المأذونة للعامل؛ بقيت فقط تحديثات التدقيق الخاصة بالمدير. لا ادعاء تشغيل أو إنجاز ولا إصلاح credential/config/login.

بدأ المدير محاولة availability ثانية واحدة على النموذج والجلسة نفسيهما وفق PP-112 بعد التأكد من انتهاء الأولى. لا fallback قبل نتيجتها، ولا إعادة تفسير خطأ API key كنفاد quota. كل حدود الكود والقراءة والأمان والجولات كما هي؛ النتيجة **PENDING**، ولا push أو runtime check جديد.

المحاولة الثانية انتهت بخطأ المصادقة الحرفي نفسه. أعاد المدير فحص Git: لا كتابة كود أو وثائق عامل بعد المحاولتين. لا transport Kimi CLI مثبتة في الأدوات الحالية؛ catalog coding-plan لـMiniMax Flash لا تعرض thinking المطلوبة، ولم يُفوض provider آخر أو variant مخمنة. سجل CI-Q5 ينتظر إعادة تسجيل دخول Kimi من المالك أو استثناءSol medium جديدة لهذه المهمة فقط. هذه قيود تعذر عرض المسار، لا نتائج فشل مخترعة للمسارات غير المجربة. لا credential في المحادثة ولا محاولة ثالثة حتى تأكيد إعادة المصادقة/قرار المالك؛ كود15b4dc13 ونتيجة CI كما هما.

أجاب المالك CI-Q5 بـ`Restore Kimi login (Recommended)`. ننتظر تأكيده بعد إعادة المصادقة؛ الاختيار وحده ليس إثبات login ناجحة. لا استثناءSol أو fallback جديد، ولا محاولة ثالثة/كود/push حتى التأكيد. يبقى الرأس15b4dc13 وCI browser مرفوضة وتجربة foreground غير منفذة.

أكد المالك لاحقًا حرفيًا `I ALREADY REAUTH FOR KIMI CLI`. نفّذ المدير probe مصادقة فقط عبر provider التفويض القياسي نفسه، بلا تفويض قراءة/كتابة أو brief التنفيذ. عاد خطأ API key الحرفي نفسه. هذا فشل `kimi-code-plan-global` في الأداة، وليس دليلًا على أن تسجيل CLI الذي أكده المالك فشل. لا transport CLI أصلية ظاهرة في الأدوات الحالية، ولا نساوي login CLI باتصال API provider أو نطلب إعادة login نفسه. لا إعادة محاولة أو external CLI أو تغيير credential/provider تلقائي؛ التصحيح متوقف حتى إتاحة transport التفويض المناسبة أو اعتماد بديل صريح. كود15b4dc13 بلا تعديل.

وجه المالك مباشرة إلى `opencode GLM 5.3 flash coding plane`؛ سجل CI-Q6 يحتفظ بقوله الحرفي. تحقق المدير من النموذج الفعلي `zai-coding-plan/glm-5.3-flash#high` في catalog؛ Coding Plan لا Free/Highspeed. يبدأ عامل تصحيحGLM جديد بالتفويض المدمج وبنفس النطاق ذي السطرين وحدوده ومراجعةAstra؛ لا تعديلconfig عام أو credential أو externalCLI. محاولاتKimi انتهت بلا كتابة، ولا تصفير لميزانية الجولات. كل نتائجGLM **PENDING** حتى التسليم والتحقق الشخصي.

## تحقق تصحيح GLM ذي السطرين قبل النشر

سلّمت جلسة `ses_e3998ff5cffehMw5vyZy2lSqcf` على `zai-coding-plan/glm-5.3-flash#high` المصدر فقط بلا أوامر. قرأ المدير الفرق كاملًا: **+2/−0** في E2E فقط؛ foreground للمنافس قبل hidden، وforeground للـblank الأصلية قبل إغلاقها، مع بقاء parent foreground وكل الـ11 سيناريو والتأكيدات والمهل وعدادات830 كما هي. أُلحق توثيق worker بالوثائق الثلاث فقط؛ سجلا المالك والتحقق بقيا عند المدير.

الفحوص الفعلية بعد قراءة الفرق: main/e2e typecheck ناجحان؛ lint صفر أخطاء/14 تحذيرًا قائمة؛ scoped Prettier وdiff check ناجحان؛ docs lint صفر أخطاء/29 تحذيرًا قائمة؛ module-map ناجح. مجموعة jsdom المراجعة غير instrumented نجحت **44/44 في ستة ملفات، صفر skipped، exit0، 29.43s**. لا E2E أو أداء ثقيل محلي، ولا ادعاء أن jsdom تثبت foreground/native events.

عدّ المدير الفعلي مقابل base: **659 = 265 worker + 394 admin**، أي زيادة2 فقط مقابل657، داخل حد12/669 والسقف700/hard800. تدقيق المهام الخمس: صفر overlap، الأربعة الأصلية نظيفة على الرؤوس المنشورة نفسها. لا فرق آخر في production أو worker أو diagnostic helper أو transport fixture أو Playwright config أو workflow أو lockfile منذ15b4dc13.

مراجعة Astra مستقلة جديدة `ses_e39909cebffeIPFyhteE6dtoUY` أكدت **لا عيب فعلي ولا تعديل كود لازم** في التصحيح. API `Page.bringToFront()` مدعومة؛ hidden→visible وعدادات focus/visibility وتأكيدات successor/late settlement بقيت. المراجعة static/read-only لا أوامر أو runtime. يقبل المدير handoff التجربة للنشر المراجع فقط، لا قبول browser أو merge. تبقى نتيجة فرضية foreground في CI وحدها؛ أي CDP/launch/fixture/sandbox تغيير يحتاج مراجعة منفصلة، ولا يُخفف assertion إن بقي فاشلًا.
