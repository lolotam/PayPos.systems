CREATE TABLE "platform_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "platform_audit_log_actor_length" CHECK (char_length("platform_audit_log"."actor") BETWEEN 1 AND 255),
	CONSTRAINT "platform_audit_log_action_format" CHECK ("platform_audit_log"."action" ~ '^[a-z]+\.[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "platform_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "platform_grants_permission_scope" CHECK ("platform_grants"."permission" LIKE '%:platform'),
	CONSTRAINT "platform_grants_granted_by_length" CHECK (char_length("platform_grants"."granted_by") BETWEEN 1 AND 255),
	CONSTRAINT "platform_grants_revocation" CHECK (("platform_grants"."revoked_at" IS NULL) = ("platform_grants"."revoked_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_grants" ADD CONSTRAINT "platform_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_grants" ADD CONSTRAINT "platform_grants_permission_permissions_code_fk" FOREIGN KEY ("permission") REFERENCES "public"."permissions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_log_target_user_id_idx" ON "platform_audit_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "platform_audit_log_at_idx" ON "platform_audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_grants_active_key" ON "platform_grants" USING btree ("user_id","permission") WHERE "platform_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "platform_grants_permission_idx" ON "platform_grants" USING btree ("permission");