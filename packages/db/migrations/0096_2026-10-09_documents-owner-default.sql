-- قرار المالك 2026-10-09: الوثائق للمالك افتراضياً، والمنح الشخصية تفضل كما هي.
DELETE FROM role_permissions WHERE role_owner_key = 'global' AND company_id IS NULL
  AND role_id IN ('01920000-0000-7000-8000-000000000102','01920000-0000-7000-8000-000000000104')
  AND permission_code IN ('read:files:business','manage:files:business','manage:document-types:company');
