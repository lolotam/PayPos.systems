import { z } from 'zod';

// UUID v7 بيتعمل على الـ client وقت الـ offline، فأي UUID صالح بيتقبل — مش v4 بس.
export const id = z.uuid();

export const timestamp = z.iso.datetime({ offset: true });

// الإنجليزي إجباري والعربي اختياري (CLAUDE.md §5)؛ الحد 255 قرار Waleed (2026-09-23).
export const nameEn = z.string().trim().min(1).max(255);
export const nameAr = z.string().trim().min(1).max(255);

// اسم IANA بس (Asia/Kuwait)، مش offset زي +03:00 — الـ offset الثابت مبيتبعش قواعد التوقيت الصيفي.
// بعد كده بنتحقق بالـ Intl نفسه بدل قائمة ثابتة، فالـ API والـ POS بيقبلوا نفس المناطق.
export const timeZone = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Unknown IANA time zone' },
  );

// أي كود ISO 4217 (قرار Waleed). Money في packages/domain لسه بـ 3 خانات، فالحساب صح لـ KWD بس لحد multi-currency.
export const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((code) => Intl.supportedValuesOf('currency').includes(code), {
    message: 'Unknown ISO 4217 currency code',
  });
