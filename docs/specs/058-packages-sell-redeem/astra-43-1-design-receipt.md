# Astra design advice receipt — 43-1 / PP-121

Provider: `codex`; model: `gpt-6-astra`; effort: `high`.
Started: 2026-11-04T21:17:05.224Z. Completed: 2026-11-04T21:26:13.926Z.
Elapsed runtime: 548.702 seconds (9 minutes 8.702 seconds).
Status: completed. Read-only advice, not a test or implementation approval receipt.
Thread: <t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3A837bda50-0114-4922-8d73-ac3cf991dfc3%3Adelegate-task%3Ace220bc5-07f9-45a5-af9e-c50d7198740c>

The response below is preserved verbatim. Parent resolution is in `plan-43-1.md`.

---

**التوصية: اعتماد الاتجاه، بعد استكمال التصميم بالتغييرات التالية.** الخطة الأولية لا تزال غير جاهزة للتنفيذ؛ أهم نقصين هما تغطية تغييرات طرفَي العلاقات بعد تفريغ القيود المؤجلة، وتحديد توافق draft الجديد مع الكاتب المدفوع الحالي.

هذه مشورة قراءة فقط؛ لم أعدّل ملفات أو أشغّل اختبارات. قراءة الأب الكاملة ومراجعته للخطة تظلان بوابة مستقلة.

1. **P1 — حدّد فحص الحالة النهائية لكل طرف، بما فيه الطرف الذي فقد الارتباط.**  
   عند تنفيذ trigger مؤجل، استخدم `OLD/NEW` لتحديد الهويات المتأثرة، ثم اقرأ الصفوف الحالية. لا تحكم من لقطة `NEW` القديمة.

   - من redemption: تحقق من line وslot النهائيين عند الإدخال والعكس.
   - من line: تحقق من الارتباط المتبادل، الخدمة، المال والحالة.
   - من slot: تحقق من المؤشر الحالي **ومن redemption الذي أُزيل مؤشّره**، أو افحص عدم وجود redemption حيّ لهذا slot عندما يصبح `FREE`.
   - يشمل ذلك تغيير `current_redemption_id` مع بقاء الحالة `USED`.

   مثال الثغرة المطلوب منعه: redemption صحيح → `SET CONSTRAINTS ALL IMMEDIATE` → إعادة التأجيل → تحرير slot دون عكس redemption. فحص «`FREE` ومؤشره `NULL`» وحده يمرّر الحالة الخاطئة.  
   المرجع: [متطلبات الاتساق](C:/Users/waleed_Mohamed/.t3/worktrees/main/feat-p1-058-43-1b-redemption-guards-sol/docs/specs/058-packages-sell-redeem/spec.md:640).

2. **P1 — اجعل العكس انتقالًا واحدًا، مع إثبات الإلغاء وإتاحة إعادة الاستخدام.**  
   امنع إدخال redemption معكوس أصلًا. بعد الإدخال، التغيير الوحيد هو انتقال العمودين معًا من `NULL` إلى قيمة؛ امنع تغيير الهوية أو line أو slot أو الكاتب أو الوقت الأصلي، وإعادة العكس أو مسحه.

   الفحص المؤجل يثبت أن `reversal_cancellation_id` يخص **السطر نفسه**، وأن السطر ملغى ومتسق مع حراس `054`. والعكس مطلوب أيضًا: إلغاء line مرتبط لا ينجح دون عكس redemption.

   عند فحص redemption معكوس، slot يمكن أن يكون `FREE` أو `USED` بواسطة redemption آخر حيّ مطابق له. اشتراط بقائه `FREE` يكسر إعادة الاستخدام، خصوصًا redeem → reverse → reuse داخل معاملة واحدة. لا حاجة لختم transaction جديد للعكس؛ الانتقالات المقيدة والاقتران النهائي يثبتان الذرية.

3. **P1 — ثبّت marker والمال فورًا، مع إبقاء حراس `054/055`.**  
   عدم منح `UPDATE(redemption_id)` ضروري، لكنه لا يغني عن الحارس المطلوب لثبات العلامة. امنع `NULL→id` و`id→NULL` و`id→other` بعد الإدخال، وامنع تغيير مال السطر المرتبط.

   الفحص النهائي يثبت:

   - تطابق الشركة والنشاط والاستحقاق والمكوّن والـ slot.
   - `line.session_id → service_sessions.customer_id = entitlement.customer_id`.
   - `line.service_id = component.service_id`.
   - `list_price = price = net = unit_value`، و`discount = effective_discount_bps = 0`.

   لا تفرض تطابق فرع الزيارة مع فرع البيع؛ الاستخدام في فرع آخر داخل النشاط مقرر. حافظ على تجميد السطر الملغى، وعلى أن الإلغاء يغيّر `status/revision` فقط. لا تدخل رفض حالات الاستخدام الخاص بـ `43-1b` هنا.  
   المرجع: [حارس الإلغاء الحالي](C:/Users/waleed_Mohamed/.t3/worktrees/main/feat-p1-058-43-1b-redemption-guards-sol/packages/db/migrations/0146_2026-10-17_service-line-cancellations.sql:69).

4. **P1 — افصل تعريف draft المستقبلي عن تفعيل مساراته.**  
   `sessionLineInput` مستخدم مباشرةً في create/append، والكاتب يستدعي `sessionDrafts` الذي يتطلب `price` و`discount`. توسيعه مباشرةً يسبب تعارض أنواع، أو وصول package draft إلى كاتب غير جاهز.

   أوصي في `43-1` بتصدير schema مستقل للـ package draft وunion صارم، مع إبقاء عقود المسارات الحالية مدفوعة حتى `43-2`. احتفظ بـ `discount_proposal_id` في paid draft، وارفضه مع package، مثل `price/discount` والحقول الزائدة داخل `package`.

   وسّع الأحداث الثلاثة الآن إلى `package: null | { entitlement_id, component_id, ordinal }` دون defaults تغيّر الأجسام القديمة. حافظ على قواعد الحالة والنسخة وغياب `change` في أحداث التسجيل؛ وارفض `PRICE_DISCOUNT_EDIT` لسطر package. لا تجعل OpenAPI يعلن أن المسارات تقبل ما لم ينفذه الكاتب بعد.  
   المراجع: [العقد الحالي](C:/Users/waleed_Mohamed/.t3/worktrees/main/feat-p1-058-43-1b-redemption-guards-sol/packages/contracts/src/orders/service-session.ts:23)، [تحويل المسودات](C:/Users/waleed_Mohamed/.t3/worktrees/main/feat-p1-058-43-1b-redemption-guards-sol/apps/api/src/modules/orders/domain/session-drafts.ts:20).

5. **P1 — استبدال حارس `42-2` يكون محدودًا بالانتقالات المصرح بها.**  
   استبدل `package_session_slots_update_guard()` بنفس الاسم والتوقيع في migration جديدة. افتح `FREE↔USED` فقط مع الإثباتات المؤجلة؛ احتفظ بثبات بقية الأعمدة ورفض `REFUNDED/IMPORTED_USED`.

   أبقِ حراس إدخال slots/components وختم `(created_system_id, created_txid)` وحفظ القيم دون إضعاف. لا تفتح `expires_on/refunded_amount/revision`، ولا تعدّل migration `0200` التاريخية.  
   المرجع: [الحراس الموجودة](C:/Users/waleed_Mohamed/.t3/worktrees/main/feat-p1-058-43-1b-redemption-guards-sol/packages/db/migrations/0200_2026-11-02_package-storage.sql:271).

6. **P2 — أضف جرد الصلاحيات والدوال والجداول، وحدّد تمثيل الـ FKs الدائرية.**  
   الخطة تذكر بعض الجرد فقط. يلزم أيضًا تحديث `test/function-inventory.ts` و`test/tenant-table-inventory.ts`. لا تُدخل دورة imports بين `orders.ts` و`orders-packages.ts` بسبب الـ FKs المتبادلة؛ اتبع سابقة الروابط المؤجلة المكتوبة في SQL، ووثّقها في schema واختبارات catalog.

**الصلاحيات والفهارس المطلوبة بدقة:**

- `package_redemptions`: `SELECT, INSERT` و`UPDATE(reversed_at, reversal_cancellation_id)` فقط؛ بلا table-wide UPDATE أو DELETE/TRUNCATE.
- `service_lines`: لا منحة UPDATE جديدة.
- slots: تظل `UPDATE(state, current_redemption_id)`.
- components: تظل `UPDATE(lock_touch)` للقفل، والحارس يرفض تحديثه.
- RLS: `ENABLE` و`FORCE`؛ SELECT/UPDATE باستخدام `app_company_id()`، وINSERT/UPDATE بـ `WITH CHECK`. الدوال `SECURITY INVOKER`، و`search_path` مثبت، وEXECUTE محدود بلا PUBLIC.

| موضع FK | الأعمدة القائدة المطلوبة للفهرس | التأجيل |
|---|---|---|
| redemption → component | `(company_id,business_id,entitlement_id,component_id)` | عادي |
| redemption → slot | `(company_id,business_id,slot_id)` | `DEFERRABLE INITIALLY DEFERRED` |
| redemption → line | `(company_id,business_id,line_id)` | نفسه |
| redemption → user | `(recorded_by)` | عادي |
| redemption → membership | `(company_id,recorded_by,recorded_by_membership_id)` | عادي |
| redemption → cancellation | `(company_id,reversal_cancellation_id)`، بشرط `IS NOT NULL` | مؤجل |
| line → redemption | `(company_id,business_id,redemption_id)`، بشرط `IS NOT NULL` | مؤجل |
| slot → redemption | `(company_id,business_id,current_redemption_id)`، بشرط `IS NOT NULL` | مؤجل |

مع PK `(company_id,id)`، والمفتاح المرشح `(company_id,business_id,id)`، وUNIQUE `(company_id,line_id)`، وpartial UNIQUE `(company_id,slot_id) WHERE reversed_at IS NULL`. الأخير لا يعوّض فهرس slot FK. يجب إضافة `service_lines` لتغطية فحص الفهارس، وليس جدول redemption وحده.

**مصفوفة الثوابت والاختبارات المطلوبة:**

| الثابت | الإثبات المطلوب |
|---|---|
| ارتباط line/redemption متبادل | نجاح الزوج الصحيح؛ رفض الطرف المفقود، crossed pairs، وربط سطرين بنفس redemption |
| حدود النطاق | رفض شركة أخرى ونشاط آخر داخل الشركة، مع هويات متكررة بين الشركات |
| العميلة عبر الزيارة | رفض عميلة أخرى داخل النشاط؛ قبول فرع خدمة مختلف للعميلة نفسها |
| المكوّن والخدمة | رفض component من entitlement آخر، أو service مختلفة |
| المال | اختبار كل عمود مخالف منفردًا؛ قبول `0.000` وقيم ذات كسر فلس مخزن صحيح؛ عدم إضعاف رفض NaN والسالب |
| marker ثابت | رفض إضافته/مسحه/استبداله بعد الإدخال؛ استمرار paid lines القديمة بـ `NULL` |
| مال redemption ثابت | رفض التعديل المباشر كـ app، وإثبات الحارس بدور يسمح بالعمود |
| redemption حيّ | لا يلتزم دون slot `USED` يشير إليه بالضبط |
| slot محرّر | لا يلتزم `FREE` مع redemption حيّ، حتى بعد تفريغ القيود السابق |
| تغيير مؤشر slot | رفض reversed redemption، أو redemption لslot آخر، أو ترك المالك السابق حيًا |
| uniqueness | رفض redemption ثانٍ لنفس line، واثنين حيّين لنفس slot |
| بداية redemption | رفض الإدخال مع أحد حقلي العكس أو كليهما |
| عكس مرة واحدة | رفض نصف الزوج، العكس الثاني، تغيير cancellation أو timestamp، والمسح |
| الإلغاء يثبت العكس | رفض cancellation مفقود، لسطر آخر، أو غير متسق مع الحالة/النسخة/المال |
| العكس يثبت الإلغاء | رفض line ملغى دون reversal أو مع slot ما زال محجوزًا له |
| إعادة الاستخدام | reverse ثم reuse؛ وكذلك redeem→reverse→reuse في معاملة واحدة، مع حفظ التاريخ القديم |
| ترتيب الكتابة | نجاح الترتيبات التي تسمح بها الـ FKs المؤجلة بعد اكتمال الصفوف؛ فشل الفحص المبكر للحالة الناقصة |
| تبديل التأجيل | نجاح الحالة المكتملة عند IMMEDIATE؛ ثم DEFERRED وتغيير كل طرف منفردًا يجب أن يعيد الفحص |
| rollback/savepoint | لا يبقى تحرير slot أو reversal أو cancellation جزئي؛ rollback يعيد الحالة السابقة |
| التنافس | معاملتان تتنافسان على slot: واحدة فقط تلتزم؛ reversal متزامن لا يحرّر مرتين |
| حراس `42-2` | seals، منع reseal، منع إضافة component/slot بعد اكتمال التركيب، بما فيه IMMEDIATE→DEFERRED |
| الانتقالات المغلقة | رفض refund/expiry/revision، تغيير ordinal/value، وإحياء terminal states |
| حراس `054/055/35d` | استمرار paid edit/cancel/performer histories، وتجميد cancelled line، وعدم تغيير المال أثناء الإلغاء |
| RLS | SELECT=0 للشركة الأخرى، INSERT مرفوض، UPDATE المسموح لا يمسها؛ غياب السياق وإعادة استخدام الاتصال |
| ACL والدوال | مطابقة المنح الفعلية والموروثة، رفض الأدوار الأخرى وPUBLIC، وFORCE/INVOKER |
| FK catalog | الأعمدة والآباء وخصائص التأجيل؛ فهارس B-tree جاهزة وصحيحة، بلا احتساب INCLUDE أو live-only index |
| draft contracts | paid القديم يمر؛ package الصحيح يمر في union المستقل؛ mixed/extra/approval fields تُرفض |
| event contracts | null القديم وpackage الجديد في الأحداث الثلاثة؛ حالات/نسخ صحيحة، ومنع package price edit |
| توافق الإصدار السابق | الكاتب المدفوع وإعادة الردود القديمة يعملان دون إضافة حقول أو تغيير fingerprint |

اختبارات انتهاء الصلاحية، اختيار أقل ordinal، صلاحيات المستخدم وذرية الطلب المختلط تبقى في الكاتب `43-2`. **إلغاء redemption بعد انتهاء الباقة لا يُرفض بحارس التخزين.**

**النطاق الواقعي:** نحو **18–25 ملفًا، و1,700–2,500 سطر authored changed**، بخلاف generated artifacts:

| المجموعة | تقدير السطور |
|---|---:|
| SQL جديد: جدول، FKs، فهارس، RLS وحراس | 450–650 |
| schema وتعليقات الروابط | 140–220 |
| اختبارات DB وfixtures، مع تعديل توقعات قديمة محدود | 850–1,200 |
| contracts واختباراتها | 160–260 |
| inventories والخطة والتوثيق | 100–170 |

تقدير `1,000–1,600` متفائل للمصفوفة المطلوبة. تجنّب توسيع ملفات الاختبار الحالية الكبيرة؛ استخدم ملفات مستقلة للروابط والعكس والعزل. لا يدخل في النطاق writer أو UI أو صلاحيات جديدة أو تعديلات `43-1b`.

**لا أرى سؤال أعمال جديدًا يحتاج وليد.** المطلوب من الأب حسم طريقة نشر union وتوثيق تغطية triggers قبل التنفيذ. تبقى migration lane غير ممنوحة، والترتيب `#793` ثم `#785`؛ لا ترقيم أو `db:generate` أو push، ولا حجز `0204`. الخطوة الموصى بها: تحديث الخطة بهذه التفاصيل ومراجعتها، ثم تنفيذ `43-1` وحدها؛ `43-1b` بعد دخول storage، وفق `PP-121`.

