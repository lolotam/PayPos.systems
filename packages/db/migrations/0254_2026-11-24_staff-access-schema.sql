CREATE TABLE "employee_staff_access" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"user_id" uuid,
	"membership_id" uuid,
	"role_code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"attempt_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"phone_hash" text NOT NULL,
	"state" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_staff_access_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employee_staff_access_employee" UNIQUE("company_id","employee_id"),
	CONSTRAINT "employee_staff_access_operation" UNIQUE("company_id","operation_id"),
	CONSTRAINT "employee_staff_access_role_code" CHECK ("employee_staff_access"."role_code" IN ('staff', 'reception')),
	CONSTRAINT "employee_staff_access_state" CHECK ("employee_staff_access"."state" IN ('PENDING', 'ACTIVE', 'STOPPED', 'PHONE_CHANGING', 'CANCELLING')),
	CONSTRAINT "employee_staff_access_active_rows" CHECK ("employee_staff_access"."state" <> 'ACTIVE' OR ("employee_staff_access"."user_id" IS NOT NULL AND "employee_staff_access"."membership_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "staff_access_company_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "staff_access_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD COLUMN "temporary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employee_staff_access" ADD CONSTRAINT "employee_staff_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access" ADD CONSTRAINT "employee_staff_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access" ADD CONSTRAINT "employee_staff_access_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access" ADD CONSTRAINT "employee_staff_access_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access" ADD CONSTRAINT "employee_staff_access_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access" ADD CONSTRAINT "employee_staff_access_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access" ADD CONSTRAINT "employee_staff_access_membership_fk" FOREIGN KEY ("company_id","membership_id") REFERENCES "public"."memberships"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_staff_access_company_idx" ON "employee_staff_access" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "employee_staff_access_user_idx" ON "employee_staff_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employee_staff_access_granted_by_idx" ON "employee_staff_access" USING btree ("granted_by");--> statement-breakpoint
CREATE INDEX "employee_staff_access_branch_idx" ON "employee_staff_access" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "employee_staff_access_membership_idx" ON "employee_staff_access" USING btree ("company_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_staff_access_operation_id_key" ON "user" USING btree ("staff_access_operation_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_staff_access_together" CHECK (("user"."staff_access_company_id" IS NULL) = ("user"."staff_access_operation_id" IS NULL));