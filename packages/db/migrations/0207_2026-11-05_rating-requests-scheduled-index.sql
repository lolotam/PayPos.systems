-- جولة المطالبة بتزور الطلبات المجدولة بس، فالفهرس الجزئي بيخلّي طول الجولة تابع للطلبات المعلقة مش للتاريخ؛ وCONCURRENTLY عشان الكتابة على rating_requests ما تقفش أثناء البناء (PP-109.1).
CREATE INDEX CONCURRENTLY "rating_requests_scheduled_id_idx" ON "rating_requests" USING btree ("company_id","id") WHERE "rating_requests"."status" = 'SCHEDULED';
