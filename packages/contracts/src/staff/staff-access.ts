import { z } from 'zod';
import { permissionOverrideInput } from '../identity/permissions.js';
import { canonicalStaffPhone } from '../identity/staff-otp.js';
import { recoveryEmail } from '../identity/staff-pin-reset.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

/** فرع إضافي ودوره عند منح دخول الموظفة (080-b). */
export const staffAccessBranchAssignment = z
  .strictObject({
    branch_id: id,
    role: z.enum(['staff', 'reception']),
  })
  .meta({ id: 'StaffAccessBranchAssignment' });
export type StaffAccessBranchAssignment = z.infer<typeof staffAccessBranchAssignment>;

/**
 * صلاحيات كل دور من دوري «إعطاء الدخول» الافتراضية — نفس مصفوفة `ROLE_DEFAULTS` في packages/db
 * لدوري `staff` و`cashier` (080-b). الشاشة بتستخدمها علامة «افتراضي» على كل صلاحية الموظفة
 * عندها من غير استثناء، والاختبار في packages/db بيمنع أي انحراف عن المصدر.
 */
export const STAFF_ACCESS_ROLE_DEFAULTS = {
  staff: [
    'read:service-sessions:own',
    'read:commissions:own',
    'read:attendance:own',
    'read:ratings:own',
    'create:leave:own',
    'read:leave:own',
    'cancel:leave:own',
    'read:branches:branch',
    'login:staff:branch',
  ],
  reception: [
    'read:service-sessions:own',
    'read:commissions:own',
    'read:attendance:own',
    'read:ratings:own',
    'create:leave:own',
    'read:leave:own',
    'cancel:leave:own',
    'read:branches:branch',
    'login:staff:branch',
    'record:service-sessions:branch',
    'sell:packages:branch',
    'create:customers:branch',
    'clock:attendance:branch',
  ],
} as const;

/** دور «إعطاء الدخول» اللي ليه قائمة صلاحيات افتراضية معروفة. */
export type StaffAccessRoleDefaultsKey = keyof typeof STAFF_ACCESS_ROLE_DEFAULTS;

/**
 * إعطاء دخول موظفة (spec 076 F1): الطلب strict ودوره اختيار من اتنين بس —
 * الدور والنطاق الفعليين بيتحددوا في السيرفر من جدول identity وموظفة لا من الجسم.
 */
export const grantStaffAccessInput = z
  .object({
    phone: canonicalStaffPhone,
    phone_confirmed: z.literal(true),
    role: z.enum(['staff', 'reception']),
    pin: z.string().regex(/^\d{4}$/),
    // إيميل الاستعادة الاختياري: لو اتبعت بيتسجل على الموظفة في نفس العملية (spec 079 PR-c1).
    recovery_email: recoveryEmail,
    // فروع زيادة للموظفة، كل فرع بدوره (080-b): كل واحد منهم عضوية مستقلة على نفس الدخول.
    additional_branches: z.array(staffAccessBranchAssignment).max(20).optional(),
    // استثناءات صلاحيات مضمّنة تُكتب مع العضويات في نفس المعاملة (080-b).
    permission_overrides: z.array(permissionOverrideInput).max(20).optional(),
  })
  .strict()
  .meta({ id: 'GrantStaffAccessInput' });
export type GrantStaffAccessInput = z.infer<typeof grantStaffAccessInput>;

/**
 * إعادة ضبط الرقم السري لموظفة على فرعها الأساسي (spec 076 F2b): الطلب strict —
 * رقم سري من أربعة أرقام بس، وما فيش أي رقم تاني (الرقم القديم ما بيرجعش من السيرفر).
 */
export const resetEmployeeStaffPinInput = z
  .object({
    pin: z.string().regex(/^\d{4}$/),
  })
  .strict()
  .meta({ id: 'ResetEmployeeStaffPinInput' });
export type ResetEmployeeStaffPinInput = z.infer<typeof resetEmployeeStaffPinInput>;

/**
 * تغيير هاتف موظفة لها دخول فعّال (spec 076 F3-1): الهاتف الجديد كانوني ومُقَرّ بالتأكيد، والرقم
 * السري الجديد مؤقت من أربعة أرقام — الطلب strict ولا يقبل دوراً ولا فرعاً ولا شيئاً غيرهم.
 */
export const changeEmployeeStaffPhoneInput = z
  .object({
    phone: canonicalStaffPhone,
    phone_confirmed: z.literal(true),
    pin: z.string().regex(/^\d{4}$/),
  })
  .strict()
  .meta({ id: 'ChangeEmployeeStaffPhoneInput' });
export type ChangeEmployeeStaffPhoneInput = z.infer<typeof changeEmployeeStaffPhoneInput>;

/** حالة دخول الموظفة كما تظهر في لوحة الموظفين؛ آخر ثلاثة أرقام فقط ولا هاتف كامل أبداً. */
export const staffAccessState = responseObject({
  state: z.enum(['NONE', 'PENDING', 'ACTIVE', 'PHONE_CHANGING', 'STOPPED']),
  role: z.enum(['staff', 'reception']).nullable(),
  branch_id: id.nullable(),
  phone_last3: z
    .string()
    .regex(/^\d{3}$/)
    .nullable(),
  can_manage: z.boolean(),
  /** صلاحية إلغاء السجل المعلّق: المانح الأصلي أو مالك الشركة، وبعد 24 ساعة من بداية المحاولة. */
  can_cancel: z.boolean(),
}).meta({ id: 'StaffAccessState' });
export type StaffAccessState = z.infer<typeof staffAccessState>;

/** صف سجل دخول الموظفة كما تقرأه شاشة اللوحة — بلا هاتف كامل ولا بريد ولا أي hash. */
export interface StaffAccessStateRow {
  readonly branchId: string;
  readonly linkedUserId: string | null;
  readonly record: null | {
    readonly state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING' | 'CANCELLING';
    readonly roleCode: 'staff' | 'reception';
    readonly branchId: string;
    readonly operationId: string;
    readonly userId: string | null;
    /** المانح الأصلي — هو وحده أو مالك الشركة يقدران يلغيان السجل المعلّق. */
    readonly grantedBy: string;
    /** لحظة بداية محاولة المنح الحالية — منها تُقاس مهلة الإلغاء. */
    readonly attemptStartedAt: Date;
    /** لحظة القراءة من ساعة القاعدة — المرجع الوحيد لعمر المحاولة. */
    readonly now: Date;
  };
}
