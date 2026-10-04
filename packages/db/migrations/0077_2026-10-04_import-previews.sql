CREATE TABLE "import_previews" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"file_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	"row_count" integer NOT NULL,
	"error_count" integer NOT NULL,
	"rows" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	CONSTRAINT "import_previews_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "import_previews_entity_format" CHECK ("import_previews"."entity" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "import_previews_row_count" CHECK ("import_previews"."row_count" BETWEEN 0 AND 500),
	CONSTRAINT "import_previews_error_count" CHECK ("import_previews"."error_count" >= 0),
	CONSTRAINT "import_previews_expiry" CHECK ("import_previews"."expires_at" > "import_previews"."created_at")
);
--> statement-breakpoint
ALTER TABLE "file_objects" DROP CONSTRAINT "file_objects_type";--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_file_fk" FOREIGN KEY ("company_id","file_id") REFERENCES "public"."file_objects"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_previews_company_business_created_idx" ON "import_previews" USING btree ("company_id","business_id","created_at");--> statement-breakpoint
CREATE INDEX "import_previews_company_file_idx" ON "import_previews" USING btree ("company_id","file_id");--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_type" CHECK ("file_objects"."content_type" IN ('application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));