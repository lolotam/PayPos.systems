import { z } from 'zod';
import { responseObject } from '../response-object.js';

// CLAUDE.md §6 — كل خطأ من الـ API بنفس الشكل، والرسالة بالعربي والإنجليزي عشان الواجهتين.
export const errorEnvelope = responseObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
    details: z.unknown().optional(),
  })
  .meta({ id: 'ErrorEnvelope' });

export type ErrorEnvelope = z.infer<typeof errorEnvelope>;
