// تعديل الموظف يفتح أعمدة الموارد البشرية فقط؛ هوية الشركة والنشاط وبداية الارتباط والحذف تبقى محمية.
export const EMPLOYEE_COLUMN_GRANTS = [
  'employee_branches.to:pospay_app:UPDATE',
  'employee_salaries.amount:pospay_app:UPDATE',
  'employee_salaries.reason:pospay_app:UPDATE',
  'employee_salaries.revision:pospay_app:UPDATE',
  'employee_salaries.set_by:pospay_app:UPDATE',
  'employees.contract_end:pospay_app:UPDATE',
  'employees.hire_date:pospay_app:UPDATE',
  'employees.name_ar:pospay_app:UPDATE',
  'employees.name_en:pospay_app:UPDATE',
  'employees.primary_branch_id:pospay_app:UPDATE',
  'employees.revision:pospay_app:UPDATE',
  'employees.role_code:pospay_app:UPDATE',
  'employees.user_id:pospay_app:UPDATE',
];
