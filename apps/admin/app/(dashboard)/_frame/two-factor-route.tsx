'use client';

import { t } from '@pospay/i18n';
import { BrandedPanel } from '@pospay/ui';

import { useEnrolTotp } from '@/session/api/use-enrol-totp';
import { EnrolStep } from '@/session/ui/enrol-step';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * صفحة المصادقة (تطبيق المصادقة) داخل الإطار. بوابة الجلسة (إعادة التوجيه إلى الدخول وشاشة تعذّر القراءة)
 * تتولاها بوابة الصفحة الخادمية `two-factor-gate.tsx` لأن تخطيط اللوحة لا يُعاد رسمه عند تنقّل العميل، فلا تُقرأ الجلسة مرتين؛ والرأس والخروج واللغة من الإطار نفسه.
 */
export function TwoFactorRoute() {
  const locale = useLocale();
  const enrol = useEnrolTotp();
  const lead =
    enrol.step.kind === 'done'
      ? t(locale, 'admin.enrolDone')
      : enrol.step.kind === 'verify'
        ? t(locale, 'admin.enrolVerifyLead')
        : t(locale, 'admin.enrolPasswordLead');
  return (
    <BrandedPanel
      brandTitle={t(locale, 'brand.title')}
      title={t(locale, 'admin.enrolTitle')}
      description={t(locale, 'admin.enrolLead')}
    >
      <p className="mb-6 text-start text-sm">{lead}</p>
      <EnrolStep enrol={enrol} />
    </BrandedPanel>
  );
}
