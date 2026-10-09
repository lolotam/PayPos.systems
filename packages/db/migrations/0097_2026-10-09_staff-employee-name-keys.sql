ALTER TABLE "employees" ADD COLUMN "name_en_key" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "name_ar_key" text;
--> statement-breakpoint
GRANT UPDATE (name_en_key, name_ar_key) ON employees TO pospay_app;
--> statement-breakpoint
-- يحاكي employeeNameMatchKey للصفوف الموجودة مرة واحدة فقط، ولا يستخدم وقت التشغيل.
-- مجموعة المسافات صريحة لأن تعريف PostgreSQL لـ \s يختلف عن JavaScript.
UPDATE employees SET
  name_en_key = btrim(regexp_replace(lower(translate(regexp_replace(normalize(name_en, NFKC), U&'[\064B-\0652\0670\0640]', '', 'g'), U&'\0623\0625\0622\0671\0629\0649', U&'\0627\0627\0627\0627\0647\064A')), U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')),
  name_ar_key = CASE WHEN name_ar IS NULL THEN NULL ELSE btrim(regexp_replace(lower(translate(regexp_replace(normalize(name_ar, NFKC), U&'[\064B-\0652\0670\0640]', '', 'g'), U&'\0623\0625\0622\0671\0629\0649', U&'\0627\0627\0627\0627\0647\064A')), U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')) END;
