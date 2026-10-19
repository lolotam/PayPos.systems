-- pospay:data-step employee-numbers
ALTER TABLE "employees" ADD CONSTRAINT "employees_employee_number_present" CHECK ("employees"."employee_number" IS NOT NULL) NOT VALID;
