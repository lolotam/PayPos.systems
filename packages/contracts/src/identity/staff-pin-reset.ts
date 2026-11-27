import { z } from 'zod';
import { id } from '../scalars/id.js';
import { canonicalStaffPhone } from './staff-otp.js';

/**
 * طلب كود استرجاع الرقم السري من الموظف نفسه على جهاز الفرع: القناة والمعرّف (إيميل الاستعادة أو
 * تليفون الواتساب) واللغة. شكل المعرّف بيتفحص حسب القناة، من غير ما يكشف وجود الموظف (spec 079 PR-c1).
 */
export const staffPinResetRequestInput = z
  .strictObject({
    channel: z.enum(['EMAIL', 'WHATSAPP']),
    identifier: z.string().min(3).max(254),
    locale: z.enum(['ar', 'en']),
  })
  .superRefine((value, context) => {
    const valid =
      value.channel === 'EMAIL'
        ? z.email().safeParse(value.identifier).success
        : canonicalStaffPhone.safeParse(value.identifier).success;
    if (!valid) context.addIssue({ code: 'custom', path: ['identifier'], message: 'invalid' });
  })
  .meta({ id: 'StaffPinResetRequestInput' });

/** تعيين رقم سري جديد بالكود: لا جلسة بترجع، والموظف بيدخل بالرقم الجديد بعدها. */
export const staffPinResetOtpInput = z
  .strictObject({
    challenge_id: id,
    code: z.string().regex(/^\d{6}$/),
    pin: z.string().regex(/^\d{4}$/),
  })
  .meta({ id: 'StaffPinResetOtpInput' });

/** الردّ الموحّد (202): نفس الشكل لأي معرّف، موجود أو لا، موقوف أو غير مربوط. */
export const staffPinResetAcknowledgement = z
  .strictObject({
    status: z.literal('ACCEPTED'),
    challenge_id: id,
    expires_in: z.literal(600),
    retry_after: z.literal(60),
  })
  .meta({ id: 'StaffPinResetAcknowledgement' });

/** إيميل الاستعادة الاختياري للموظف: بيتطبّع بحروف صغيرة عند الحفظ، وnull معناه «بلا إيميل». */
export const recoveryEmail = z.email().max(254).nullable().optional();

export type StaffPinResetRequestInput = z.infer<typeof staffPinResetRequestInput>;
export type StaffPinResetOtpInput = z.infer<typeof staffPinResetOtpInput>;
export type StaffPinResetAcknowledgement = z.infer<typeof staffPinResetAcknowledgement>;
