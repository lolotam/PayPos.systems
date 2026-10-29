ALTER TABLE "commission_statement_lines" ADD COLUMN "source_branch_name_ar" text, ADD COLUMN "source_branch_name_en" text;
--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_source_branch_name" CHECK (("commission_statement_lines"."source_branch_name_en" IS NOT NULL) = ("commission_statement_lines"."source_branch_id" IS NOT NULL)
        AND ("commission_statement_lines"."source_branch_id" IS NOT NULL OR "commission_statement_lines"."source_branch_name_ar" IS NULL));
