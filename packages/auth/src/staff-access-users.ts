import { createStaffAccessDatabase, StaffPhoneTakenError } from '@pospay/db';
import type { IdGenerator } from '@pospay/db';

/**
 * حساب الموظفة على pospay_auth (spec 076 F1، plan §4.3): الغلاف الوحيد فوق واجهة @pospay/db —
 * يفحص المدخلات قبل أي كتابة ويرفض برسائل ثابتة، ولا مسار credential هنا ولا في أي مكان آخر (D8).
 */

/**
 * النطاق المحجوز لبريد حساب الموظفة الاصطناعي — القيمة الثابتة المشتركة مع PR G1 (spec 076).
 * البريد الكامل: `staff-<operation_id>@staff.pospay.invalid` — غير قابل للتسليم ولا يُشتق من الهاتف.
 */
export const STAFF_SYNTHETIC_EMAIL_DOMAIN = 'staff.pospay.invalid';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// نفس عقد `canonicalStaffPhone` (8–15 رقمًا بعد الـ +) — المدخل الأشد قبل أي كتابة.
const PHONE = /^[+][1-9][0-9]{7,14}$/;

/** بريد حساب الموظفة الاصطناعي لمعرّف عملية — المصدر الوحيد للصيغة في النظام كله. */
export function staffSyntheticEmail(operationId: string): string {
  return `staff-${operationId}@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`;
}

/** مدخل الإنشاء أو الإيجاد كما يأتي من identity. */
export interface StaffUserProvisionRequest {
  readonly operationId: string;
  readonly companyId: string;
  readonly phone: string;
  readonly name: string;
  readonly actorUserId: string;
  readonly ids: IdGenerator;
}

/** الواجهة التي يراها identity: الإنشاء والإيجاد والإلغاء والقراءة بلا أي مسار credential. */
export interface StaffUserAccess {
  provision(input: StaffUserProvisionRequest): Promise<{ userId: string }>;
  cancel(input: {
    operationId: string;
    companyId: string;
    actorUserId: string;
    ids: IdGenerator;
  }): Promise<void>;
  read(operationId: string): Promise<{ userId: string; phoneLast3: string | null } | null>;
  /** هل المستخدم حساب موظفة؟ يُفحص قبل إصدار أي مسار تعامل (D8). */
  isStaffUser(userId: string): Promise<boolean>;
  /** يغلق اتصال pospay_auth المملوك للواجهة. */
  close(): Promise<void>;
}

/**
 * يبني واجهة حساب الموظفة فوق قاعدة pospay_auth؛ الاتصال واحد ويُغلق معه.
 *
 * @param options الاتصال بـ AUTH_DATABASE_URL ومفتاح قفل الهاتف ومولّد المعرّفات
 * @returns الواجهة الأربعية مع الإغلاق
 */
export function createStaffUserAccess(options: {
  databaseUrl: string;
  phoneLockKey: (hash: Uint8Array) => bigint;
  ids: IdGenerator;
}): StaffUserAccess & { close(): Promise<void> } {
  const database = createStaffAccessDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.phoneLockKey,
  });
  // غلاف الـ runtime الطارئ يلف كل الأخطاء بكود ثابت؛ الرفض المتوقع يعود هنا فئةً حقيقية.
  const unwrapPhoneTaken = (error: unknown): unknown => {
    const message = error instanceof Error ? error.message : '';
    return message === 'OTP_DATABASE_UNAVAILABLE_STAFF_PHONE_TAKEN'
      ? new StaffPhoneTakenError()
      : error;
  };
  return {
    provision: async (input) => {
      const email = staffSyntheticEmail(input.operationId);
      if (
        !UUID.test(input.operationId) ||
        !UUID.test(input.companyId) ||
        !UUID.test(input.actorUserId) ||
        input.name.trim().length < 1 ||
        input.name.length > 255 ||
        !PHONE.test(input.phone)
      )
        throw new Error('STAFF_USER_INPUT_INVALID');
      return database.provision({ ...input, email }).catch((error) => {
        throw unwrapPhoneTaken(error);
      });
    },
    cancel: async (input) => {
      if (!UUID.test(input.operationId) || !UUID.test(input.companyId))
        throw new Error('STAFF_USER_INPUT_INVALID');
      return database.cancel(input);
    },
    read: (operationId) => database.read(operationId),
    isStaffUser: async (userId) => {
      if (!UUID.test(userId)) return false;
      const found = await database.byUserId(userId);
      return found?.staff === true;
    },
    close: () => database.close(),
  };
}
