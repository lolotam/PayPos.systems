-- اشتراكات الدفع الشخصية (ADR-0052 §3): صف لكل تثبيت متصفح في شركة؛ بلا DELETE، والتعديل على أسرار الاشتراك وسبب سحبه فقط.
CREATE TABLE "push_subscriptions" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_hash" "bytea" NOT NULL,
	"endpoint" text,
	"p256dh" text,
	"auth" text,
	"endpoint_hash" "bytea" NOT NULL,
	"delivery_token" uuid,
	"generation" integer DEFAULT 1 NOT NULL,
	"locale" text NOT NULL,
	"vapid_key_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "push_subscriptions_install_key" UNIQUE("company_id","user_id","installation_hash"),
	CONSTRAINT "push_subscriptions_locale" CHECK ("push_subscriptions"."locale" IN ('ar','en')),
	CONSTRAINT "push_subscriptions_revoked_reason" CHECK ("push_subscriptions"."revoked_reason" IS NULL OR "push_subscriptions"."revoked_reason" IN ('UNSUBSCRIBED','GONE','REPLACED','OWNER_CHANGED','KEY_ROTATED','CAP_EXCEEDED')),
	CONSTRAINT "push_subscriptions_generation" CHECK ("push_subscriptions"."generation" >= 1),
	CONSTRAINT "push_subscriptions_endpoint_length" CHECK ("push_subscriptions"."endpoint" IS NULL OR char_length("push_subscriptions"."endpoint") <= 2048),
	CONSTRAINT "push_subscriptions_vapid_key_id" CHECK ("push_subscriptions"."vapid_key_id" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "push_subscriptions_state" CHECK (("push_subscriptions"."revoked_at" IS NULL AND "push_subscriptions"."revoked_reason" IS NULL AND "push_subscriptions"."endpoint" IS NOT NULL AND "push_subscriptions"."p256dh" IS NOT NULL AND "push_subscriptions"."auth" IS NOT NULL AND "push_subscriptions"."delivery_token" IS NOT NULL) OR ("push_subscriptions"."revoked_at" IS NOT NULL AND "push_subscriptions"."revoked_reason" IS NOT NULL AND "push_subscriptions"."endpoint" IS NULL AND "push_subscriptions"."p256dh" IS NULL AND "push_subscriptions"."auth" IS NULL AND "push_subscriptions"."delivery_token" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" USING btree ("company_id","endpoint_hash") WHERE "push_subscriptions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "push_subscriptions_active_user_idx" ON "push_subscriptions" USING btree ("company_id","user_id") WHERE "push_subscriptions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY push_subscriptions_insert ON push_subscriptions FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY push_subscriptions_update ON push_subscriptions FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON push_subscriptions FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON push_subscriptions TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (endpoint, p256dh, auth, endpoint_hash, delivery_token, generation, locale, vapid_key_id, last_seen_at, updated_at, revoked_at, revoked_reason)
  ON push_subscriptions TO pospay_app;