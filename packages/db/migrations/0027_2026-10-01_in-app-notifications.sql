CREATE TABLE "in_app_notifications" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"business_id" uuid,
	"branch_id" uuid,
	"source_event_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"template_revision" integer NOT NULL,
	"locale" text NOT NULL,
	"safe_parameters" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "in_app_notifications_identity" UNIQUE("company_id","source_event_id","recipient_user_id","template_key"),
	CONSTRAINT "in_app_notifications_scope" CHECK ("in_app_notifications"."branch_id" IS NULL OR "in_app_notifications"."business_id" IS NOT NULL),
	CONSTRAINT "in_app_notifications_locale" CHECK ("in_app_notifications"."locale" IN ('ar','en')),
	CONSTRAINT "in_app_notifications_revision" CHECK ("in_app_notifications"."template_revision" > 0),
	CONSTRAINT "in_app_notifications_parameters" CHECK (jsonb_typeof("in_app_notifications"."safe_parameters") = 'array')
);
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "in_app_notifications_business_idx" ON "in_app_notifications" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "in_app_notifications_branch_idx" ON "in_app_notifications" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "in_app_notifications_user_idx" ON "in_app_notifications" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "in_app_notifications_list_idx" ON "in_app_notifications" USING btree ("company_id","recipient_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "in_app_notifications_unread_idx" ON "in_app_notifications" USING btree ("company_id","recipient_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "in_app_notifications"."read_at" IS NULL;