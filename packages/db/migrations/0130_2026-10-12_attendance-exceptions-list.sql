CREATE INDEX CONCURRENTLY "attendance_exceptions_list_idx" ON "attendance_exceptions" USING btree ("company_id","business_id","status","raised_at" DESC NULLS LAST,"id" DESC NULLS LAST);
