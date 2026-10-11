import { z } from 'zod';

export const attendanceActorName = z
  .strictObject({ ar: z.string().nullable(), en: z.string() })
  .nullable();
