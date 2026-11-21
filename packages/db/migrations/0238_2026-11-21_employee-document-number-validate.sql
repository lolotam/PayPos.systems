-- التحقق بقفل أخف في معاملة مستقلة بعد إضافة القيد.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "employee_documents" VALIDATE CONSTRAINT "employee_documents_document_number";
