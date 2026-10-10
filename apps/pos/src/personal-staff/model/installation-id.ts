import { attendanceInstallationSignal } from '@pospay/contracts';

export const INSTALLATION_KEY = 'pospay.attendance.installation';
export const INSTALLATION_STORAGE_BLOCKED = 'INSTALLATION_STORAGE_BLOCKED';
let persistenceRequested = false;

// ADR-0029: معرف عشوائي لتثبيت التطبيق الشخصي، ليس اعتماداً ولا إذناً؛ لا يُمسح مع الخروج
// أو تبديل الموظف حتى يبقى قفل الهاتف؛ ولا يدخل IndexedDB أو المزامنة.
export function attendanceInstallationId(): string {
  if (!persistenceRequested) {
    persistenceRequested = true;
    try {
      void navigator.storage?.persist?.().catch(() => undefined);
    } catch {
      /* التخزين الدائم تحسين اختياري. */
    }
  }
  try {
    const stored = localStorage.getItem(INSTALLATION_KEY);
    if (attendanceInstallationSignal.safeParse({ installation_id: stored }).success)
      return String(stored).toLowerCase();
    const created = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, created);
    return created;
  } catch {
    // معرف لعمر الصفحة كان سيقفل البصمة على تثبيت يختفي مع إعادة التحميل؛ نرفض قبل أي طلب.
    throw new Error(INSTALLATION_STORAGE_BLOCKED);
  }
}
