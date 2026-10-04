import { attendanceInstallationSignal } from '@pospay/contracts';

export const INSTALLATION_KEY = 'pospay.attendance.installation';
let unstored: string | null = null;

// ADR-0029: معرف عشوائي لتثبيت التطبيق الشخصي، ليس اعتماداً ولا إذناً؛ لا يُمسح مع الخروج
// أو تبديل الموظف كي تظهر للمدير جلستان من نفس التثبيت، ولا يدخل IndexedDB أو المزامنة.
export function attendanceInstallationId(): string {
  try {
    const stored = localStorage.getItem(INSTALLATION_KEY);
    if (attendanceInstallationSignal.safeParse({ installation_id: stored }).success)
      return String(stored).toLowerCase();
    const created = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, created);
    return created;
  } catch {
    // تخزين محجوب (تصفح خاص) يعطي معرفاً ثابتاً لعمر الصفحة فقط؛ الإشارة استرشادية لا تمنع الحضور.
    unstored ??= crypto.randomUUID();
    return unstored;
  }
}
