import { z } from 'zod';

import { ISO_4217_MINOR_UNITS } from '../generated/iso-4217.js';
import { TIME_ZONES } from '../generated/time-zones.js';

// UUID v7 بيتعمل على الـ client وقت الـ offline، فأي UUID صالح بيتقبل — مش v4 بس.
export const id = z.uuid();

export const timestamp = z.iso.datetime({ offset: true });

// الإنجليزي إجباري والعربي اختياري (CLAUDE.md §5)؛ الحد 255 قرار Waleed (2026-09-23).
export const nameEn = z.string().trim().min(1).max(255);
export const nameAr = z.string().trim().min(1).max(255);

// القائمتين جايين من مصدرهم الرسمي ومتخزنين في الـ package (scripts/update-reference-data.mjs)،
// مش من Intl: بيانات Intl بتختلف من runtime للتاني، فالـ API كان ممكن يقبل حاجة الـ POS يرفضها.

// اسم IANA بس (Asia/Kuwait)، مش offset زي +03:00 — الـ offset الثابت مبيتبعش قواعد التوقيت الصيفي.
// z.enum مش refine: الـ refine مبيظهرش في OpenAPI، فأي client متولّد كان هيقبل قيم الـ API بيرفضها.
export const timeZone = z.enum([...TIME_ZONES] as [string, ...string[]]).meta({ id: 'TimeZone' });

// أي كود ISO 4217 (قرار Waleed). Money في packages/domain لسه بـ 3 خانات، فالحساب صح لـ KWD بس لحد multi-currency.
export const currency = z
  .enum([...ISO_4217_MINOR_UNITS.keys()] as [string, ...string[]])
  .meta({ id: 'Currency' });
