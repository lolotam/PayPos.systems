import {
  createStaffOtpDatabase,
  StaffPhoneBindingConflictError,
  StaffPhoneTakenError,
} from '@pospay/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** رفض متوقع لربط الهاتف (مدخل غير صالح أو تضارب ملكية/تغيير تحت القفل)، بخلاف أعطال البنية التحتية (#647). */
export class PhoneBindingRefusedError extends Error {
  override readonly name = 'PhoneBindingRefusedError';
  readonly code = 'PHONE_BINDING_REFUSED';
  constructor() {
    super('PHONE_BINDING_REFUSED');
  }
}

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
    !UUID_RE.test(options.userId)
  )
    throw new PhoneBindingRefusedError();
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
  } catch (error) {
    if (error instanceof StaffPhoneTakenError || error instanceof StaffPhoneBindingConflictError) {
      throw new PhoneBindingRefusedError();
    }
    throw error;
  } finally {
    await database.close();
  }
}
