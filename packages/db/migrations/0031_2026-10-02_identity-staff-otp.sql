CREATE TABLE "auth_notification_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"challenge_id" uuid NOT NULL,
	"recipient_hash" "bytea" NOT NULL,
	"hash_key_id" text NOT NULL,
	"user_id" uuid,
	"channel" text NOT NULL,
	"template_key" text NOT NULL,
	"template_revision" integer NOT NULL,
	"locale" text NOT NULL,
	"provider_template_name" text,
	"status" text NOT NULL,
	"authorized_at" timestamp with time zone,
	"send_deadline" timestamp with time zone NOT NULL,
	"preparation_deadline" timestamp with time zone NOT NULL,
	"execution_id" uuid,
	"sending_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_code" text,
	"outcome_known" boolean,
	"provider_message_digest" "bytea",
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_notification_attempts_send_key" UNIQUE("challenge_id","channel","recipient_hash","template_key"),
	CONSTRAINT "auth_notification_attempts_template" CHECK ("auth_notification_attempts"."channel" = 'WHATSAPP' AND "auth_notification_attempts"."template_key" = 'staff_otp' AND "auth_notification_attempts"."template_revision" = 1 AND "auth_notification_attempts"."locale" IN ('ar','en')),
	CONSTRAINT "auth_notification_attempts_hash" CHECK (octet_length("auth_notification_attempts"."recipient_hash") = 32 AND ("auth_notification_attempts"."provider_message_digest" IS NULL OR octet_length("auth_notification_attempts"."provider_message_digest") = 32)),
	CONSTRAINT "auth_notification_attempts_status" CHECK ("auth_notification_attempts"."status" IN ('PREPARED','PENDING','SENDING','SENT','FAILED','EXPIRED','SUPPRESSED')),
	CONSTRAINT "auth_notification_attempts_authorization" CHECK (("auth_notification_attempts"."status" NOT IN ('PREPARED','SUPPRESSED') OR "auth_notification_attempts"."authorized_at" IS NULL) AND ("auth_notification_attempts"."status" NOT IN ('PENDING','SENDING','SENT') OR "auth_notification_attempts"."authorized_at" IS NOT NULL) AND ("auth_notification_attempts"."authorized_at" IS NULL OR "auth_notification_attempts"."authorized_at" < "auth_notification_attempts"."preparation_deadline")),
	CONSTRAINT "auth_notification_attempts_fence" CHECK (("auth_notification_attempts"."execution_id" IS NULL) = ("auth_notification_attempts"."sending_at" IS NULL) AND ("auth_notification_attempts"."status" NOT IN ('SENDING','SENT') OR "auth_notification_attempts"."execution_id" IS NOT NULL)),
	CONSTRAINT "auth_notification_attempts_terminal" CHECK (("auth_notification_attempts"."status" IN ('PREPARED','PENDING','SENDING')) = ("auth_notification_attempts"."finished_at" IS NULL)),
	CONSTRAINT "auth_notification_attempts_deadline" CHECK ("auth_notification_attempts"."preparation_deadline" = "auth_notification_attempts"."created_at" + interval '200 milliseconds' AND "auth_notification_attempts"."send_deadline" = "auth_notification_attempts"."created_at" + interval '300 seconds')
);
--> statement-breakpoint
CREATE TABLE "auth_otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_hash" "bytea" NOT NULL,
	"hash_key_id" text NOT NULL,
	"user_id" uuid,
	"device_context" jsonb NOT NULL,
	"code_mac" "bytea",
	"derivation_key_id" text,
	"verification_key_id" text,
	"status" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_otp_challenges_hash" CHECK (octet_length("auth_otp_challenges"."recipient_hash") = 32 AND ("auth_otp_challenges"."code_mac" IS NULL OR octet_length("auth_otp_challenges"."code_mac") = 32)),
	CONSTRAINT "auth_otp_challenges_status" CHECK ("auth_otp_challenges"."status" IN ('ACTIVE','CONSUMED','EXHAUSTED','EXPIRED','SUPERSEDED','SUPPRESSED')),
	CONSTRAINT "auth_otp_challenges_attempts" CHECK ("auth_otp_challenges"."failed_attempts" BETWEEN 0 AND 5 AND ("auth_otp_challenges"."status" <> 'EXHAUSTED' OR "auth_otp_challenges"."failed_attempts" = 5)),
	CONSTRAINT "auth_otp_challenges_expiry" CHECK ("auth_otp_challenges"."expires_at" = "auth_otp_challenges"."created_at" + interval '300 seconds'),
	CONSTRAINT "auth_otp_challenges_terminal" CHECK (("auth_otp_challenges"."status" = 'ACTIVE' AND "auth_otp_challenges"."code_mac" IS NOT NULL AND "auth_otp_challenges"."user_id" IS NOT NULL AND "auth_otp_challenges"."derivation_key_id" IS NOT NULL AND "auth_otp_challenges"."verification_key_id" IS NOT NULL AND "auth_otp_challenges"."finished_at" IS NULL AND "auth_otp_challenges"."consumed_at" IS NULL) OR ("auth_otp_challenges"."status" <> 'ACTIVE' AND "auth_otp_challenges"."code_mac" IS NULL AND "auth_otp_challenges"."finished_at" IS NOT NULL AND (("auth_otp_challenges"."status" = 'CONSUMED') = ("auth_otp_challenges"."consumed_at" IS NOT NULL)))),
	CONSTRAINT "auth_otp_challenges_context" CHECK (jsonb_typeof("auth_otp_challenges"."device_context") = 'object' AND "auth_otp_challenges"."device_context" ?& ARRAY['companyId','businessId','branchId','deviceId'] AND "auth_otp_challenges"."device_context" - ARRAY['companyId','businessId','branchId','deviceId'] = '{}'::jsonb AND ("auth_otp_challenges"."device_context"->>'companyId') ~ '^[a-f0-9-]{36}$' AND ("auth_otp_challenges"."device_context"->>'businessId') ~ '^[a-f0-9-]{36}$' AND ("auth_otp_challenges"."device_context"->>'branchId') ~ '^[a-f0-9-]{36}$' AND ("auth_otp_challenges"."device_context"->>'deviceId') ~ '^[a-f0-9-]{36}$')
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "staff_device_context" jsonb;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "staff_authenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "staff_absolute_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_binding_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_notification_attempts" ADD CONSTRAINT "auth_notification_attempts_challenge_id_auth_otp_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."auth_otp_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_notification_attempts" ADD CONSTRAINT "auth_notification_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_otp_challenges" ADD CONSTRAINT "auth_otp_challenges_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_notification_attempts_challenge_idx" ON "auth_notification_attempts" USING btree ("challenge_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "auth_notification_attempts_user_idx" ON "auth_notification_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_notification_attempts_expiry_idx" ON "auth_notification_attempts" USING btree ("send_deadline","id");--> statement-breakpoint
CREATE INDEX "auth_otp_challenges_phone_idx" ON "auth_otp_challenges" USING btree ("recipient_hash","status","created_at","id");--> statement-breakpoint
CREATE INDEX "auth_otp_challenges_user_idx" ON "auth_otp_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_otp_challenges_expiry_idx" ON "auth_otp_challenges" USING btree ("expires_at","id");