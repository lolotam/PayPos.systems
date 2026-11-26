-- 46-3: فهرس سجل استردادات الباقة + جدول دفتر جرس استرداد الباقات (spec 058، شريحة 46-3).
-- الفهرس على package_refunds يتبني CONCURRENTLY قبل المعاملة عشان ما يقفلش جدول الاستردادات في الإنتاج.
CREATE INDEX CONCURRENTLY "package_refunds_history_idx" ON "package_refunds" USING btree ("company_id","business_id","entitlement_id","refunded_at");
--> statement-breakpoint
-- المهلة القصيرة تجعل قفل الهجرة يفشل سريعاً ويُعاد بدل أن يعلّق على معاملة حيّة.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- دفتر الجرس: صف واحد لكل استرداد باقة، يتثبت مرة واحدة لا يتكرر ولا يتعدّل. صفر مستلمين قرار دائم كمان.
CREATE TABLE "package_refund_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"recipient_count" integer NOT NULL,
	CONSTRAINT "package_refund_notices_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "package_refund_notices_refund_key" UNIQUE("company_id","refund_id"),
	CONSTRAINT "package_refund_notices_recipient_count" CHECK ("package_refund_notices"."recipient_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "package_refund_notices" ADD CONSTRAINT "package_refund_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refund_notices" ADD CONSTRAINT "package_refund_notices_refund_fk" FOREIGN KEY ("company_id","business_id","refund_id") REFERENCES "public"."package_refunds"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- كل مفتاح أجنبي ليه فهرس بعموده بالترتيب بالظبط، عشان فحص الفهارس يعدّي (CLAUDE.md §5).
CREATE INDEX "package_refund_notices_refund_fk_idx" ON "package_refund_notices" USING btree ("company_id","business_id","refund_id");
--> statement-breakpoint
-- العزل: شركة واحدة بس تشوف صفوفها، والكتابة مش بتعدّي حدود الشركة (CLAUDE.md §5).
ALTER TABLE package_refund_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_refund_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_refund_notices_select ON package_refund_notices FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_refund_notices_insert ON package_refund_notices FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON package_refund_notices FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON package_refund_notices TO pospay_app;
