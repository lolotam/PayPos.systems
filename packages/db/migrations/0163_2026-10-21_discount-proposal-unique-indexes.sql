-- مفاتيح الربط على جداول فيها حركة تُبنى CONCURRENTLY في هجرة لوحدها عشان ما تقفلش الكتابة (ADR-0033)؛ الربط نفسه في 0164.
CREATE UNIQUE INDEX CONCURRENTLY "devices_company_branch_id_key" ON "devices" ("company_id","branch_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "service_lines_discount_proposal_key" ON "service_lines" ("company_id","id","discount_proposal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "service_lines_discount_proposal_uq" ON "service_lines" ("company_id","discount_proposal_id") WHERE "discount_proposal_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "service_line_edits_line_id_key" ON "service_line_edits" ("company_id","line_id","id");
