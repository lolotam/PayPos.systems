import { personalWorkspace } from '@pospay/contracts';
import Dexie, { type Table } from 'dexie';

import type { PersonalWorkspace } from './manager-link';

export type DeviceRole = 'counter' | 'employee';

interface DeviceRoleRow {
  id: 'current';
  role: string;
}

interface RememberedBusinessRow {
  id: 'current';
  company_id: string;
  business_id: string;
}

// الدور بيتخزن في قاعدة IndexedDB لوحدها: قاعدة 'pospay-pos' بتاعت الـ PWA ما تتلمسش
// (ADR-0055 قرار 2)، ومفيش حاجة شخصية بتتخزن هنا (FR-009).
class NativeShellDatabase extends Dexie {
  role!: Table<DeviceRoleRow, 'current'>;
  business!: Table<RememberedBusinessRow, 'current'>;

  constructor() {
    super('pospay-native-shell');
    this.version(1).stores({ role: 'id' });
    // ترقية القاعدة: النشاط المتذكر جنب الدور، بنفس المفتاح عشان السطرين يتكتبوا مع بعض.
    this.version(2).stores({ role: 'id', business: 'id' });
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

/**
 * بيمسح الدور المتذكر بس عشان الموظفة تقدر ترجع تختار نوع الجهاز.
 * النشاط المتذكر بيفضل لأنه تلميح توجيه ممكن تحتاجه الموظفة بعد الاختيار الجديد.
 */
export async function clearDeviceRole(): Promise<void> {
  await nativeShellDb.role.delete(CURRENT_ROLE);
}

/**
 * بيقرأ النشاط المتذكر على الجهاز.
 *
 * النشاط ده تلميح توجيه للتسجيل مش صلاحية: السيرفر لسه بيقرر في كل طلب (BR-002).
 *
 * @returns النشاط المتذكر، أو null لو مفيش حاجة محفوظة أو القيمة مش صالحة
 */
export async function readRememberedBusiness(): Promise<PersonalWorkspace | null> {
  const row = await nativeShellDb.business.get(CURRENT_ROLE);
  if (!row) return null;
  const parsed = personalWorkspace.safeParse({
    company_id: row.company_id,
    business_id: row.business_id,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * بيحفظ النشاط المتذكر على الجهاز عشان الموظفة ما تربطش تاني في كل تشغيل.
 *
 * @param workspace النشاط اللي الموظفة اتوصلت بيه
 */
export async function rememberBusiness(workspace: PersonalWorkspace): Promise<void> {
  await nativeShellDb.business.put({
    id: CURRENT_ROLE,
    company_id: workspace.company_id,
    business_id: workspace.business_id,
  });
}

/**
 * بيحفظ دور الموظفة والنشاط المتذكر مع بعض في معاملة واحدة.
 *
 * معاملة واحدة عشان الجهاز ما يبقاش فيه دور موظفة من غير نشاط ولا نشاط من غير دور
 * لو التطبيق قفل في نص العملية.
 *
 * @param workspace النشاط اللي الموظفة هتتوصل بيه
 */
export async function connectEmployee(workspace: PersonalWorkspace): Promise<void> {
  await nativeShellDb.transaction('rw', nativeShellDb.role, nativeShellDb.business, async () => {
    await nativeShellDb.role.put({ id: CURRENT_ROLE, role: 'employee' });
    await nativeShellDb.business.put({
      id: CURRENT_ROLE,
      company_id: workspace.company_id,
      business_id: workspace.business_id,
    });
  });
}
