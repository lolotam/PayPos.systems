import { z } from 'zod';

import { TIME_ZONES } from '../generated/time-zones.js';

// القائمة جاية من IANA tzdb ومتخزنة في الـ package (scripts/update-reference-data.mjs)، مش من Intl:
// بيانات Intl بتختلف من runtime للتاني، فالـ API كان ممكن يقبل حاجة الـ POS يرفضها.
// اسم IANA بس (Asia/Kuwait)، مش offset زي +03:00 — الـ offset الثابت مبيتبعش قواعد التوقيت الصيفي.
// z.enum مش refine: الـ refine مبيظهرش في OpenAPI، فأي client متولّد كان هيقبل قيم الـ API بيرفضها.
export const timeZone = z.enum([...TIME_ZONES] as [string, ...string[]]).meta({ id: 'TimeZone' });
