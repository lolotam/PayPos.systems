CREATE TABLE "file_cleanup_objects" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"kind" text NOT NULL,
	"verification_lease_id" uuid,
	"expiry_at" timestamp with time zone NOT NULL,
	"cleanup_after" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'OWNED' NOT NULL,
	"cleaned_at" timestamp with time zone,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	CONSTRAINT "file_cleanup_objects_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "file_cleanup_objects_key_unique" UNIQUE("company_id","object_key"),
	CONSTRAINT "file_cleanup_objects_kind" CHECK ("file_cleanup_objects"."kind" IN ('STAGING','CANDIDATE')),
	CONSTRAINT "file_cleanup_objects_state" CHECK ("file_cleanup_objects"."state" IN ('OWNED','PUBLISHED','DELETING') AND ("file_cleanup_objects"."state" <> 'PUBLISHED' OR ("file_cleanup_objects"."kind" = 'CANDIDATE' AND "file_cleanup_objects"."cleaned_at" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "file_cleanup_objects" ADD CONSTRAINT "file_cleanup_objects_file_fk" FOREIGN KEY ("company_id","file_id") REFERENCES "public"."file_objects"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_cleanup_objects_company_file_idx" ON "file_cleanup_objects" USING btree ("company_id","file_id");--> statement-breakpoint
CREATE INDEX "file_cleanup_objects_due_idx" ON "file_cleanup_objects" USING btree ("company_id","cleanup_after") WHERE "file_cleanup_objects"."state" <> 'PUBLISHED';