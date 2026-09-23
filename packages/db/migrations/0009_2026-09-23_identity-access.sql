CREATE TABLE "memberships" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"user_id" uuid,
	"employee_id" uuid,
	"role_id" uuid NOT NULL,
	"role_owner_key" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"scope_business_id" uuid GENERATED ALWAYS AS (CASE WHEN scope_type = 'BUSINESS' THEN scope_id END) STORED,
	"scope_branch_id" uuid GENERATED ALWAYS AS (CASE WHEN scope_type = 'BRANCH' THEN scope_id END) STORED,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "memberships_role_owner" CHECK ("memberships"."role_owner_key" = 'global' OR "memberships"."role_owner_key" = "memberships"."company_id"::text),
	CONSTRAINT "memberships_one_holder" CHECK (num_nonnulls("memberships"."user_id", "memberships"."employee_id") = 1),
	CONSTRAINT "memberships_scope_type" CHECK ("memberships"."scope_type" IN ('COMPANY', 'BUSINESS', 'BRANCH')),
	CONSTRAINT "memberships_company_scope" CHECK ("memberships"."scope_type" <> 'COMPANY' OR "memberships"."scope_id" = "memberships"."company_id"),
	CONSTRAINT "memberships_window" CHECK ("memberships"."ends_at" IS NULL OR "memberships"."ends_at" > "memberships"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "permission_overrides" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	"effect" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"scope_business_id" uuid GENERATED ALWAYS AS (CASE WHEN scope_type = 'BUSINESS' THEN scope_id END) STORED,
	"scope_branch_id" uuid GENERATED ALWAYS AS (CASE WHEN scope_type = 'BRANCH' THEN scope_id END) STORED,
	"reason" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "permission_overrides_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "permission_overrides_effect" CHECK ("permission_overrides"."effect" IN ('ALLOW', 'DENY')),
	CONSTRAINT "permission_overrides_scope_type" CHECK ("permission_overrides"."scope_type" IN ('COMPANY', 'BUSINESS', 'BRANCH')),
	CONSTRAINT "permission_overrides_company_scope" CHECK ("permission_overrides"."scope_type" <> 'COMPANY' OR "permission_overrides"."scope_id" = "permission_overrides"."company_id"),
	CONSTRAINT "permission_overrides_reason_length" CHECK (char_length("permission_overrides"."reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	CONSTRAINT "permissions_code_format" CHECK ("permissions"."code" ~ '^[a-z][a-z-]*:[a-z][a-z-]*:(platform|company|business|branch)$')
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"role_owner_key" text NOT NULL,
	"company_id" uuid,
	"permission_code" text NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("role_id","role_owner_key","permission_code"),
	CONSTRAINT "role_permissions_owner" CHECK ("role_permissions"."role_owner_key" = COALESCE("role_permissions"."company_id"::text, 'global'))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid NOT NULL,
	"company_id" uuid,
	"owner_key" text GENERATED ALWAYS AS (COALESCE(company_id::text, 'global')) STORED NOT NULL,
	"code" text NOT NULL,
	"name_ar" text,
	"name_en" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_pkey" PRIMARY KEY("id","owner_key"),
	CONSTRAINT "roles_owner_key_code_key" UNIQUE("owner_key","code"),
	CONSTRAINT "roles_code_format" CHECK ("roles"."code" ~ '^[a-z][a-z_]{0,63}$'),
	CONSTRAINT "roles_name_en_length" CHECK (char_length("roles"."name_en") BETWEEN 1 AND 255),
	CONSTRAINT "roles_name_ar_length" CHECK ("roles"."name_ar" IS NULL OR char_length("roles"."name_ar") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_fk" FOREIGN KEY ("role_id","role_owner_key") REFERENCES "public"."roles"("id","owner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_scope_business_fk" FOREIGN KEY ("company_id","scope_business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_scope_branch_fk" FOREIGN KEY ("company_id","scope_branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_membership_fk" FOREIGN KEY ("company_id","membership_id") REFERENCES "public"."memberships"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_scope_business_fk" FOREIGN KEY ("company_id","scope_business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_scope_branch_fk" FOREIGN KEY ("company_id","scope_branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("role_id","role_owner_key") REFERENCES "public"."roles"("id","owner_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_company_id_employee_id_idx" ON "memberships" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "memberships_role_idx" ON "memberships" USING btree ("role_id","role_owner_key");--> statement-breakpoint
CREATE INDEX "memberships_scope_business_idx" ON "memberships" USING btree ("company_id","scope_business_id");--> statement-breakpoint
CREATE INDEX "memberships_scope_branch_idx" ON "memberships" USING btree ("company_id","scope_branch_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_membership_idx" ON "permission_overrides" USING btree ("company_id","membership_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_permission_code_idx" ON "permission_overrides" USING btree ("permission_code");--> statement-breakpoint
CREATE INDEX "permission_overrides_granted_by_idx" ON "permission_overrides" USING btree ("granted_by");--> statement-breakpoint
CREATE INDEX "permission_overrides_scope_business_idx" ON "permission_overrides" USING btree ("company_id","scope_business_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_scope_branch_idx" ON "permission_overrides" USING btree ("company_id","scope_branch_id");--> statement-breakpoint
CREATE INDEX "role_permissions_company_id_idx" ON "role_permissions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_code_idx" ON "role_permissions" USING btree ("permission_code");--> statement-breakpoint
CREATE INDEX "roles_company_id_idx" ON "roles" USING btree ("company_id");