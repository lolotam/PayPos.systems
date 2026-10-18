import { z } from 'zod';
import { responseObject } from '../response-object.js';

// الاسم جزء من رد الحضور، فالمفتاح الزيادة يتشال بدل ما يسقط اللوحة المفتوحة (ADR-0047).
export const attendanceActorName = responseObject({
  ar: z.string().nullable(),
  en: z.string(),
}).nullable();
