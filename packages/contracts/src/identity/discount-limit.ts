import { z } from 'zod';

export const discountLimitBps = z.number().int().min(0).max(10000);
export const discountLimitInput = z
  .strictObject({
    limit_bps: discountLimitBps.nullable(),
    reason: z.string().trim().min(1).max(500),
  })
  .meta({ id: 'DiscountLimitInput' });
export const discountLimit = z
  .object({ limit_bps: discountLimitBps.nullable() })
  .meta({ id: 'DiscountLimit' });
export type DiscountLimitInput = z.infer<typeof discountLimitInput>;
export type DiscountLimit = z.infer<typeof discountLimit>;

export const discountPercentage = z
  .string()
  .trim()
  .regex(/^\d{1,3}(?:\.\d{1,2})?$/)
  .transform((value) => {
    const [whole = '', fraction = ''] = value.split('.');
    return Number(`${whole}${fraction.padEnd(2, '0')}`);
  })
  .pipe(discountLimitBps);
export const discountLimitFormInput = z
  .strictObject({
    percentage: discountPercentage,
    reason: discountLimitInput.shape.reason,
  })
  .transform(({ percentage, reason }) => ({ limit_bps: percentage, reason }));
export type DiscountLimitFormValues = z.input<typeof discountLimitFormInput>;
