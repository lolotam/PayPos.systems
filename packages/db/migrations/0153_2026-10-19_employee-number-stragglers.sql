-- pospay:data-step employee-numbers
COMMENT ON COLUMN "employees"."employee_number" IS 'Company-unique employee number (1..999999), deleted employees included; the 8c-11 straggler pass re-runs employee-numbers before the column is required (spec 051).';
