# تشخيص أولي — أداء ترميز حالة rating claims

التاريخ: 2026-11-10. الحالة الحالية: نجح worker على الرأس المنشور89dd5cb7 في CI، لكن aggregate بقي مرفوضًا بسبب browser. بعد توسيع CI-Q3 وإعادة إنتاج readiness ثم P2، تحقق المدير من التصحيح: رفضات403/404 **4/4** والمجموعة الموسعة **44/44** في ستة ملفات بلا skipped. الفحوص المحلية الجديدة ناجحة مع14 تحذير lint و29 تحذير docs قائمة. العدّ الفعلي **657** إضافة+حذف ضمن700/hard800؛ إعادة مراجعة Astra حسمت P2 بلا عيوب فعلية متبقية أو تعديل لازم قبل draft CI. سلّم Sol المصدر مجمدًا، وقبل المدير handoff المصدر والصحة المحلية لنشر مجمع واحد فقط. native browser ما زال بلا قبول runtime جديد. الأقسام التالية سجل تاريخي للمحاولات وحدودها، لا ادعاء جاهزية دمج.

تحديث المرحلة: المدير راجع diff الإنتاج الفعلي قبل التنفيذ، وأبلغ بنجاح correctness `458/458` في ثمانية ملفات، exit 0 خلال `16.63s`، وtypecheck PASS. فشل lint بخطأين حقيقيين: `@typescript-eslint/no-dynamic-delete` في سطر الاختبار 183، و`no-restricted-syntax` عند helper 30:44 بسبب تعليق عربي داخل TS string. التفويض اللاحق محصور في إصلاحهما والوثائق؛ العامل الأصلي يحتفظ بالمحاولة الفاشلة حتى handoff سليم.

الإصلاح المكتوب: حذف المفاتيح الثلاثة نفسها بصيغة ثابتة بدل الحلقة الديناميكية، بلا تغيير expected أو assertions؛ نقل السبب العربي إلى JSDoc خارج النص المضمن واستبدال التعليقين داخل Lua بالإنجليزية. لا تغيير سلوك helper أو matrix أو config أو i18n أو eslint disables. الاختبار صار 205 أسطر قبل أي formatting من المدير؛ إشارات 203 السابقة تصف baseline. المدير يراجع diff التصحيح كاملًا قبل إعادة lint والاختبارات اللازمة. كل فحوص ما بعد التصحيح NOT RUN بواسطة هذا العامل؛ الأداء ما زال بلا إثبات CI جديد.

## 1. دليل CI المنقول، وليس نتيجة تشغيل هنا

بحسب موجز المهمة: الفشل يتكرر على main في run `42684246041` وعلى رؤوس PRs #910/#911/#912/#913. آخر دليل #913 هو run `42773070284`، worker job `129685193847`: خمسة اختبارات فاشلة و2240 ناجحة. المقارنات المنقولة: `35.071205 > 17.091232`، و`50.067554 > 50`، و`35.677188 > 19.795352`، و`93.264199 > 50` ms؛ والخامس near-cap RETRY انتهى عند مهلة `20000` ms. لم تُجلب السجلات أو يُتحقق من ترتيب أسماء الحالات مقابل الأرقام هنا. لا ننسب الفشل إلى حمل runner ولا نعتبره flake.

اختبار `rating-claim-state-performance.spec.ts` يثبت من المصدر ثبات baseline عند `ec26930497f25213b62e2b60bc603af6b9ba3527` وفحص ملفات Lua الستة قبل تحميلها المعزول. لم نقرأ محتوى ذلك commit عبر Git لأن الأدوات ممنوعة في هذه المرحلة؛ لذلك لا ندّعي أن baseline يستخدم خوارزمية بعينها. المقارنة الفعلية المؤكدة هنا هي عقد الاختبار: baseline تاريخي مثبت مقابل نص SETTLE الحالي على نفس fixture، بكتل متبادلة، لا مقارنة مع main الحالي باعتباره baseline بديلًا.

## 2. حقائق مثبتة بقراءة المصدر

أرقام الأسطر في هذا القسم تشير إلى نسخة baseline المحلية قبل تعديل الـhelper في هذه المحاولة؛ وليست خريطة أسطر النسخة المعدلة.

1. `rating-claim-state-validate.lua.ts:199–243`: كل `exact_json` ينفذ `pcall(cjson.encode, value)` ثم يتخلص من النص الناجح. بعد ذلك يعيد بناء JSON كاملًا بـLua: أجزاء نصية، closure للإضافة، frames لكل قيمة، فحص تسلسل الجداول ثم `table.concat`.
2. `exact_number` في السطور 142–147 يحفظ كل الأعداد الصحيحة الآمنة كاملة بـ`%.0f`؛ التعليق يشرح أن cjson وحده يقرب إلى أربع عشرة خانة معنوية. حذف هذا المسار عمومًا يعيد عيب الدقة، وليس إصلاحًا مقبولًا للأداء.
3. `exact_string` في السطور 164–168 يبحث داخل النص عن فئة الهروب قبل اقتباسه، حتى عندما يكون padding طويلًا. هذا عمل إضافي فوق ترميز cjson، لكن لا توجد قياسات منفصلة لتكلفته هنا.
4. `rating-claim-state-settle.lua.ts:167، 178–179` قد يرمز الحالة ثلاث مرات عند إضافة RETRY: حساب السقف، ثم store، ثم reply الذي يضم الحالة. `store` يعيد أيضًا `validate_state`. مسار الإزالة أو overflow بالعدد لا يمر بحساب حجم الإضافة، لكنه يرمز في التخزين والرد. overflow بالبايت يعدل الحالة بعد حساب الحجم ثم يخزن النسخة المعدلة؛ إعادة استخدام النص بلا مراعاة ذلك غير صحيحة.
5. الملفات acquire/lease/reserve/settle/sweep تدرج نفس helper قبل reply. reserve يرد بحجوزات مختارة فقط؛ lease/read وBUSY/acquire قد يردان بحالة كاملة. لذا أثر أي تعديل للـhelper أوسع من settle وحده، ويجب حفظ العقود العشرة كلها.
6. اختبار الأداء يستخدم 2047/2048 إعادات، 75 بندًا، cap=`1048576`، وnear-cap=`CAP-128` مع padding نصي. خمس حالات تقيس الأمر كاملًا؛ إعداد fixture وSET خارج المؤقت، وفك الرد/قراءة الحالة وفحصها خارج عينة elapsed، لكنها تستهلك زمن الاختبار الكلي. لكل variant عشرون warmup ومئة عينة. بوابات p95 وmax والحد النسبي والصفحة الكاملة موجودة في السطور 140–219 ولا يجوز تغييرها.
7. `rating-claim-state-numeric.spec.ts` يغطي النسخ حتى MAX_SAFE، السور التالي، العدادات والتذاكر والرفض دون كتابة. `rating-claim-state-numeric-transitions.spec.ts` يغطي الأزمنة الموقعة، escapes، العربية، null، المجموعات الفارغة وعمق cjson الفعلي مع غلاف الرد. لم نجد في الملف المقروء حالة صريحة لعدد صحيح آمن مرتفع داخل حقل مجهول متداخل؛ هذه فجوة اختبار مهمة للـfast path المقترح، وليست إثبات عيب وظيفي في الكود الحالي.
8. `rating-claim-state-bytes.spec.ts` يغطي UTF-8 وحد البايت نفسه ورفض تجاوزه بواحد مع بقاء البايتات. `rating-claim-state-write-contract.spec.ts` يغطي ترتيب السور، rollback وOVERFLOW/LIMIT. `redis-rating-claim-state.codec.ts` يحتفظ بالحقول المجهولة ويصلح شكل المصفوفات الفارغة المعروفة؛ لا يجوز إسقاط unknown fields لتسريع الترميز.
9. `apps/worker/vitest.config.ts` يثبت timeout=`20000` وglobalSetup لقاعدة البيانات وجمع `src/**/*.spec.ts`. الـharness يستعمل اتصال Redis حقيقيًا، وقد يسقط إلى localhost؛ لا يُشغّل محليًا بمجرد تمرير اسم ملف اختبار.

## 3. فرضيات تحتاج إثباتًا

- إعادة الترميز وتخصيص frames مرشح قوي لتفسير الفارق عن baseline، لكن مساهمته الكمية ليست مثبتة. لا توجد هنا profiling أو عينة runtime جديدة تفصل decode وvalidation وserialization ونقل الرد.
- نتوقع أن الأرقام العادية في fixture والأزمنة الحالية أصغر من `10^14`، وأن مسار native cjson مع فحص الأعداد فقط يقلل الكلفة. يلزم تأكيد حد الأربع عشرة خانة والسلوك البايتي على cjson الفعلي في CI؛ لا نستنتج صلاحية التنفيذ من التعليق وحده.
- لا يوجد دليل أن تحسين helper وحده يحقق كل الحدود أو يمنع timeout للحالة near-cap RETRY. بقاء الفشل يعني تشخيص المحاولة، لا تخفيف البوابة أو تكرار التشغيل بلا إصلاح ذي صلة.

## 4. التوصية والمخاطر

الخطوة الأولى المقترحة بعد إدماج مشورة Astra المستقلة المنقولة من المدير: الاحتفاظ بنص cjson الناتج عن فحص القبول، ثم مسح كل القيم والمفاتيح المتداخلة بمكدس للحاويات فقط. المسار native يقبل الأعداد الصحيحة المحدودة ذات القيمة المطلقة <`100000000000000` فقط؛ الأعداد الأكبر والكسور وغير الآمنة ترجع إلى exact renderer بلا تغيير. الأشكال المقبولة: كائنات بمفاتيح نصية ومصفوفات متصلة وجداول فارغة؛ المختلط والمتناثر وبقية المفاتيح يرجع إلى fallback. غموض negative zero يستبعد المسار السريع لا الأمر؛ الصفر العادي يجب أن يظل مؤهلًا. لا تغيير لإعدادات cjson العامة أو لحدود العمق أو لقواعد state.

المشورة شددت خطة الاختبار: حدود `±(10^14-1)` و`±10^14` و`±(10^14+1)`، وMAX داخل حقول مجهولة متداخلة مع عدادات عادية، وfixture توافق مؤهلة مستقلة عن fixture الحالية التي تتضمن `-MAX`، مع إثبات byte cap وغلاف الرد والسور. أبقت settle بلا تعديل. نسبة تكلفة الترميز تظل فرضية؛ مهلة 20000 ms تخص الاختبار كاملًا لا الأمر الواحد. أي profiling تشخيصي مشروط بموافقة على مساره ويظل خارج مناطق قياس الحاجز الأصلي، ولا يحل محله.

المخاطر: تفويت عدد مجهول مرتفع، اختلاف طول تمثيل native عند السقف، اختلاف شكل جدول أو escape، تجاوز cjson depth في غلاف الرد، أو مكسب أقل من المطلوب. العلاج: اختبارات حقيقية موجهة ومقارنة byte compatibility على المسار العادي مع تشغيل كل الحواجز الحالية بلا تعديل. الحذف الصريح لمسار الدقة أو ترميم الرد بـregex أو placeholder مرفوض.

إعادة استخدام النص بين فحص الحجم وstore/reply خيار لاحق فقط: خطره أعلى بسبب تعديلات rollback وشرط قبول غلاف الرد. تحسين تخصيص exact renderer وحده خيار آخر، لكنه يبقي مسح النص وبناء جميع tokens. لا يُضاف أي منهما خلسة إلى النطاق الأولي.

## 5. النطاق والأدوار

نطاق العامل الأصلي: `spec.md` و`plan.md` و`diagnosis.ar.md` بهذا المجلد، و`apps/worker/src/modules/customers/persistence/rating-claim-state-validate.lua.ts` والاختبار الجديد فقط. كان الاختبار 203 أسطر عند baseline وأصبح 205 بعد تصحيح صيغة الحذف الثابتة. المدير يملك سجل المالك وverification. عدّ المدير الفعلي: helper إضافة 54 وحذف 6، والاختبار الجديد إضافة 205؛ المجموع **265**، داخل هدف <=400 والحد الأقصى 800. لا توسيع مسارات. سكربت settle وجميع الاختبارات القائمة read-only.

تحتفظ الجلسة الأصلية بملكية التنفيذ الأولي Sol medium وأي محاولة فاشلة حتى handoff سليم. مشورة Astra المكتملة وصلت عبر المدير وأُدمجت؛ هذا العامل لم ينشئ تفويضًا. checkpoint مراجعة الاختبار وbaseline اكتمل بحسب المدير، وأذن بتعديل helper وحده؛ checkpoint التالي قراءة كل الإنتاج المعدل قبل إعادة 458 اختبارًا والفحوص الساكنة. لا تغيير معماري أو سؤال عمل جديد. لا تواصل مستقل مع المالك أو الشريك. لا تعديل على PRs الأربعة أو migrations/index/config/workflow/lockfile/checker أو خادم أو أسرار.

## 6. ما لم يُشغّل

NOT RUN بواسطة هذا العامل: جميع أوامر shell/Git، تثبيت dependencies، typecheck، lint، lint:docs، module-map، formatting، الاختبارات الوظيفية، Redis، الأداء، full check، CI، bots، build، commit، PR، merge، deploy. إيصالات المدير المنقولة: تثبيت dependencies بـfrozen lockfile نجح خلال 30.6 ثانية، ونجحت builds لاعتمادات worker TypeScript؛ لم نتحقق منها استقلاليًا. لم تُقرأ environment أو secrets أو أي مسارات خارج worktree. لم تُستعمل execute/MCP/network/subagents.

تحديث CI-Q2 من المدير: إجابة المالك الحرفية `Approve private Redis`. المدير وحده ينشئ Redis 7 جديدًا مؤقتًا مملوكًا للمهمة، loopback-only، باعتمادات مستقلة وبلا persistent volume، للاختبارات الوظيفية المركزة فقط. لا تُستعار environment أو Redis من مهمة أخرى أو staging. هذا العامل لا ينشئ infrastructure ولا ينفذ أوامر أو يقرأ بيئة. المدير يشغل ملف Vitest خارجيًا بلا PostgreSQL global setup، مع إبقاء أجسام الاختبارات والـharness القائمة كما هي. الأداء الثقيل يبقى CI-only؛ لا نضبط CI محليًا. إن لزم profiling لاحق، يطلب المدير اعتماد مساره دون تغيير الحاجز.

إيصال baseline المنقول من المدير: Redis 7.4.11 خاص بالمهمة عند `127.0.0.1:54896`، باعتمادات مستقلة، بلا PostgreSQL أو نسخ environment. الاختبار الجديد `31/31 PASS` على helper غير المعدل؛ المجموعة المركزة من ثمانية ملفات `458/458 PASS` وexit 0 خلال `14.80s`، بما فيها العمق الفعلي والبايتات والدقة والسور والتلف. ضوابط تنسيق الأعداد لها إذن دليل runtime محلي منقول، لا قياس أداء ولا فشل وظيفي مصطنع. لم ينفذ هذا العامل الأوامر أو يتحقق من logs بنفسه.

ملف الاختبار الجديد يغطي حدود الدقة الموقعة، شجرة توافق مؤهلة مستقلة مع صفر عادي، الأشكال المتناثرة والمختلطة والمفاتيح، negative zero، fallback والرفض، MAX داخل حقول مجهولة متداخلة، التخزين والرد والسور وحد UTF-8. لا يفترض ترتيبًا canonical للكائنات ولا يعتبر نجاح القيم دليلًا على المسار الداخلي. اختبارات العمق الحالية تُعاد بلا نسخ بحث العمق. المراجعة الذاتية مصدرية فقط: real Redis بلا mocks أو elapsed assertions أو فحص نص التنفيذ.

الخوارزمية المكتوبة: فحص cjson أولًا دائمًا، ثم مسح كل الحاويات ومفاتيحها وقيمها بمكدس مراجع جداول فقط. الكائن النصي والمصفوفة المتصلة والفارغ مؤهلة؛ الأشكال الأخرى ترجع كلها للترميز الدقيق. الأعداد الصحيحة المحدودة بقيمة مطلقة <10^14 فقط مؤهلة مع استبعاد negative zero بـreciprocal؛ الصفر العادي يمر. المقارنات تستبعد NaN/infinity. عند النجاح يعاد نص cjson المقبول بالفعل؛ وإلا يحرر النص ويستعمل جسم exact renderer الحالي بلا تغيير. لا recursion أو تغيير إعدادات أو طفرة في القيمة أو regex لترميم tokens أو تغيير لكتابة Redis وغلاف الرد.

المراجعة الذاتية للعامل مصدرية فقط: فحص شمول الحقول المجهولة والمفاتيح وكثافة المصفوفة، الصفر، قبول cjson وعمق الغلاف قبل المسح، بقاء fallback وترتيب الرفض والكتابة، وعدم تغيير الاختبارات القائمة. تحقق المدير لاحقًا من التوافق باختبارات الصحة كما في الحالة الحالية وسجل verification؛ مكسب الأداء وتكلفة fallback يظلان بلا قياس قبول. العامل سلّم المصدر بلا أوامر أو تعديلات أخرى؛ اكتمال مراجعة Astra ثم draft CI هما الخطوة التالية، لا إعلان نجاح إصلاح.

## 7. ملحق CI-Q3 — قبول worker على الرأس ثم تشخيص admin فقط

قرأت سجل CI-Q3 حرفيًا؛ إجابة المالك `Expand #914 (Recommended)` تسمح باستثناء جمع العائقين في #914، لا خانة سادسة ولا تعديل #910–#913 ولا تخفيف gate. المدير يراجع الخطة شخصيًا قبل أي كود admin. الكتابة الحالية لهذه الوثائق الثلاث فقط؛ owner-questions وverification وإيصالات الخارج ملك المدير ولم تُعدل. Graphify ما زال غير متاح؛ القراءة محددة لمسار popup وimports المرتبطة. لم تُنفذ أوامر أو شبكة أو متصفح أو تفويض أو قراءة بيئة/أسرار/خارج worktree.

الدليل التالي من المدير وليس تشغيلًا هنا: الرأس `89dd5cb7def2825a49fe44712f1790fdfecc57c4` والأساس `ff551062ce56a9a57cd6aa7a9abd6f67e1a2bbb2`، run `42779559757`، merge checkout `dec9608952f987c945d68d8a1057d0eb2df80448` ذو أبوي main الحالي ورأس المهمة. worker job `129706106099` نجح `2276/2276` في 271 ملفًا والأداء `6/6` بكل الحدود والعينات الأصلية، على Redis 7.4.12 مع baseline `ec26930497f25213b62e2b60bc603af6b9ba3527` بلا تغيير. حالات الأداء الخمس، 20 warmups و100 samples، p95<=50 والحد النسبي وmax<=100، near-cap=1MiB-128 و75 settlements لكلا النسختين كلها ناجحة بحسب الإيصال. نسخة Redis المحلية السابقة 7.4.11 لا تحل محل هذا الإثبات. Astra `ses_e3b8c4c2bffeVG7gOlyWkZy2rv` لم يجد عيب worker قابلًا للإجراء. لا تحسين worker آخر مطلوب أو مأذون. هذا يلحق حالة القبول السابقة ولا يمحو تاريخ خطأي lint وتصحيحهما.

بقية checks العامة وأربع API shards وbuild كل التطبيقات وDocker نجحت بحسب المدير؛ aggregate CI بقي RED بسبب admin browser job `129711631294`: ثمانية فشل وثلاثة نجاح ثم ci-gate. الـPR draft؛ لا rerun أو review trigger أو merge/deploy. النجاح على هذا الرأس لا يُعمم على رأس لاحق ولا يساوي نجاح aggregate.

## 8. تحليل الفئات الثماني — المصدر مقابل الفرضية

### أ. sandbox، اختبار السطر 180: فشل تجهيز وليس إثبات رفض popup

`employee-document-popup.pw.ts:84–115` يفتح صفحة blank من origin الوجهة ثم iframe staff مع `allow-scripts allow-same-origin` واختلاف `allow-popups` فقط. السقوط في اختيار workspace قبل فتح الوثيقة. التشخيص المنقول يثبت frame staff موجودًا وحالته complete بأبعاد 300x150 وعدد `workspace-company` صفر. complete لا يثبت hydration أو نجاح session/workspace API أو جاهزية UI. المسار الحقيقي يمر بـSessionGate/server-session ثم DocumentShell/QueryProvider ثم WorkspaceProvider. لم نجد سببًا مثبتًا يبرر تعديل auth أو policy أو backend؛ الحجم الافتراضي/التهيئة/رفض طلب/خطأ JavaScript فرضيات منفصلة. المطلوب stdout محدود لحالة body/roles والطلبات/الأخطاء قبل تغيير fixture؛ لا إسقاط sandbox الحقيقي أو المرور فوق workspace.

### ب. network، اختبارا 200 و266: تدمير response لا يثبت رفض fetch

`employee-document-popup-fixture.ts:91–106` يزيل held الأول للمفتاح، ثم `response.destroy()` لحالة network، ثم يحل promise الخاص بالـfixture. `employee-document-open.ts:191–220` ينتظر POST؛ عند رفضه يفترض إغلاق النافذة المملوكة وإظهار retry آمن. وحدة `employee-document-open.spec.tsx:137–151` تغطي POST مرفوضًا وتثبت الإغلاق والعرض الآمن. الـbrowser أثبت أن النافذة بقيت مفتوحة حتى timeout، لا أن fetch رفض أصلًا. احتمال retry نقل من المتصفح أو POST بديل معلق يحتاج عدّ ledger وrequestfailed/status/close؛ واحتمال عيب cleanup إذا ثبت رفض fetch يحتاج إثبات مستقل. لا نضيف timeout أو retry للإنتاج تخمينًا ولا نبدل transport failure بـHTTP denial ونزعم نفس التغطية.

### ج. أربعة اختبارات focus/visibility: شرط hidden لم يحدث

الفشلان 403 و404، واختبار key disappearance، واختبار query recovery تتوقف جميعًا عند السطر 134 في `nativeFocusCycle`. المصدر ينشئ صفحة أخرى ويتنقل بها، ثم ينتظر الأصل hidden، قبل `page.bringToFront()`؛ لا يستدعي foreground للصفحة الأخرى أولًا. المشاهدة CI هي visible. النتيجة المثبتة: شرط native visibility لم يتحقق، لذلك لا نستنتج أن منطق 403/404 أو اختفاء المفتاح معطل. Playwright config لا يحدد إعداد foreground خاصًا، وCI يبني admin الفعلي ويشغل Chromium العادي بعامل واحد وretries=0. كفاية `other.bringToFront` أو حاجة بيئة المتصفح لتغيير نمط التشغيل ما زالت تحتاج CI. لا dispatch لأحداث مزيفة أو تعريف visibility property ولا حذف شرط hidden.

### د. closed blank، السطر 354: مسارات الملاحظة ليست نفس حدث Playwright close

`watchOpen:125–144` يعيد فحص `.closed` على focus/visibility أو cache notification؛ لا timer ولا مراقب مستقل لـPlaywright Page.close. UI تربط تعطيل الأزرار بـopening، بينما `beginOpen` يستطيع استبدال previous مغلق فقط عند استدعائه. اختبار الوحدة 188–214 يغير closed ثم يرسل focus صراحة؛ اختبار المتصفح يغلق popup ثم يفترض أن bringToFront للأصل سيعطي الحدث. استمرار disabled مثبت؛ غياب الحدث الطبيعي أو عيب responsiveness إنتاجي فرضيتان تحتاجان counters فعلية. لا polling جديد قبل سبب وحالة فشل محددة، ولا حدث صناعي بدل اختبار native.

### هـ. unit race السابق #911 — لا يُضم سببيًا للمتصفح

`employee-document-notification-race.spec.tsx:149–179` يزيل query ويعيده يدويًا، يحل الرد القديم، ثم ينفذ قراءة genuine، ينتظر نص الورقة ويطلب زر Open فورًا. `employee-documents-section.tsx:36–38` يعيد null عند غياب `isFetchedAfterMount` أو data، بينما witness الفتح في `noteRead` لا يقبل إلا success غير manual للـquery المثبتة. empty div يطابق بوابة readiness في المصدر، لكنه لا يثبت أي انتقال أو observer فقد الجاهزية أو متى حدث render. انتظار نص ليس نفس انتظار زر صالح؛ لا نختار مزامنة اختبار بدل إصلاح إنتاج إلا بعد ترتيب إشعارات مضبوط ودليل. لا حذف fresh-read guard أو قبول manual restore. نجاح check الحالي ليس إيصال إصلاح للسباق السابق. مصدر TanStack المثبت لم يتوفر في موضع worktree المحدد الذي جُرب؛ لا قراءة لمخزن خارجي ولا ادعاء عن internals غير مقروءة.

## 9. حدود front/back والدليل المفقود

المسار UI/hook/open الخاص بـadmin هو محل المراجعة؛ client يستخدم openapi-fetch وcredentials/include وcompany header، والـmutation يحدد retry=false. اختبارات browser تستعمل route حقيقيًا وبناء production حقيقيًا، لكن API server في ملف fixture يعيد session/documents اصطناعية ويضبط CORS وقائمة طرق محددة. هذا ليس backend/RLS/audit proof ولا مبرر لتعديل صلاحيات backend أو policy. مرجع بيئة التشغيل المقروء `.github/workflows/ci.yml:449–530` و`apps/admin/playwright.config.ts` وpackage/Next/Vitest configs؛ قراءتها لا تعطي إذن تعديلها.

أبلغ المدير أن artifacts الستة فقط هي telemetry لـAPI1–4 وworker/check؛ لا screenshots أو traces أو error-context أو server-log artifact للمتصفح. مسارات Error Context المطبوعة ليست ملفًا متاحًا للتحقيق. لذا الإجراء التالي إن لم تحسم الوحدة السبب هو دفع CI ذي تغيير تشخيصي ضيق ومراجع ومخرجات stdout، لا إعادة تشغيل رأس فاشل بلا تغيير أو الاتكال على artifacts غير موجودة.

## 10. الخطة المقترحة والحجم والتوقف

قائمة checkpoint الأولى المقترحة الدقيقة، بعد مراجعة المدير فقط: `apps/admin/e2e/employee-document-popup.pw.ts` لمشاهدات stdout محدودة عند الفشل، و`apps/admin/e2e/employee-document-popup-fixture.ts` لأحداث نقل اصطناعية إذا لم تكف ledger الحالية، و`apps/admin/src/staff/api/employee-document-notification-race.spec.tsx` لحالة query/event-order مضبوطة. لا تغيير thresholds/timeouts/skips/assertions أو fake window/visibility. لا طباعة headers/cookies/body/capability URLs؛ فقط path منزوع query وstatus/error categories/counters وحالة native.

هدف checkpoint المقترح 85–125 إضافة+حذف؛ مع worker الحالي 265 يصبح 350–390 داخل هدف400. لكن إصلاح كل الفئات بعد إثباتها قد يحتاج 180–360 admin، أي 445–625 إجماليًا: يتجاوز الهدف400 ويحتاج مراجعة واعتماد تقدير من المدير قبل التنفيذ، وإن بقي تحت hard800. لا تُفهم CI-Q3 على أنها رفعت سقف الحجم. المسارات الإنتاجية المحتملة لاحقًا فقط وبحسب العيب: employee-document-open.ts وuse-employee-documents.ts وui/employee-documents-section.tsx؛ ليست إذن كتابة مفتوحًا. إن لزم config/workflow أو infrastructure أو تجاوز800 نتوقف ونرفع للمدير قبل أي تغيير.

الخطة المحلية tests-first فقط بعد قراءة المدير لكل سطر: ملفات jsdom المركزة الخاصة بالوثائق والسباق، بترتيب إشعارات وpromises مضبوط، لا تكرار لإخفاء فشل ولا mock-only UI assertion. heavy browser/production build والنقل/المتصفح native على CI القائم فقط؛ لا صلاحية infrastructure إضافية من Redis الخاص ولا تشغيل E2E محلي. كل الحواجز العامة وworker performance تعاد على الرأس اللاحق قبل القبول. الخطة التفصيلية وcommand المقترح NOT RUN في plan؛ هذا العامل لم يشغل أي أمر أو اختبار أو متصفح أو شبكة. لا تغيير كود/اختبار/config في هذه المرحلة. السؤال المطلوب من المدير الآن هو اعتماد checkpoint التشخيصي <=125 فقط أو مراجعة envelope الكامل قبل التنفيذ، وليس إعادة سؤال أعمال محسوم للمالك.

## 11. اعتماد checkpoint المصحح — تحديث قبل الكود

المدير راجع المصادر والخطة شخصيًا، واكتملت مشورة Astra `ses_e3b5dc45effeOCw6Qyo0ZAmlY9`. المأذون فقط <=125 إضافة+حذف admin، مع worker265 يصبح <=390؛ لا اعتماد envelope الأكبر أو تعديل إنتاج/launch/config/CDP. المسارات الدقيقة: popup.pw.ts، وpopup-fixture.ts لتشخيص اختياري صغير فقط، وnotification-race.spec.tsx القائمة، والوثائق الثلاث. المدير يقرأ كل سطر قبل التنفيذ؛ هذا العامل لا ينفذ أوامر.

سبب sandbox المصدرّي ثبت الآن بقراءة AppSidebar وAppSidebarDrawer وDashboardSidebar: عند عرض أقل من768 يُستعمل drawer مغلق، وWorkspaceSelector داخل header غير المركب. iframe الافتراضي300x150 لا يحقق شرط desktop للسيناريو. التصحيح المأذون يضع1280x720 لكلا الضابطين الممنوع والمسموح مع بقاء flags والتأكيدات كلها. نجاح بقية bootstrap والمتصفح ما زال يحتاج CI.

قرأت مصدر Playwright المثبت داخل worktree: تفعيل focus emulation للـmain frames العادية، وbringToFront يرسل Page.bringToFront فقط؛ قد يفسر الحالة visible لكنه ليس إثبات runtime أو إذن تغيير المحاكاة. قرأت TanStack queryObserver داخل worktree عند575 و709–711 و805–820: rebind يثبت initial state جديدة، وisFetchedAfterMount تقارن العدادات بها. عبارة عدم توفر المصدر في الملحق السابق تاريخ لمحاولة glob لم تُصب الملف، وليست قيدًا حاليًا. لا مخزن خارج worktree أو شبكة استُخدما.

إيصال المدير المستقل: baseline خمسة ملفات jsdom مقروءة عبر runner خارجي fail-closed بلا خدمات/E2E:27/27 PASS بلا skip خلال71.08s؛ الحالة القديمة للسباق نجحت187ms. هذه أزمنة correctness فقط ولا تثبت إصلاح سباق CI السابق أو قبول browser. لم ينفذها العامل.

التشخيص المكتوب لاحقًا سيكون stdout عند الفشل فقط، ring محدود مع overflow، تصنيفات ثابتة وأعداد وحالات native فقط، وتسجيل قبل navigation/actions يشمل الصفحات الجديدة. لا نص console/error أو URLs/paths خام أو ledger payload أو أسباب rejection أو قدرات. يُستبدل dump sandbox القديم غير الآمن، ولا يفشل cleanup/diagnostics بدل الخطأ الأصلي. fixture لا يتغير سلوكه؛ إن لزمت counters مستقبلًا تُربط بمرجع حالة الاختبار كي لا تتسرب close callbacks بعد reset.

تمديد نفس اختبار query remove/recreate سيكون بقراءة مؤجلة وإشعارات مضبوطة وdrain محدود يفشل عند الحلقة، مع هوية القديم/المثبت وتوقيت اكتمال القراءة قبل/بعد rebind، وتمييز قراءة observer من explicit. لا انتظار أطول فقط، ولا حذف حماية stale/manual restore. يجب رؤية زر صالح واستخدام successor؛ إن كشف الاختبار خسارة جاهزية فعلية يبقى RED ويرجع للمدير بلا patch إنتاجي. لا شيء يشمل تعديل guards أو اختبارات رفض POST/close-focus المكررة القائمة.

## 12. توقف الحجم قبل اكتمال checkpoint — المصدر جزئي وغير جاهز للتنفيذ

عُدل popup.pw.ts وحده: iframe1280x720 لكلا الضابطين، حذف dump sandbox غير الآمن، ومشاهدات context محدودة قبل actions تشمل الصفحات الجديدة، requestfailed وresponse وpageerror بتصنيفات ثابتة فقط. ring16 واحتفاظ8 صفحات وأربعة frames لكل صفحة مع overflow، وإخراج عند الفشل فقط. لا نص console/error أو URL/path خام أو أسباب rejection أو ledger/headers/body/capabilities. الحالة native تُقرأ فقط؛ أحداث focus830/visibility830 الأصلية يرافقها boolean يبين إن كانت أصلًا مركبة. cleanup في finally وأي رفض تشخيصي يُلتقط فلا يستبدل فشل الاختبار؛ تأكيد unknown ledger باقٍ. لا تعديل fixture أو نقل أو query/production/launch/config.

العدّ المصدري التقريبي، بلا Git: sandbox حذف25 وإضافة1؛ iframe حذف1 وإضافة1؛ hooks حذف2 وإضافة64: المجموع94 admin، ومع worker265 يصبح359. الملف أصبح416 سطرًا قبل formatting بدل378، وهو يتجاوز حد400 في قواعد المشروع. تمديد الوحدة المطلوب لم يُكتب؛ يحتاج40–60 إضافة+حذف أخرى، فيصبح checkpoint134–154 قبل formatting، أعلى من125 المعتمد. يتبقى31 فقط في checkpoint؛ لا نخفي عدد الأسطر أو نضغط المنطق لتجاوز القاعدة.

توقفت قبل125. المسودة ليست handoff تشغيل/CI جاهزًا. القرار المطلوب من المدير هو إعادة تخصيص checkpoint/اعتماد مسار helper تشخيصي صغير أو مراجعة ميزانية/تصميم النطاق قبل أي كود إضافي؛ لا ملف جديد أو eslint disable أو نقل browser code لملف server fixture للتحايل. envelope الأكبر ما زال غير معتمد. لم تُشغّل أوامر أو فحوص أو متصفح أو شبكة. نفس العامل يحتفظ بالمحاولة الجزئية؛ المدير يملك مراجعتها وسجل الإيصالات.

## 13. اعتماد المدير المحدود بعد STOP — قبل استكمال الكود

المدير راجع94 الفعلية(66 إضافة/28 حذف) والقواعد، واعتمد <=220 إضافة+حذف ADMIN مقابل الرأس المنشور89dd5cb7، مع worker265 يصبح<=485. هدف400 عُدل صراحة لهذا checkpoint فقط؛ hard800 ثابت، ولا إذن envelope كامل أو production/CDP/headed/config/workflow. النطاق الدقيق popup.pw.ts وملف NEW popup-diagnostics.ts المتماسك للرصد وnotification-race.spec.tsx القائمة. Node fixture أصبح read-only. المدير يملك توثيق القرار في verification؛ لا سؤال مالك إضافي أو تعديل owner audit من العامل.

تصحيح استنتاج الحجم: max-lines400/function60 في ESLint تستثني blank/comments؛416 سطرًا ماديًا ليست وحدها إثبات lint failure. الفحوص NOT RUN. فصل الرصد مبرر بمسؤولية مستقلة لا تقسيم اعتباطي لتجاوز الحد.

التصحيحات المطلوبة للرصد: start/finish مع failed/status لتفريق POST معلق من تكراره، وتصنيف ثابت مع fallback آمن إذا فشل URL parsing. counters رصد passive لـfocus/visibility قبل navigation تشمل صفحات/frames جديدة، بأسماء مختلفة عن830 ودون تغيير native behavior. ring/pages/frames محدودة وoverflow، ومهلة best-effort صغيرة تشمل evaluate/التجميع/ledger، وإزالة context listeners في finally وعدم إخفاء فشل التأكيد الأصلي. الإخراج categories وأعداد/booleans/enums فقط؛ ledger أعداد فقط ولا console/error/URL/capability خام. لا تغيير fixture أو callbacks بعدreset أصلًا. catch الصامت خاص بالرصد الاختياري لا business errors.

الوحدة تستكمل نفس الحالة بترتيبين قبل/بعدrebind، هوية القديم/المثبت وقراءات observer وexplicit منفصلة مؤجلة وdrain محدود داخلact؛ القديم لا يعود وmanualrestore ليست قراءة. رؤية زر صالح ثم استخدام successor مطلوبة. أي RED جاهزية يبقى للمدير بلا patch إنتاج. العد النهائي يحتسب helper كله ووجهي الاستبدالات مقابل published head، لا تكرار نقل المسودة. العامل لا ينفذ شيئًا والمدير يقرأ كل سطر قبل الأوامر.

## 14. تسليم المصدر المنقح فقط — بلا تشغيل

عُدلت المسارات الثلاثة المعتمدة فقط: popup.pw.ts، NEW popup-diagnostics.ts، وnotification-race.spec.tsx، مع الوثائق الثلاث. بقي worker وNodefixture والإنتاج/config/workflow/dependencies بلا تعديل. بقيت كل تأكيدات browser والـflags والعتبات والمهل الأصلية، وunknown-ledger assertion حرفيًا كما هي.

helper متماسك للرصد الاختياري: categories ثابتة بعد parsing آمن مع other عند الفشل؛ counts لـstart/finish/failed/status وcreated/pageerror، وring16 مع overflow، وصفحات8 وframes4 لكل صفحة. focus/visibility passive قبل navigation في context الجديدة وبأسماء popupDiag مستقلة عن830. ملخص فشل فقط بمهلة best-effort500ms وتصنيف unavailable ثابت؛ تنظيفcontext listeners فيfinally والتقاط رفض الرصد قبل assertion الأصلي. المهلة تحد الانتظار ولا تزعم إلغاء evaluate العالق؛ التخلص من context يبقى في دورة الاختبار. لا أحداث مصطنعة أو تعديل nativeproperty أو أسرار/نصوص أخطاء/console/URLs خام. لم يُضف fetch للـledger اختياريًا: counts المتصفح تكفي للدليل الأول عن النقل، والقراءة/التأكيد الأصليان بلا تغيير. لا callbacks لخادم fixture أو تسرب بعدreset أُدخلت.

نفس حالة إزالةquery صارت ترتيبين مضبوطين: هوية القديمة/المثبتة، explicit read مؤجلة وobserver GET منفصلة، drain داخلact بحد10 يفشل إن لم يفرغ. يقاس وجود observer عند اكتمالexplicit، ويُثبت عدم خلط قراءة observer معها، ثم يلزم زرaccessible ظاهر وممكن وخطوة successor مع منعold navigation. manual-restore-denial القائمة لم تتغير، وتُحرر observer promise فيfinally. قرأت QueryClient.query المثبتة563–604؛ تبني/fetch query بلا QueryObserver إضافية، لذلك العد هنا يميز rebind المكون. BEFORE قد يكشف RED الجاهزية المحتملة عند reset baseline وGETobserver معلقة؛ هذه فرضية مصدرية لا نتيجة تشغيل. لا patch إنتاج أو تخفيف إذا فشل؛ AFTER هو الضابط المقابل.

التقدير المصدري النهائي مقابل89dd5cb7، بلا Git: popup13 إضافة/28 حذف=41، helper107 إضافة، الوحدة60 إضافة/10 حذف=70؛ ADMIN218 ومع worker265 يصبح483. المتبقي سطران فقط قبل220؛ المدير يتحقق من diff/formatting ويتوقف للمراجعة إن تجاوزها، لا ننقل الحد خلسة أو نحتسب نقل partialdraft مرتين. قاعدة max-lines تستثني blank/comments كما صححنا؛ الفصل مسؤولية لا تحايل.

المراجعة الذاتية مصدرية للرصد المحدود والخصوصية والتنظيف والأحداثpassive والهوية وقيود الكتابة والحواجز. كل الأوامر والفحوص/format/type/lint/tests/browser/CI/Git/infra/network NOT RUN بواسطة العامل. baseline27/27 السابق من المدير فقط، ولا نجاح جديد مزعوم. المدير يقرأ كل الكود والاختبار ثم يملك التشغيل المحدود ومشورةAstra علىdiff الفعلي قبلpush تشخيصي موحد ذي صلة؛ لا مراجعات خارجية/merge/deploy. نفس الجلسة تحتفظ بأي RED أولي حتىhandoff سليم.

## 15. أول تشغيل للترتيبين وفصل أثر الموك — إصلاح سطر واحد فقط

إيصال المدير: قرأ كل diff الفعلي وأكد 218 admin / 483 إجماليًا، ونجح Scoped Prettier وdiff check قبل التشغيل. نتيجة تشغيل خمسة ملفات jsdom: فشلان و26 نجاحًا من28، exit1، خلال26.13s. فشل BEFORE عند findByRole لزر Open بمهلة4000ms في السطر215 مع empty div. وفشل AFTER أبكر عند pending.close في السطر205، المتوقع1 والفعلي0، قبل completeRead. هذه نتائج المدير الفعلية، لا تشغيل العامل ولا قبول browser، ولا تُمحى.

فرضية AFTER: الدالة api.POST مشتركة وhoisted، وكل variant يضيف once chain بلا reset. يخرج BEFORE قبل POST الثاني، فيمكن أن تظل نتيجة successor الأولى في الطابور؛ وقد تسبق promise المعلقة الجديدة في AFTER وتُسلّم النافذة بدل بقائها pending، ما قد يفسر عدم إغلاقها عند remove. المصدر ومكان الفشل يدعمان الفرضية، لكن لا يوجد queue trace مثبت ولا حكم إنتاجي حتى إعادة الضابط بمعزل عن الحالة السابقة.

التعديل المأذون والمكتوب وحده هو `api.POST.mockReset();` كسطر مستقل مباشرة قبل once chain للحالة المعاملية. ينظف mockReset الطابور وhistory؛ أما mockClear فلا يزيل once queue. بقي GET والإشعارات والترتيب والتأكيدات والguards والمهل بلا تغيير. التقدير219 admin / 484 إجماليًا، ويتبقى سطر واحد حتى220. يراجع المدير السطر ثم يعيد المجموعة من جديد. كل فحوص ما بعد التصحيح NOT RUN بواسطة العامل، ولا ادعاء PASS بعده. المحاولة الأولية الفاشلة ما زالت ملك العامل نفسه.

## 16. تشخيص جاهزية BEFORE وخطة مشروطة فقط — بلا تعديل إنتاجي

المثبت حاليًا هو فشل ترتيب BEFORE بصورة empty div بعد الوصول إلى ضوابط القراءة الحقيقية، لا اكتمال السبب. ينبغي أولًا نجاح AFTER بمعزل عن طابور POST السابق وبقاء BEFORE قابلًا للإعادة بعد reset. إن بقي AFTER فاشلًا نحقق مرحلته قبل أي patch للجاهزية.

الانتقال المطلوب إثباته: lifetime مركبة مع Query A ومحاولة معلقة؛ إزالة A ثم manual data على Query B مختلفة تبطل المحاولة القديمة. تنجح قراءة حقيقية على B وهي installed وبنفس lifetime، مع observer GET مؤجلة ومنفصلة، ونعرف هل نجاح explicit سبق rebind أم تلاه. يختار queryObserver في المصدر المثبت state الجديدة كـinitial عند queryChange ثم يحفظها عند updateQuery؛ وتقارن isFetchedAfterMount عدادات التحديث بذلك baseline. لذلك قد يدخل نجاح حقيقي قبل rebind في baseline نفسه، فيبقى flag بقيمة false وترد UI بالقيمة null. بالمقابل تقبل noteRead فقط نجاحًا nonmanual على installed query وبـOpenLife حية، وتقارن witnessed نفس الهوية. مشاهدة B متوقعة من المصدر، لكنها ليست قياسًا مباشرًا لـlife.query من empty div؛ يلزم دليل event/lifetime مع الضابط المعزول قبل حكم سببي كامل.

لا تعديل لـisFetchedAfterMount أو permission/read-witness guards الآن. الخيار المستقبلي الخاص للمراجعة هو DeclaredRead مؤقتة مرتبطة بـlifetime/scope/key/query identity والبيانات نفسها، لا cached-success boolean. تُنشأ من قراءة validated/nonmanual فعلية بعد بدء lifetime فقط. تفقدها removal/replacement/unmount/scope/denial/error الجاهزية، ولا تنشئها manual restore أو تعيدها. لا يستعمل العرض payload قديمة لـobserver بسلطة query أخرى، ولا تبدل receipt فحوص permission/epoch/listed-key/owned-window/stale-attempt. نجاح B الجديد لا يحيي محاولة A القديمة.

الخيار الآخر للمراجعة هو تنسيق قراءة حقيقية بعد rebind مع إبقاء guard الخاصة بالـobserver كما هي. قد يحتاج GET إضافية، ولا يثبت أن BEFORE تصبح جاهزة والـobserver GET معلقة. لا كاش مصطنع أو تغيير عدادات/إعدادات global أو OR ساذجة مع cached data. يُراجع العقد أولًا؛ هذه ليست إذنًا بحذف guard أو استبدالها أو تخفيف الاختبار.

المسارات الممكنة لاحقًا فقط: employee-document-open.ts للمشاهدة/receipt، وuse-employee-documents.ts لإسقاط reactive خاص، وui/employee-documents-section.tsx لاستهلاك guarded بعقد مراجع، وnotification-race.spec.tsx للإثبات. التقدير الإضافي80–140 إضافة وحذف مع tests، أي564–624 إجماليًا انطلاقًا من484؛ وهو فوق checkpoint الحالية ويحتاج تفويض نطاق وتقدير جديدين قبل الكود، وليس اعتمادًا للـenvelope الأكبر. يبقى hard800 ثابتًا. تحفظ الاختبارات المطلوبة رفض manual-only/removed/late-read، وفحوص403/404/scope/key-loss وعدم revival والـsuccessor المستقل، مع browser وCI الأصليين. هذه خطة مصدرية فقط؛ لم ينفذ العامل أوامر أو يعدل إنتاجًا.

## 17. إثبات المدير المعزول وتصحيح lint للـhook فقط

راجع المدير سطر POST reset قبل التشغيل. نتيجة الزوج المعزول: BEFORE بقي RED عند findByRole Open في216، بمهلة4000ms وempty div؛ AFTER نجح165ms. توجد ثلاثة filtered skips، وexit1 خلال10.25s؛ الترشيح ليس قبولًا للحواجز.

ثم نفذ المدير plugin رصد Vite خارجية في الذاكرة وread-only، بلا probe متتبعة أو observer جديدة أو تغيير assertions/scheduler/timing. رصد BEFORE نجاحًا nonmanual واحدًا على نفس installed query، status=success، وتطابق البيانات مع القراءة الحقيقية، وdataUpdateCount2. نتيجة observer تحتوي بيانات بلا خطأ لكن isFetchedAfterMount=false، مع DOM فارغة. رصد AFTER نفس القيم عدا isFetchedAfterMount=true ونجح207ms. نتيجة الإثبات: فشل واحد ونجاح واحد وثلاثة filtered skips، exit1 خلال10.00s. هذا يدعم سببية observer-baseline mismatch في السيناريو المضبوط، وليس إثبات هوية كل حادثة CI سابقة أو اكتمال إصلاح admin/browser. لم يشغّل العامل الإثبات أو يقرأ إعداداته الخارجية.

إيصال static من المدير: نجح كلا tsc للـadmin الرئيسي وE2E. فشل lint بخطأ جديد واحد no-empty-pattern عند popup.pw.ts129:23، مع14 تحذيرًا قائمة في ملفات ReactCompiler غير المعدلة؛ لم يظهر خطأ حجم helper. يبقى هذا الفشل في تاريخ المحاولة الأولية ولا تمحوه الإيصالات السابقة.

التعديل المأذون والمكتوب وحده: afterEach بتوقيع async بلا destructuring، ثم `const info = test.info();` داخلها. شرط فشل التشخيص وتأكيد unknown-ledger كما هما. التوقيع السابق جديد أصلًا مقابل published head، لذلك الزيادة النهائية المتوقعة سطر واحد:220 admin /485 إجماليًا، عند الحد تمامًا، ويؤكد المدير عدّ Git. لا تعديل آخر في اختبار أو helper أو fixture أو الإنتاج أو config/launch/worker. كل فحوص ما بعد التصحيح NOT RUN بواسطة العامل، ولا ادعاء PASS بعده.

مشورة Astra CONTRACT المستقلة على دليل الجاهزية ما زالت جارية في الجلسة الاستشارية المحفوظة. لا تكرار لعملها ولا تفويض إنتاج من إصلاح lint؛ ننتظرها ومراجعة المدير الشخصية للعقد والنطاق. الخطة السابقة مشروطة فقط. نفس العامل يحتفظ بالمحاولة ويسلم المصدر بلا أوامر أو متصفح أو شبكة أو قراءة خارجية.

## 18. اعتماد عقد الجاهزية المحدود — قبل الكود

أكد المدير عدّ220 admin/485 إجماليًا، وراجع شخصيًا مشورة Astra CONTRACT المكتملة والمصدر والإثبات. المأذون الآن فقط إصلاح جاهزية محدود: هدف80–140 إضافة وحذف أخرى للإنتاج والاختبارات، والتوقف عند160 إضافية مقابل checkpoint الحالية، وإجمالي<=645 مع hard800 ثابت. المسارات الدقيقة داخل staff: api/employee-document-open.ts، وapi/use-employee-documents.ts، وui/employee-documents-section.tsx، وapi/employee-document-notification-race.spec.tsx لنواقص سلبية فقط. الزوج BEFORE/AFTER وضوابطه تبقى حرفيًا كما هي. كل E2E/helper/fixture/worker/config/workflow/dependencies read-only؛ لا تفويض إضافي لإصلاح focus/network/closed-blank.

العقد يعيد استعمال OpenLife.query/noteRead/witnessed كدليل القراءة التاريخي الوحيد، بلا tracker/map/receipt payload أو observer أو سلطة إذن جديدة. الإسقاط الحي يتحقق من lifetime الحالية الحية وربط scope/client/key حتى قبل effects، وهوية query المثبتة المشهودة، وصلاحية access القائمة mounted/readable، ونجاح installed query ووجود data، ونجاح observer بلا خطأ وتطابق data مع CURRENT installed data. يعيد بيانات query الحالية، وكل table/form/UI مشتقة منها. تبقى error presentation وopening وvalidated GET كما هي.

تصحيح صريح لاقتراحات §16 القديمة: error مؤقتة أو manual update لنفس query المشهودة والمثبتة لا تمحو التاريخ. لكنها لا تعطي جاهزية أثناء error أو فشل القراءة الحالية. لا يصنع manual قبل القراءة الحقيقية أو بعد replacement إثباتًا. يمكن لاستعادة المفتاح في نفس query تمكين successor مستقلة لا المحاولة الملغاة؛ ويمكن لاستعادة can_manage إظهار form لا إحياء نتيجة writer قديمة. لا ربط بآخر payload genuine بدل البيانات الحالية، ولا تغيير begin/settlement/epoch/key/ownership/stale guards.

المراقب يحدّث witness ويعيد تقييم المحاولة أولًا ثم يطلب render revision بلا سلطة. فقط removal وsuccess/error/setState ذات صلة؛ لا observer metadata التي قد تصنع loop. callbacks المؤجلة تتحقق من العمر والربط الحالي، لا تحمل ready=true محسوبة مسبقًا، وتُثبط بعد cleanup/replacement/StrictMode. getter إن استعمل للإسقاط يعيد فحص الحقائق الحالية حتى عند احتفاظ المستهلك بنتيجة observer قديمة، لا يخزن إثباتًا آخر.

الإثبات السلبي الناقص فقط: A المشهودة لا تخول B غير المشهودة مع نفس data reference؛ observer قديمة لا تعرض payload مختلفة عن المثبتة؛ وإشعار readiness مؤجل لا يعبر lifetime/scope cleanup. يكون ذلك بكاش ومراقب حقيقيين وReact UI/hook، لا تزوير witness أو mock helper. باقي مصفوفة الرفض والـStrictMode/الكتابة مغطاة ويعاد استعمالها. المدير يقرأ كل سطر قبل التشغيل ثم يملك checks والمراجعة المستقلة والـCI؛ العامل لم ينفذ شيئًا ولا يعلن إصلاح كل admin. تاريخ lint السابق محفوظ وتصحيح hook الأخير بلا rerun جديد مسجل هنا.

## 19. تسليم مصدر الجاهزية — بلا تشغيل

اقتصر الكود على المسارات الأربعة المأذونة. أضيف readReadyData فوق witness القائمة مع فحص lifetime/scope/client/key والـquery المثبتة والنجاح والبيانات الحالية وaccess وobserver المتطابقة. المراقب يحدّث الدليل ويلغي المحاولات غير الصالحة قبل طلب revision غير مخولة؛ لا ينشر observer metadata، ويثبط callbacks القديمة. الـhook يربط العمر ويعيد حساب الإسقاط عند قراءة getter، والواجهة تستعمل documents المحمية لكل table/form مشتقة. لا receipt أو map أو observer أو سلطة إذن جديدة، ولا تغيير beginOpen/settlement/epochs/membership/ownership أو validated GET.

أضيف اختبار واحد بكاش وhook وReact حقيقية: جاهزية أولية، ثم A وB بهوية مختلفة ونفس data reference، ورفض B قبل قراءة حقيقية، والتعافي بعدها، ورفض observer محفوظة ببيانات قديمة بعد تحديث الحالية، وعرض Changed، ثم رفض scope جديدة بعد تفريغ إشعارات العمر السابق. توجد تأكيدات نص واجهة وهوية query وطابور غير فارغ، لا مجرد mock calls. الزوج المضبوط وPOST reset وترتيبه وloop10 والمهل وكل تأكيداته لم تتغير، وكذلك الاختبارات السلبية السابقة.

التقدير اليدوي النهائي147 إضافة وحذف إضافية، وإجمالي632 مقابل485 المؤكدة سابقًا؛ أقل من حد160/645 بمقدار13، وأعلى من الهدف140 بمقدار7. ليس هذا عدّ Git أو formatter؛ يؤكده المدير قبل القبول. المراجعة المصدرية فحصت الدليل الواحد والهوية المستقلة عن payload وتطابق البيانات الحالية وaccess وحفظ التعافي التاريخي وتنظيف العمر ومنع metadata loop والسلطة المؤجلة. لا نتيجة runtime أو lint أو format مستنتجة منها.

كل فحوص ما بعد التعديل NOT RUN بواسطة العامل، بما فيها إعادة lint لتصحيح hook السابق. المدير يقرأ كل سطر ثم يؤكد العدّ ويشغل المجموعة والزوج الأصليين بلا plugin الرصد، وكلا tsc وlint/format/docs/module-map/diff، ثم مراجعة Astra جديدة للـdiff الفعلية. تبقى ملكية المحاولة الأصلية حتى الفحوص والمراجعة. لا أوامر أو Git أو MCP أو متصفح أو شبكة أو قراءة خارجية أو subagent أو trigger مراجعة أو merge/deploy. أسباب native focus/network/closed-blank والقبول الإجمالي ما زالت غير محسومة وخارج التفويض.

## 20. عيب P2 مثبت في المراجعة — الحالة BLOCKED

إيصالات المدير فقط: قبل format كان الإجمالي632 والجاهزية147، ونجحت29/29 بلا skips خلال18.96s. فشل Prettier في open.ts وrace.spec.tsx؛ نسقهما المدير آليًا وراجع ثبات السلوك. بعدها نجح كلا tsc وlint/scoped format/module-map/diff؛ lint بلا أخطاء مع14 تحذيرًا قديمًا، وdocs بلا أخطاء مع29 تحذيرًا قديمًا. ثم نجحت29/29 في خمسة ملفات بلا skips خلال19.60s، BEFORE156ms وAFTER158ms. العدّ المجمد640=375admin+265worker، والجاهزية155. تبقى نتائج RED الأولى وتصحيح mock isolation وخطأ hook lint وفشل format في التاريخ، ولا ينسب أي تشغيل للعامل.

وجدت مراجعة Astra الفعلية P2 في refresh بعد removal. لم يقبلها المدير عميانيًا: قرأ journey كاملة397 سطرًا والمصدر المتأثر، ثم شغّل حالات الرفض الأربع ar/en403/404 بلا تعديل عبر runner خارجية fail-closed مراجعة. فشلت الأربع عند281: الكاش المتوقعة[] احتوت query أُعيد إنشاؤها pending/error؛ عشر حالات أخرى filtered وليست ناجحة، exit1 خلال6.34s. مجموعة29 السابقة لم تشمل هذا الملف. المسار السببي: error ثم eviction القائمة في hook ثم revision من watcher ثم useQuery مركبة تعيد البناء والجلب. حتى success/error callbacks السابقة للإزالة قد تعيدها. دورة الطلبات المتكررة محتملة من المصدر لكن لم تُقَس كميًا. الحالة BLOCKED ولا قبول شامل.

التفويض المصحح فقط open.ts وrace.spec.tsx وثلاث وثائق المهمة: هدف5–25 إضافة وحذف إضافية، STOP60 فوق640، وإجمالي STOP700 مع hard800 ثابت. الاقتراح قبل التصحيح: داخل callback المؤجلة، بعد فحص العمر والربط الحالي، لا refresh إن كانت query الحدث حاليًا error ولا query مثبتة. لا تكرار لسياسة403/404 أو تخزين بيانات محظورة أو سلطة جديدة أو timer/fetch أو تعديل hook. تبقى witness clearing ومصالحة المحاولة قبل revision، وتظل query بديلة مثبتة والتعافي في نفس query مؤهلين.

يقوى اختبار الرفض الأول نفسه بمعاملَي403/404 وتنظيف POST لكل حالة، وتفريغ bounded10-turn القائمة حتى السكون، مع حفظ تأكيدات late response/no navigation/alert وإضافة ثبات عدد GET وفراغ الكاش. journey ذات14 حالة غير قابلة للتعديل وتغطي اللغة، والزوج والسلبيات القائمة تغطي التعافي. يقرأ المدير كل سطر قبل refusal/broader/static وإعادة مراجعة مستقلة. كل فحوص التصحيح NOT RUN؛ نفس الجلسة تملك المحاولة. لا push أو merge/deploy أو إثبات browser جديد، وبقية أسباب focus/network/closed-blank غير محسومة.

التصحيح المصدري مكتوب الآن في الملفين المأذونين فقط: callback ترفض الربط القديم أولًا، ثم تتوقف إذا كانت `event.query.state.status === 'error' && !installed(client, key)` وقت التنفيذ، وإلا تطلب refresh. يعالج ذلك إشعار success/error سبق eviction، لا removal وحدها. لا علم denial مخزن ولا payload خاصة ولا قاعدة403/404 جديدة؛ وجود B مثبتة أو تعافي نفس query لا يُحجب بهذا الشرط. مسح witness والمصالحة المتزامنة وتفويض الفتح لم تتغير.

اختبار الرفض الأول صار403/404 مع POST reset لكل variant، وتسجيل عدد GET قبل الرفض وتفريغ helper القائمة ذات10 دورات حتى السكون. كل التأكيدات القديمة محفوظة، وأضيف عدد GET=السابق+1 وفراغ الكاش وعدم navigation بعد التفريغ. اللغة تبقى gate في journey غير المعدلة، والتعافي يبقى في الاختبارات القائمة، لا نجاح مفترض ولا مصفوفة مكررة.

العدّ اليدوي للتصحيح12 إضافة و7 حذف=19 فوق المصدر المجمد؛ ضمن هدف5–25 وحد60. التقدير المحافظ للإجمالي<=659 مقابل640، ويؤكد المدير عدّ Git وformat الحقيقيين. لا تعديل hook/section أو الزوج أو fixture/config/worker، ولا تغيير authorizer أو timer/fetch. كل فحوص التصحيح NOT RUN بواسطة العامل؛ الحالة P2 BLOCKED حتى قراءة المدير للـdiff وتشغيل refusal ثم journey/broader المتوقع44 اختبارًا والفحوص وإعادة المراجعة. نفس الجلسة تحتفظ بالملكية؛ لا قبول نهائي أو CI أخضر أو إصلاح browser شامل.
