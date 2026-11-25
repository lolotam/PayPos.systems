import { z } from 'zod';
import { canonicalStaffPhone } from '../identity/staff-otp.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

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

/** حالة دخول الموظفة كما تظهر في لوحة الموظفين؛ آخر ثلاثة أرقام فقط ولا هاتف كامل أبداً. */
export const staffAccessState = responseObject({
  state: z.enum(['NONE', 'PENDING', 'ACTIVE', 'STOPPED']),
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
