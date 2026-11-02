-- Custom SQL migration file, put your code below! --
-- قرار المالك PK-Q13 (PP-16.2، spec 058): أدوار تسجيل الزيارة الخمسة هي اللي تبيع الباقات.
-- الأدوار نظامية (global)، فالإدخال ده بيوصل لكل الشركات القائمة من غير خطوة بيانات.
INSERT INTO permissions(code) VALUES ('sell:packages:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,'sell:packages:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager','cashier')
ON CONFLICT DO NOTHING;
