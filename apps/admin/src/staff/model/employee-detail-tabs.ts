import type { MessageKey } from '@pospay/i18n';

/** تبويبات صفحة الموظف بترتيب عرضها؛ الإجازات لها مسارها القديم والباقي استعلام `?tab=`. */
export const EMPLOYEE_DETAIL_TABS = ['data', 'pay', 'hours', 'documents', 'leave'] as const;

export type EmployeeDetailTab = (typeof EMPLOYEE_DETAIL_TABS)[number];

/** تبويبات الاستعلام فقط: «البيانات» هي الافتراضية بلا استعلام و«الإجازات» لها مسار خاص. */
const QUERY_TABS: readonly EmployeeDetailTab[] = ['pay', 'hours', 'documents'];

export const EMPLOYEE_DETAIL_TAB_LABELS: Record<EmployeeDetailTab, MessageKey> = {
  data: 'leaveHistory.tabData',
  pay: 'leaveHistory.tabPay',
  hours: 'leaveHistory.tabHours',
  documents: 'leaveHistory.tabDocuments',
  leave: 'leaveHistory.tabLeave',
};

/** قيمة `?tab=` غير المعروفة أو الغائبة تعرض «البيانات» بدل صفحة فارغة. */
export function employeeDetailQueryTab(value: string | null | undefined): EmployeeDetailTab {
  return QUERY_TABS.find((tab) => tab === value) ?? 'data';
}

/** عنوان التبويب؛ المعرّف يُرمَّز لأنه يأتي من العنوان ولو لم يكن UUID. */
export function employeeDetailHref(employeeId: string, tab: EmployeeDetailTab): string {
  const base = `/staff/${encodeURIComponent(employeeId)}`;
  if (tab === 'data') return base;
  return tab === 'leave' ? `${base}/leave` : `${base}?tab=${tab}`;
}

/** معرّفات الأقسام التي تأخذها أقسام الملف كما كانت تمرَّر من لوحة التعديل. */
export type EmployeeSectionScope = {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
};
