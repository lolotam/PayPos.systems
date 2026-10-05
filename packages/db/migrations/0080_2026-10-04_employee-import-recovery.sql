CREATE INDEX "import_previews_company_creator_idx" ON "import_previews" USING btree ("company_id","created_by");--> statement-breakpoint
CREATE INDEX "import_previews_company_status_requested_idx" ON "import_previews" USING btree ("company_id","status","requested_at","id");--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_committed_consistent" CHECK (("import_previews"."status" = 'committed') = ("import_previews"."committed_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_failed_error" CHECK ("import_previews"."status" <> 'failed' OR "import_previews"."error_code" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_count_committed" CHECK ("import_previews"."status" = 'committed' OR "import_previews"."created_count" = 0);--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_requested_at" CHECK ("import_previews"."status" <> 'commit_requested' OR "import_previews"."requested_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "file_objects" VALIDATE CONSTRAINT "file_objects_type";