-- عمود اختياري لرقم المستند؛ nullable فالوثيقات القديمة بتشتغل من غيره ولا يوجد backfill (62-2e، expand فقط).
-- المهلة القصيرة للـ lock بتخلّي الهجرة تفشل بسرعة وتتعاد بدل ما تقف ورا حركة الجدول.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "document_number" text;
--> statement-breakpoint
-- القيد بيتضاف NOT VALID عشان ما يفحصش جدول الوثائق الموجود تحت قفل تقيل؛ التحقق في ذيل 0237 (نمط 0194/0195).
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_document_number" CHECK ("employee_documents"."document_number" IS NULL OR (char_length("employee_documents"."document_number") BETWEEN 1 AND 64 AND "employee_documents"."document_number" = btrim("employee_documents"."document_number") AND "employee_documents"."document_number" !~ '[\u0001-\u001f\u007f-\u009f]' AND "employee_documents"."document_number" !~ '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND "employee_documents"."document_number" !~ '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$')) NOT VALID;
