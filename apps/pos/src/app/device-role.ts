import Dexie, { type Table } from 'dexie';

export type DeviceRole = 'counter' | 'employee';

interface DeviceRoleRow {
  id: 'current';
  role: string;
}

// الدور بيتخزن في قاعدة IndexedDB لوحدها: قاعدة 'pospay-pos' بتاعت الـ PWA ما تتلمسش
// (ADR-0055 قرار 2)، ومفيش حاجة شخصية بتتخزن هنا (FR-009).
class NativeShellDatabase extends Dexie {
  role!: Table<DeviceRoleRow, 'current'>;

  constructor() {
    super('pospay-native-shell');
    this.version(1).stores({ role: 'id' });
  }
}

const nativeShellDb = new NativeShellDatabase();

const CURRENT_ROLE = 'current' as const;

/**
 * بيقرأ الدور المحفوظ على الجهاز.
 *
 * @returns الدور المحفوظ، أو null لو مفيش حاجة محفوظة أو القيمة مش معروفة
 */
export async function readDeviceRole(): Promise<DeviceRole | null> {
  const row = await nativeShellDb.role.get(CURRENT_ROLE);
  if (!row) return null;
  return row.role === 'counter' || row.role === 'employee' ? row.role : null;
}

/**
 * بيحفظ الدور على الجهاز عشان التطبيق يفتح على الشاشة دي مباشرة في كل تشغيل بعده.
 *
 * @param role الدور المطلوب حفظه
 */
export async function saveDeviceRole(role: DeviceRole): Promise<void> {
  await nativeShellDb.role.put({ id: CURRENT_ROLE, role });
}
