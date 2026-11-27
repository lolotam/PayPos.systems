import { createStaffOtpDatabase } from '@pospay/db';

/**
 * ربط الهوية العامة عملية منصة مراجعة؛ لا endpoint للموظف أو مدير الشركة يستدعيها.
 * الإثبات والموافقة من operator خارج الشركة، والتعديل مع الإبطال والتدقيق في معاملة واحدة.
 *
 * @param options اتصال الهوية وإثبات ملكية الهاتف وموافقة المنصة دون بيانات عميل غير موثوقة
 * @returns حالة الاعتماد: تم الاعتماد أم كان معتمداً بالهاتف نفسه من قبل، أو رفض عام بدون echo للبيانات
 */
export async function approvePhoneBinding(options: {
  databaseUrl: string;
  userId: string;
  phone: string;
  operator: string;
  ownershipVerified: boolean;
  approved: boolean;
  ids: { newId(): string };
  phoneLockKey(hash: Uint8Array): bigint;
  clock: { now(): Date };
  isCanonicalPhone(phone: string): boolean;
}): Promise<'approved' | 'unchanged'> {
  if (
    !options.approved ||
    !options.ownershipVerified ||
    !/^[a-zA-Z][a-zA-Z0-9_.-]{1,63}$/.test(options.operator) ||
    !options.isCanonicalPhone(options.phone) ||
    !/^[a-f0-9-]{36}$/.test(options.userId)
  )
    throw new Error('PHONE_BINDING_REFUSED');
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.phoneLockKey,
  });
  try {
    return await database.approvePhone({
      userId: options.userId,
      phone: options.phone,
      actor: options.operator,
      auditId: options.ids.newId(),
      at: options.clock.now(),
    });
  } catch {
    throw new Error('PHONE_BINDING_REFUSED');
  } finally {
    await database.close();
  }
}
