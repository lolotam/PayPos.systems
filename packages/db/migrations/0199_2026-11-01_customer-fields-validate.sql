-- 34-pre-1 (تكملة): هجرة تانية لنفس التوسيع (D-8، D-9، D-10). 0198 بيبني الشكل، والملف ده
-- بيكمّل حاجتين: فهرس customer_notes بتبني CONCURRENTLY، والتحقق من قيود customers بيحصل هنا
-- في معاملة مستقلة.
--
-- [1] الفهرس: customer_notes_business_idx كان في 0198 بـ CREATE INDEX عادية، وده خلاف
-- CLAUDE.md §5 (الفهارس الجديدة بتتبني CONCURRENTLY). جملة CONCURRENTLY لازم تكون في أول الملف،
-- عشان الـ runner ينفّذها بره المعاملة (packages/db/src/concurrent-migrations.ts): بادئة الملف
-- بتنفّذ الأول بره أي معاملة، وبعدها باقي الجمل بتتم في معاملة واحدة. فالفهرس ده بيتبني من غير
-- ما يمسك الكتابة على customer_notes، والـ runner بيتأكد إن الفهرس موجود بنفس التعريف وما بيعملوش
-- تاني لو اتكرر. التعريف ما اتغيّرش: نفس الاسم ونفس الأعمدة ونفس النوع.
--
-- [2] التحقق: 0198 ضاف القيود الستة بـ NOT VALID، يعني اتحطت في الكتالوج من غير مسح للجدول،
-- وقفل ACCESS EXCLUSIVE بتاع الـ ADD CONSTRAINT اتفك لما معاملة 0198 خلصت. هنا بيبدأ فحص الصفوف
-- الموجودة على القيود الستة، وده تحت قفل SHARE UPDATE EXCLUSIVE (زي 0195): بيمنع DDL تاني
-- وتحقق تاني على نفس الجدول وقت الفحص، بس مش بيمنع INSERT ولا UPDATE ولا SELECT على customers.
-- والكتابة الجديدة ماحصلتش استثناء في أي لحظة: القيد NOT VALID بيفرض نفسه على كل INSERT وUPDATE
-- من لحظة إضافته في 0198، وكل اللي بيتأجل هو إثبات إن الصفوف القديمة بتخضع للقيد.
-- وليه ملف تاني مش نفس الملف: لو كان التحقق في نفس 0198، الـ runner بيحطه في نفس المعاملة،
-- فقفل ACCESS EXCLUSIVE بيفضل متسك لحد ما المعاملة تخلص، يعني الفحص هيتعمل تحت القفل نفسه.
-- ملفين = معاملتين = القفل بيتفك في معاملة 0198 قبل ما الفحص يبدأ هنا.
--
-- [3] القيود الستة في جملة ALTER TABLE واحدة: قفل واحد على الجدول وتحديث catalog واحد بدل ستة،
-- وكل قيد بيتحقق من بيانات الصفوف الموجودة. لو القيد ده فشل، المعاملة كلها بترجع زي ما هي.
CREATE INDEX CONCURRENTLY "customer_notes_business_idx" ON "customer_notes" USING btree ("company_id","business_id");
--> statement-breakpoint
-- الـ primary key بيغطي قراءة الملف الشخصي (بادئة company_id, customer_id)؛ الفهرس بيغطي الـ FK بتاع النشاط.
-- التحقق من القيود الستة على customers: كل واحد فيهم اتضاف في 0198 بـ NOT VALID.
ALTER TABLE "customers"
  VALIDATE CONSTRAINT "customers_birth_month",
  VALIDATE CONSTRAINT "customers_birth_day",
  VALIDATE CONSTRAINT "customers_birth_year",
  VALIDATE CONSTRAINT "customers_gender",
  VALIDATE CONSTRAINT "customers_email",
  VALIDATE CONSTRAINT "customers_birthday_shape";
