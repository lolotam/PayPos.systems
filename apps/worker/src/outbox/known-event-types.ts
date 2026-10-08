export const KNOWN_EVENT_TYPES = [
  // قرار Waleed في 2026-10-08: PR 50 سيعالج SalaryChanged المنشور قبل المستهلك؛ بوابة ADR-0012 تظل مغلقة حتى المعالجة.
  'SalaryChanged',
  // شاشات الإجازة تقرأ الحالة مباشرة؛ إشعارات الموظف مؤجلة حسب DL-Q3 في spec 025.
  'LeaveRequested',
  'LeaveCancelled',
  'LeaveApproved',
  'LeaveRejected',
  'LeaveRevoked',
  // تاريخ الربط مقروء من staff ولا يحتاج مستهلكاً في مرحلة polling (ADR-0029).
  'EmployeePasskeyBound',
  // PR21 بلا مستهلك أعمال في هذه المرحلة؛ الشاشة تقرأ التاريخ ولا يحتاج الحدث إعادة محاولة.
  'EmployeePasskeyUnbound',
  // PR 11: لا مستهلك بعد؛ سجل الاستيراد التدقيق والأحداث في نفس المعاملة ولا يحتاج إعادة محاولة (ADR-0034).
  'EmployeeImported',
  'ImportCommitted',
  'FileUploadRequested',
  'CompanyCreated',
  'BusinessCreated',
  'BranchCreated',
  'BusinessSettingsUpdated',
] as const;

// أنواع الوحدات تظل مرتبطة بتفعيلها؛ خصوصاً نقل الإشعارات الذي لا يجوز إقراره عند تعطيل القناة.
export function knownEventTypes(...modules: readonly ({ eventTypes: readonly string[] } | null)[]) {
  return [...KNOWN_EVENT_TYPES, ...modules.flatMap((module) => module?.eventTypes ?? [])];
}
