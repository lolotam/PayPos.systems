// قرار المالك 2026-10-04 (UNB-Q2): عشر دقائق شاملة الحدود لإشارة مراجعة لا تمنع الحضور.
export const SHARED_INSTALLATION_WINDOW_MS = 10 * 60 * 1000;
/** ملاحظة أثر حضور مقبول؛ hash ليس هوية هاتف ولا عامل مصادقة. */
export interface InstallationObservation {
  readonly companyId: string;
  readonly employeeId: string;
  readonly installationHash: string;
  readonly clockedAt: Date;
}
/** يرفع إشارة مراجعة لموظفين مختلفين على تثبيت واحد، ولا يرفض أي حضور.
 *
 * @param first أثر الحضور الأول
 * @param second أثر الحضور الثاني
 * @param windowMs النافذة الزمنية الشاملة، الافتراضي المعتمد عشر دقائق
 * @returns هل توجد إشارة اشتراك تستحق مراجعة المدير
 */
export function sharesInstallationWithinWindow(
  first: InstallationObservation,
  second: InstallationObservation,
  windowMs = SHARED_INSTALLATION_WINDOW_MS,
): boolean {
  return (
    Number.isFinite(windowMs) &&
    windowMs >= 0 &&
    first.companyId === second.companyId &&
    first.employeeId !== second.employeeId &&
    first.installationHash.length > 0 &&
    first.installationHash === second.installationHash &&
    Math.abs(first.clockedAt.getTime() - second.clockedAt.getTime()) <= windowMs
  );
}
