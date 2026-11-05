export const COMMISSION_TIP_SALARY_COLUMN_GRANTS = [
  ...['revision', 'branch_id', 'business_date', 'period'].map(
    (column) => `commission_tip_heads.${column}:pospay_app:UPDATE`,
  ),
  ...['amount', 'revision'].map((column) => `commission_salaries.${column}:pospay_app:UPDATE`),
];
