CREATE UNIQUE INDEX CONCURRENTLY "business_settings_logo_file_key" ON "business_settings" ("company_id","logo_file_id") WHERE "logo_file_id" IS NOT NULL;
