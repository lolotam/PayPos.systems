-- pospay:data-step employee-name-keys
ALTER TABLE "employees" ADD CONSTRAINT "employees_name_en_key_present" CHECK ("employees"."name_en_key" IS NOT NULL) NOT VALID;
