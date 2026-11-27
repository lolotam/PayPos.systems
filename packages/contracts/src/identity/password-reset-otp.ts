import { z } from 'zod';
import { id } from '../scalars/id.js';

/** طلب كود استرجاع كلمة المرور على الإيميل (spec 079 PR-b). */
export const passwordResetOtpRequestInput = z
  .strictObject({
    email: z.email().max(254),
    locale: z.enum(['ar', 'en']),
  })
  .meta({ id: 'PasswordResetOtpRequestInput' });

/** تعيين كلمة مرور جديدة بالكود: لا جلسة بترجع، والدخول بالباسورد الجديد (+ TOTP لو مفعّل). */
export const passwordResetOtpResetInput = z
  .strictObject({
    challenge_id: id,
    code: z.string().regex(/^\d{6}$/),
    new_password: z.string().min(8).max(128),
  })
  .meta({ id: 'PasswordResetOtpResetInput' });

/** الردّ الموحّد (202): نفس الشكل لأي إيميل، موجود أو لا، موظف أو محظور. */
export const passwordResetOtpAcknowledgement = z
  .strictObject({
    status: z.literal('ACCEPTED'),
    challenge_id: id,
    expires_in: z.literal(600),
    retry_after: z.literal(60),
  })
  .meta({ id: 'PasswordResetOtpAcknowledgement' });

/** نتيجة التعيين الناجح. */
export const passwordResetOtpResult = z
  .strictObject({ status: z.literal('RESET') })
  .meta({ id: 'PasswordResetOtpResult' });

export type PasswordResetOtpRequestInput = z.infer<typeof passwordResetOtpRequestInput>;
export type PasswordResetOtpResetInput = z.infer<typeof passwordResetOtpResetInput>;
export type PasswordResetOtpAcknowledgement = z.infer<typeof passwordResetOtpAcknowledgement>;
export type PasswordResetOtpResult = z.infer<typeof passwordResetOtpResult>;
