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

export type LoginInput = z.infer<typeof loginInput>;
export type TotpCodeInput = z.infer<typeof totpCodeInput>;
export type ConfirmPasswordInput = z.infer<typeof confirmPasswordInput>;
