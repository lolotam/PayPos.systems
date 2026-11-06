import { z } from 'zod';

export const personalBranches = z.strictObject({
  items: z.array(
    z.strictObject({
      id: z.uuid(),
      name_ar: z.string().nullable(),
      name_en: z.string(),
      timezone: z.string(),
    }),
  ),
});
export type PersonalBranches = z.infer<typeof personalBranches>;
