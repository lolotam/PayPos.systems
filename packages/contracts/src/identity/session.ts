import { z } from 'zod';

// شكل إدخال شاشات الدخول والـ TOTP. الـ endpoints بتاعة Better Auth مش جزء من OpenAPI.

export const loginInput = z
  .object({
    email: z.email(),
    password: z.string().min(1),
  })
  .strict();

export const totpCodeInput = z
  .object({
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export const confirmPasswordInput = z
  .object({
    password: z.string().min(1),
  })
  .strict();

// حدود الطول هي الافتراضية في Better Auth (8–128)؛ config.ts مش بيعدّلها فده هو العقد الفعلي.
// عدم التطابق بيرجع على مسار confirm عشان الرسالة تظهر جنب حقل التأكيد مش كخطأ عام.
export const setPasswordInput = z
  .object({
    password: z.string().min(8).max(128),
    confirm: z.string().min(1),
  })
  .strict()
  .refine((input) => input.password === input.confirm, { path: ['confirm'] });

export type LoginInput = z.infer<typeof loginInput>;
export type TotpCodeInput = z.infer<typeof totpCodeInput>;
export type ConfirmPasswordInput = z.infer<typeof confirmPasswordInput>;
export type SetPasswordInput = z.infer<typeof setPasswordInput>;
