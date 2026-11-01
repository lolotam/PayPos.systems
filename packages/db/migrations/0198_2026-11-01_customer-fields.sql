-- 34-pre-1: حقول الملف الشخصي للعميل (تاريخ الميلاد، النوع، البريد) وملاحظات لكل نشاط (D-8، D-9، D-10).
-- توسيع بس: كل الأعمدة nullable، ومفيش backfill ولا trigger على الـ INSERT ولا قيمة افتراضية للنوع،
-- فشاشة الاستقبال الحالية وشنطة الكود القديمة بتفضل شغالة (S-1، S-8).
ALTER TABLE "customers" ADD COLUMN "birth_month" smallint;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birth_day" smallint;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birth_year" smallint;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "gender" text;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email" text;
--> statement-breakpoint
-- كل CHECK مكتوب صراحةً إن الـ NULL يعدّي: الـ CHECK اللي بيطلع NULL يعدّي صامت، فالمساواة صريحة.
ALTER TABLE "customers" ADD CONSTRAINT "customers_birth_month" CHECK ("birth_month" IS NULL OR "birth_month" BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_birth_day" CHECK ("birth_day" IS NULL OR "birth_day" BETWEEN 1 AND 31);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_birth_year" CHECK ("birth_year" IS NULL OR "birth_year" BETWEEN 1 AND 9999);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_gender" CHECK ("gender" IS NULL OR "gender" IN ('female', 'male'));
--> statement-breakpoint
-- الطول بالـ code points زي العقد (char_length)، والقصّ لازم يكون خلص (btrim)، وقاعدة CI-Q11 هي
-- @ ونقطة. حروف التحكم ممنوعة؛ الـ NUL مستحيل يتخزن في text أصلاً، فالمدى يبدأ من 1.
ALTER TABLE "customers" ADD CONSTRAINT "customers_email" CHECK (
  "email" IS NULL
  OR ("email" !~ '[\u0001-\u001F\u007F-\u009F]'
      AND char_length("email") BETWEEN 3 AND 254
      AND "email" = btrim("email")
      AND position('@' in "email") > 0
      AND position('.' in "email") > 0));
--> statement-breakpoint
-- شكل تاريخ الميلاد: يوم وشهر مع بعض، والسنة اختيارية بس مش من غير يوم وشهر؛ وفي يوم لا يوجد في الشهر.
ALTER TABLE "customers" ADD CONSTRAINT "customers_birthday_shape" CHECK (
  ("birth_month" IS NULL AND "birth_day" IS NULL AND "birth_year" IS NULL)
  OR ("birth_month" IS NOT NULL AND "birth_day" IS NOT NULL AND (
    ("birth_month" <> 2 OR "birth_day" <= 29)
    AND ("birth_month" NOT IN (4, 6, 9, 11) OR "birth_day" <= 30)
    AND (NOT ("birth_month" = 2 AND "birth_day" = 29 AND "birth_year" IS NOT NULL)
         OR ("birth_year" % 4 = 0 AND ("birth_year" % 100 <> 0 OR "birth_year" % 400 = 0)))
  )));
--> statement-breakpoint
-- الكتابة المسموحة لسطر واحد بس: حقول الملف الشخصي بس، مش الهوية ولا وقت الإنشاء (D-9، CI-T8).
-- updated_at اتمنح قبل كده في 0188، والـ customers_update policy بيغطي كل الجوانب.
GRANT UPDATE (birth_month, birth_day, birth_year, gender, email) ON customers TO pospay_app;
--> statement-breakpoint
-- الحراسة في القاعدة مش في الكود: القيمة اللي اتكتبت ما بتتغيرش تاني، ولا تتفضّى (D-9).
-- نفس شكل 0188 بالظبط، واللي فاتح مابيتلمسش: 0188 نفسها بتفضل زي ما هي.
CREATE FUNCTION customers_profile_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.birth_month IS NOT NULL AND NEW.birth_month IS DISTINCT FROM OLD.birth_month THEN
    RAISE EXCEPTION 'the customer profile is set once' USING ERRCODE = '23514', CONSTRAINT = 'customers_profile_set_once';
  END IF;
  IF OLD.birth_day IS NOT NULL AND NEW.birth_day IS DISTINCT FROM OLD.birth_day THEN
    RAISE EXCEPTION 'the customer profile is set once' USING ERRCODE = '23514', CONSTRAINT = 'customers_profile_set_once';
  END IF;
  IF OLD.birth_year IS NOT NULL AND NEW.birth_year IS DISTINCT FROM OLD.birth_year THEN
    RAISE EXCEPTION 'the customer profile is set once' USING ERRCODE = '23514', CONSTRAINT = 'customers_profile_set_once';
  END IF;
  IF OLD.gender IS NOT NULL AND NEW.gender IS DISTINCT FROM OLD.gender THEN
    RAISE EXCEPTION 'the customer profile is set once' USING ERRCODE = '23514', CONSTRAINT = 'customers_profile_set_once';
  END IF;
  IF OLD.email IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'the customer profile is set once' USING ERRCODE = '23514', CONSTRAINT = 'customers_profile_set_once';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION customers_profile_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION customers_profile_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER customers_profile_guard BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION customers_profile_guard();
--> statement-breakpoint
-- ملاحظات العميل: وحدة لكل نشاط داخل الشركة (D-8). السطر ثابت، فمفيش updated_at ولا DELETE ولا تعديل.
CREATE TABLE "customer_notes" (
  "company_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "business_id" uuid NOT NULL,
  "note" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "customer_notes_pkey" PRIMARY KEY("company_id","customer_id","business_id"),
  CONSTRAINT "customer_notes_note" CHECK (char_length("note") BETWEEN 1 AND 500 AND "note" = btrim("note"))
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- الـ primary key بيغطي قراءة الملف الشخصي (بادئة company_id, customer_id)؛ الفهرس بيغطي الـ FK بتاع النشاط.
CREATE INDEX "customer_notes_business_idx" ON "customer_notes" USING btree ("company_id","business_id");
--> statement-breakpoint
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- عزل بالشركة: كل أنشطة الشركة تقرأ كل الملاحظات (CI-Q17)، ومفيش قراءة من شركة تانية.
CREATE POLICY customer_notes_select ON customer_notes FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY customer_notes_insert ON customer_notes FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON customer_notes TO pospay_app;
