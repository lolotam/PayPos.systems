CREATE INDEX CONCURRENTLY "line_performers_linked_user_idx" ON "line_performers" USING btree ("linked_user_id") WHERE "line_performers"."linked_user_id" IS NOT NULL;
