CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"name" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "employee_passkeys" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"passkey_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"bound_by" uuid NOT NULL,
	"unbound_at" timestamp with time zone,
	"unbound_by" uuid,
	CONSTRAINT "employee_passkeys_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employee_passkeys_revision_positive" CHECK ("employee_passkeys"."revision" > 0),
	CONSTRAINT "employee_passkeys_unbound_pair" CHECK (("employee_passkeys"."unbound_at" IS NULL) = ("employee_passkeys"."unbound_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "auth_otp_challenges" DROP CONSTRAINT "auth_otp_challenges_context";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "staff_personal_context" jsonb;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_passkeys" ADD CONSTRAINT "employee_passkeys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_passkeys" ADD CONSTRAINT "employee_passkeys_passkey_id_passkey_id_fk" FOREIGN KEY ("passkey_id") REFERENCES "public"."passkey"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_passkeys" ADD CONSTRAINT "employee_passkeys_bound_by_user_id_fk" FOREIGN KEY ("bound_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_passkeys" ADD CONSTRAINT "employee_passkeys_unbound_by_user_id_fk" FOREIGN KEY ("unbound_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_passkeys" ADD CONSTRAINT "employee_passkeys_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_key" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_user_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_passkeys_active_employee_key" ON "employee_passkeys" USING btree ("company_id","employee_id") WHERE "employee_passkeys"."unbound_at" IS NULL;--> statement-breakpoint
CREATE INDEX "employee_passkeys_employee_history_idx" ON "employee_passkeys" USING btree ("company_id","employee_id","bound_at");--> statement-breakpoint
CREATE INDEX "employee_passkeys_business_idx" ON "employee_passkeys" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "employee_passkeys_credential_idx" ON "employee_passkeys" USING btree ("company_id","passkey_id");--> statement-breakpoint
CREATE INDEX "employee_passkeys_bound_by_idx" ON "employee_passkeys" USING btree ("bound_by");--> statement-breakpoint
CREATE INDEX "employee_passkeys_unbound_by_idx" ON "employee_passkeys" USING btree ("unbound_by");--> statement-breakpoint
ALTER TABLE "auth_otp_challenges" ADD CONSTRAINT "auth_otp_challenges_context" CHECK (jsonb_typeof("auth_otp_challenges"."device_context") = 'object'
        AND ("auth_otp_challenges"."device_context"->>'companyId') ~ '^[a-f0-9-]{36}$'
        AND ("auth_otp_challenges"."device_context"->>'businessId') ~ '^[a-f0-9-]{36}$'
        AND (("auth_otp_challenges"."device_context" ?& ARRAY['companyId','businessId','branchId','deviceId']
          AND "auth_otp_challenges"."device_context" - ARRAY['companyId','businessId','branchId','deviceId'] = '{}'::jsonb
          AND ("auth_otp_challenges"."device_context"->>'branchId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'deviceId') ~ '^[a-f0-9-]{36}$')
        OR ("auth_otp_challenges"."device_context" ?& ARRAY['purpose','companyId','businessId']
          AND "auth_otp_challenges"."device_context" - ARRAY['purpose','companyId','businessId'] = '{}'::jsonb
          AND "auth_otp_challenges"."device_context"->>'purpose' = 'STAFF_PERSONAL')));