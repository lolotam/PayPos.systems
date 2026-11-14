import type { Locale } from '@pospay/i18n';

// تقسيم basis points لنص بيمنع أخطاء floating point من تغيير النسبة المعروضة.
export function percentText(bps: number): string {
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`;
}

// التقريب للدقيقة الكاملة اللي فوق بيمنع الطلب من إنه يبان منتهي قبل وقته الفعلي.
export function timeLeftParts(expiresAt: Date, now: Date): { hours: number; minutes: number } {
  const total = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

// غياب الاسم العربي مش لازم يخلي البطاقة بلا اسم مفهوم للمستخدمة.
export function localName(locale: Locale, ar: string | null, en: string): string {
  return locale === 'ar' && ar ? ar : en;
}
