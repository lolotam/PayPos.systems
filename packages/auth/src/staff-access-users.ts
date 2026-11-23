import { createStaffAccessDatabase, staffSyntheticEmail } from '@pospay/db';
import type { IdGenerator } from '@pospay/db';

/**
 * حساب الموظفة على pospay_auth (spec 076 F1، plan §4.3): الغلاف الوحيد فوق واجهة @pospay/db —
 * يفحص المدخلات قبل أي كتابة ويرفض برسائل ثابتة، ولا مسار credential هنا ولا في أي مكان آخر (D8).
 */

/** النطاق المشترك لكل مسارات التعامل: بريد الموظفة الاصطناعي على نطاق محجوز. */
export const STAFF_USER_RESERVED_DOMAIN = 'staff.pospay.invalid';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^[+][1-9][0-9]{6,14}$/;

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
  return {
    provision: async (input) => {
      if (
        !UUID.test(input.operationId) ||
        !UUID.test(input.companyId) ||
        !UUID.test(input.actorUserId) ||
        input.name.trim().length < 1 ||
        input.name.length > 255 ||
        !PHONE.test(input.phone)
      )
        throw new Error('STAFF_USER_INPUT_INVALID');
      return database.provision(input);
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

/** بريد الموظفة الاصطناعي لمعرّف عملية — للفحص في مسارات الإصدار والاختبارات فقط. */
export function staffUserEmail(operationId: string): string {
  return staffSyntheticEmail(operationId);
}
