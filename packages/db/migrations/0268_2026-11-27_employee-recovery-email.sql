-- العمود جديد وكله NULL، فالفهرس الجزئي الفريد فاضي وبيتبني في نفس المعاملة من غير CONCURRENTLY (المنفّذ يطلب الفهارس المتزامنة قبل أي جملة معاملية).
ALTER TABLE "employees" ADD COLUMN "recovery_email" text;--> statement-breakpoint
GRANT UPDATE ("recovery_email") ON "employees" TO pospay_app;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_company_recovery_email_uidx" ON "employees" USING btree ("company_id",lower("recovery_email")) WHERE "employees"."recovery_email" IS NOT NULL AND "employees"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_recovery_email_format" CHECK ("employees"."recovery_email" IS NULL OR (char_length("employees"."recovery_email") <= 254
        AND "employees"."recovery_email" = lower(btrim("employees"."recovery_email"))
        AND "employees"."recovery_email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'));