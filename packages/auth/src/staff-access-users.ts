import { createStaffAccessDatabase, StaffPhoneTakenError } from '@pospay/db';
import type { BetterAuthOptions } from 'better-auth';
import type { IdGenerator } from '@pospay/db';

/**
 * حساب الموظفة على pospay_auth (spec 076 F1، plan §4.3): الغلاف الوحيد فوق واجهة @pospay/db —
 * يبني البريد الاصطناعي من النطاق المحجوز، ويفكّ أغلفة الرفض المتوقعة، ولا مسار credential
 * هنا ولا في أي مكان آخر (D8). التحقق النهائي للمدخلات في طبقة قاعدة البيانات نفسها.
 */

/**
 * النطاق المحجوز لبريد حساب الموظفة الاصطناعي — القيمة الثابتة المشتركة مع PR G1 (spec 076).
 * البريد الكامل: `staff-<operation_id>@staff.pospay.invalid` — غير قابل للتسليم ولا يُشتق من الهاتف.
 */
export const STAFF_SYNTHETIC_EMAIL_DOMAIN = 'staff.pospay.invalid';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** بريد حساب الموظفة الاصطناعي لمعرّف عملية — المصدر الوحيد للصيغة في النظام كله. */
export function staffSyntheticEmail(operationId: string): string {
  return `staff-${operationId}@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`;
}

/** مدخل الإنشاء أو الإيجاد كما يأتي من identity. */
export interface StaffUserProvisionRequest {
  /** معرّف العملية من سجل الدخول. */
  readonly operationId: string;
  /** الشركة. */
  readonly companyId: string;
  /** الهاتف الكانوني. */
  readonly phone: string;
  /** اسم الموظفة. */
  readonly name: string;
  /** المانح المؤكِّد للهاتف. */
  readonly actorUserId: string;
  /** مولّد UUID v7. */
  readonly ids: IdGenerator;
  /** حالة سجل الدخول المقروءة تحت القفل — الإنشاء لسجل `PENDING` فقط (P1-2). */
  readonly recordState: 'PENDING' | 'CANCELLING';
  /** إعادة تثبيت ربط الهاتف عند استئناف سجل `STOPPED`. */
  readonly resetBinding: boolean;
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
  /**
   * شركة حساب الموظفة أو null — exclusivity الشركة تُفحص قبل كل كتابة عضوية (P1-5).
   *
   * @param userId المستخدم
   */
  staffCompanyOf(userId: string): Promise<string | null>;
  /**
   * ربط المستخدم بمعرّف العملية: يُرد معرف المستخدم وشركته أو null — إثبات المنح الوحيد المقبول.
   *
   * @param operationId معرّف العملية
   */
  bindingOf(operationId: string): Promise<{ userId: string; companyId: string | null } | null>;
  /**
   * مستخدم رابط token استهلاك كلمة السر أو null — بوابة الاستهلاك قبل Better Auth (P1-6).
   *
   * @param token token الاستهلاك
   */
  userIdForResetToken(token: string): Promise<string | null>;
  /** يغلق اتصال pospay_auth المملوك للواجهة. */
  close(): Promise<void>;
}

/**
 * يبني واجهة حساب الموظفة فوق قاعدة pospay_auth؛ الاتصال واحد ويُغلق معه.
 *
 * @param options الاتصال بـ AUTH_DATABASE_URL ومفتاح قفل الهاتف
 * @returns الواجهة مع الإغلاق
 */
export function createStaffUserAccess(options: {
  databaseUrl: string;
  phoneLockKey: (hash: Uint8Array) => bigint;
}): StaffUserAccess & { close(): Promise<void> } {
  const database = createStaffAccessDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.phoneLockKey,
  });
  // غلاف الـ runtime الطارئ يلف كل الأخطاء بكود ثابت؛ الرفض المتوقع يعود هنا فئةً حقيقية.
  const unwrapKnown = (error: unknown): unknown => {
    const message = error instanceof Error ? error.message : '';
    if (message === 'OTP_DATABASE_UNAVAILABLE_STAFF_PHONE_TAKEN') return new StaffPhoneTakenError();
    return error;
  };
  return {
    provision: async (input) => {
      return database
        .provision({
          ...input,
          email: staffSyntheticEmail(input.operationId),
          actorUserId: input.actorUserId,
        })
        .catch((error) => {
          throw unwrapKnown(error);
        });
    },
    cancel: async (input) => database.cancel(input),
    read: (operationId) => database.read(operationId),
    isStaffUser: async (userId) => {
      if (!UUID.test(userId)) return false;
      const found = await database.byUserId(userId);
      return found?.staff === true;
    },
    staffCompanyOf: async (userId) => {
      if (!UUID.test(userId)) return null;
      const found = await database.byUserId(userId);
      return found === null || !found.staff ? null : (found.companyId ?? null);
    },
    bindingOf: (operationId) => database.bindingOf(operationId),
    userIdForResetToken: (token) => database.userIdForResetToken(token),
    close: () => database.close(),
  };
}

/**
 * D8 (spec 076): حساب الموظفة مقفول على كل مسار تعامل — لا account يتعمل ولا يتغير، ولا جلسة
 * عادية (بلا purpose) تتعمل له. جلسات STAFF_POS/STAFF_PERSONAL بتيجي من internalAdapter مباشرة.
 * تحديث الحساب الذي لا يحمل userId محمي في staffCredentialAdapter بفلتر الهدف الحقيقي؛
 * الخطاف هنا يحمي إنشاء الحساب وإصدار الجلسة وأي نقل حساب إلى مستخدم موظفة.
 */
export function staffUserD8Hooks(
  staffUsers: StaffUserAccess,
): NonNullable<BetterAuthOptions['databaseHooks']> {
  return {
    account: {
      create: {
        before: async (data) => {
          if (await staffUsers.isStaffUser(String(data.userId)))
            throw new Error('STAFF_USER_CREDENTIAL_REFUSED');
          return { data };
        },
      },
      update: {
        before: async (data) => {
          if (data.userId !== undefined && (await staffUsers.isStaffUser(String(data.userId))))
            throw new Error('STAFF_USER_CREDENTIAL_REFUSED');
          return { data };
        },
      },
    },
    session: {
      create: {
        before: async (data) => {
          const purpose = (data as { purpose?: string | null }).purpose ?? null;
          if (purpose === null && (await staffUsers.isStaffUser(String(data.userId))))
            throw new Error('STAFF_USER_SESSION_REFUSED');
          return { data };
        },
      },
    },
  };
}
