ALTER TABLE "import_previews" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_previews" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_previews" ADD COLUMN "created_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_previews" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_status" CHECK ("import_previews"."status" IN ('ready','commit_requested','committed','failed'));--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_created_count" CHECK ("import_previews"."created_count" BETWEEN 0 AND 500);
--> statement-breakpoint
-- المعاينات المستهلكة قبل الترقية تبقى نهائية ولا يعاد إنشاء موظفيها.
UPDATE import_previews SET status='committed',created_count=row_count WHERE committed_at IS NOT NULL;
--> statement-breakpoint
GRANT UPDATE(status,requested_at,created_count,error_code) ON import_previews TO pospay_app;
