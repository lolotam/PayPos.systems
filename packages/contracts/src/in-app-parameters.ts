import { z } from 'zod';

/** نص آمن للجرس: رابط أو تليفون أو رمز أو رقم من ٤ إلى ٨ خانات مرفوض. */
export const safeText = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/(?:https?:|\+[1-9]\d{7,14}|\b(?:bearer|token|otp|code)\b|\b\d{4,8}\b)/i.test(value),
  );

// Display names reject a URL, a phone and a bare 4–8 digit code, and allow a year inside a name.
const displayName = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value.trim().length > 0 &&
      !/(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu.test(
        value.trim(),
      ),
  );

/** معامل نص بيحمل اسم معروض؛ الاسم بيتحقق من قاعدته الخاصة. */
export const displayParameter = <Name extends string>(name: Name) =>
  z.strictObject({ name: z.literal(name), type: z.literal('text'), value: displayName });

/** فلتر أمان للجرس أوسع من sessionMoney الذي يمنع الصفر البادئ، لأن منتج 35d-2 يمرّر قيمًا متحققة بـ sessionMoney أصلًا. */
const bellMoney = z.string().regex(/^\d{1,11}\.\d{3}$/);

/** معامل مبلغ نصي؛ المبلغ ليس displayName لأن 1250.000 يُرفض كاسم. */
export const moneyParameter = <Name extends string>(name: Name) =>
  z.strictObject({ name: z.literal(name), type: z.literal('text'), value: bellMoney });
