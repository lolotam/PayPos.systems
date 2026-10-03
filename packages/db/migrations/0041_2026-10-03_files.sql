CREATE TABLE "file_access_audit" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"accessed_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "file_access_audit_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "file_access_audit_outcome" CHECK ("file_access_audit"."outcome" IN ('ALLOW','DENY'))
);
--> statement-breakpoint
CREATE TABLE "file_objects" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid,
	"owner_module" text NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"staging_key" text NOT NULL,
	"storage_key" text,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"required_permission" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"rejection_code" text,
	CONSTRAINT "file_objects_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "file_objects_staging_key_unique" UNIQUE("company_id","staging_key"),
	CONSTRAINT "file_objects_storage_key_unique" UNIQUE("company_id","storage_key"),
	CONSTRAINT "file_objects_size" CHECK ("file_objects"."size_bytes" BETWEEN 1 AND 104857600),
	CONSTRAINT "file_objects_state" CHECK ("file_objects"."status" IN ('PENDING','VERIFYING','READY','REJECTED')),
	CONSTRAINT "file_objects_ready_key" CHECK (("file_objects"."status" = 'READY') = ("file_objects"."storage_key" IS NOT NULL)),
	CONSTRAINT "file_objects_permission_scope" CHECK ("file_objects"."required_permission" ~ '^[a-z]+:[a-z-]+:(company|business|branch)$' AND ("file_objects"."required_permission" NOT LIKE '%:branch' OR "file_objects"."branch_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "file_access_audit" ADD CONSTRAINT "file_access_audit_file_fk" FOREIGN KEY ("company_id","file_id") REFERENCES "public"."file_objects"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_required_permission_permissions_code_fk" FOREIGN KEY ("required_permission") REFERENCES "public"."permissions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_access_audit_company_file_idx" ON "file_access_audit" USING btree ("company_id","file_id","accessed_at");--> statement-breakpoint
CREATE INDEX "file_access_audit_company_actor_idx" ON "file_access_audit" USING btree ("company_id","actor_user_id");--> statement-breakpoint
CREATE INDEX "file_objects_company_business_idx" ON "file_objects" USING btree ("company_id","business_id","created_at");--> statement-breakpoint
CREATE INDEX "file_objects_company_branch_idx" ON "file_objects" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "file_objects_company_creator_idx" ON "file_objects" USING btree ("company_id","created_by");--> statement-breakpoint
CREATE INDEX "file_objects_company_owner_idx" ON "file_objects" USING btree ("company_id","owner_module","owner_entity_id");--> statement-breakpoint
CREATE INDEX "file_objects_permission_idx" ON "file_objects" USING btree ("required_permission");