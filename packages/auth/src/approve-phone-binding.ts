import { createStaffOtpDatabase } from '@pospay/db';

/**
 * ربط الهوية العامة عملية منصة مراجعة؛ لا endpoint للموظف أو مدير الشركة يستدعيها.
 * الإثبات والموافقة من operator خارج الشركة، والتعديل مع الإبطال والتدقيق في معاملة واحدة.
 *
 * @param options اتصال الهوية وإثبات ملكية الهاتف وموافقة المنصة دون بيانات عميل غير موثوقة
 * @returns انتهاء الربط المعتمد أو رفض عام بدون echo للبيانات
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
}): Promise<void> {
  if (
    !options.approved ||
    !options.ownershipVerified ||
    !/^[a-zA-Z][a-zA-Z0-9_.-]{1,63}$/.test(options.operator) ||
    !/^\+[1-9]\d{7,14}$/.test(options.phone) ||
    !/^[a-f0-9-]{36}$/.test(options.userId)
  )
    throw new Error('PHONE_BINDING_REFUSED');
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.phoneLockKey,
  });
  try {
    await database.approvePhone({
      userId: options.userId,
      phone: options.phone,
      actor: options.operator,
      auditId: options.ids.newId(),
    });
  } catch {
    throw new Error('PHONE_BINDING_REFUSED');
  } finally {
    await database.close();
  }
}
