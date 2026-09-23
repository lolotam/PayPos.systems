CREATE TABLE "devices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"label" text NOT NULL,
	"device_fingerprint" text,
	"app_version" text,
	"status" text NOT NULL,
	"claim_hash" text,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "devices_status" CHECK ("devices"."status" IN ('PENDING', 'ACTIVE', 'REVOKED')),
	CONSTRAINT "devices_label_length" CHECK (char_length("devices"."label") BETWEEN 1 AND 100),
	CONSTRAINT "devices_fingerprint_length" CHECK ("devices"."device_fingerprint" IS NULL OR char_length("devices"."device_fingerprint") BETWEEN 1 AND 255),
	CONSTRAINT "devices_app_version_length" CHECK ("devices"."app_version" IS NULL OR char_length("devices"."app_version") BETWEEN 1 AND 50),
	CONSTRAINT "devices_state" CHECK (("devices"."status" = 'PENDING' AND "devices"."token_hash" IS NULL AND "devices"."approved_at" IS NULL)
        OR ("devices"."status" = 'ACTIVE' AND "devices"."approved_at" IS NOT NULL AND "devices"."approved_by" IS NOT NULL)
        OR ("devices"."status" = 'REVOKED' AND "devices"."token_hash" IS NULL AND "devices"."claim_hash" IS NULL AND "devices"."revoked_at" IS NOT NULL)),
	CONSTRAINT "devices_token_expiry" CHECK (("devices"."token_hash" IS NULL) = ("devices"."token_expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_company_id_branch_id_idx" ON "devices" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "devices_approved_by_idx" ON "devices" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "devices_revoked_by_idx" ON "devices" USING btree ("revoked_by");