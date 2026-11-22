import { staffColumnCode, type StaffColumnCode } from '@pospay/contracts';

/** الأعمدة المعروضة في شاشة أعمدة تطبيق الموظفين: كل أكواد العقد بترتيبها، rating_average منها (D-A7). */
export function offeredStaffColumns(): readonly StaffColumnCode[] {
  return staffColumnCode.options;
}
