CREATE TABLE "staff_pin_change_proofs" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"proof_hash" text NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pin_revision" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_pin_change_proofs_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "staff_pin_change_proofs_company_id_proof_hash" UNIQUE("company_id","proof_hash")
);
--> statement-breakpoint
ALTER TABLE "staff_pin_change_proofs" ADD CONSTRAINT "staff_pin_change_proofs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pin_change_proofs" ADD CONSTRAINT "staff_pin_change_proofs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pin_change_proofs" ADD CONSTRAINT "staff_pin_change_proofs_device_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_pin_change_proofs_company_id_user_id_idx" ON "staff_pin_change_proofs" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "staff_pin_change_proofs_company_id_device_id_idx" ON "staff_pin_change_proofs" USING btree ("company_id","device_id");--> statement-breakpoint
CREATE INDEX "staff_pin_change_proofs_user_id_idx" ON "staff_pin_change_proofs" USING btree ("user_id");
--> statement-breakpoint
-- spec 076 F2 (دليل تغيير الرقم السري المؤقت): RLS إجباري على الجدول بمنح pospay_app وحده،
-- وبذرة سياسات الشركة هي app_company_id() زي باقي جداول الشركة. الدليل ما يتشنهش ولا يتحدّث
-- غير pospay_app، ولا role تاني ليه صلاحية عليه.
ALTER TABLE staff_pin_change_proofs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_pin_change_proofs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_pin_change_proofs_select ON staff_pin_change_proofs FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY staff_pin_change_proofs_insert ON staff_pin_change_proofs FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY staff_pin_change_proofs_update ON staff_pin_change_proofs FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON staff_pin_change_proofs FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON staff_pin_change_proofs TO pospay_app;