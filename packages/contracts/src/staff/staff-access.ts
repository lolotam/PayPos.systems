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

/** حالة دخول الموظفة كما تظهر في لوحة الموظفين؛ آخر ثلاثة أرقام فقط ولا هاتف كامل أبداً. */
export const staffAccessState = responseObject({
    state: z.enum(['NONE', 'PENDING', 'ACTIVE', 'STOPPED']),
    role: z.enum(['staff', 'reception']).nullable(),
    branch_id: id.nullable(),
    phone_last3: z.string().regex(/^\d{3}$/).nullable(),
    can_manage: z.boolean(),
  })
  .meta({ id: 'StaffAccessState' });
export type StaffAccessState = z.infer<typeof staffAccessState>;
