-- فهرسان بس على جداول فيها حركة، بيتبنوا CONCURRENTLY في هجرة لوحدها عشان ما يقفلوش الكتابة (ADR-0033): إعادة تشغيل مدخلات العمولة من الـ outbox (الصف 50-0) وقارئ bootstrap للبقشيش بمفتاح (اليوم، المعرّف) (issue 649).
CREATE INDEX CONCURRENTLY "outbox_commission_input_replay_idx" ON "outbox" USING btree ("company_id","id") WHERE "outbox"."event_type" IN ('ServiceSessionRecorded','ServiceSessionLinesAdded','ServiceLineChanged','SalaryChanged');
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "service_sessions_business_day_idx" ON "service_sessions" USING btree ("company_id","business_id","business_date","id");
