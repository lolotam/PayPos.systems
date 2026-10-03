'use client';

import { t } from '@pospay/i18n';
import { BrandedPanel } from '@pospay/ui';

import { AppFrame } from '@/shared/frame/app-frame';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';

import { useEnrolTotp } from '../api/use-enrol-totp';
import { EnrolStep } from '../ui/enrol-step';
import { SignOutButton } from '../ui/sign-out-button';

export function EnrolPage() {
  const locale = useLocale();
  const enrol = useEnrolTotp();
  const lead =
    enrol.step.kind === 'done'
      ? t(locale, 'admin.enrolDone')
      : enrol.step.kind === 'verify'
        ? t(locale, 'admin.enrolVerifyLead')
        : t(locale, 'admin.enrolPasswordLead');
  return (
    <AppFrame
      brand={t(locale, 'admin.appName')}
      actions={
        <>
          <LocaleSwitch />
          <SignOutButton />
        </>
      }
    >
      <BrandedPanel
        brandTitle={t(locale, 'brand.title')}
        title={t(locale, 'admin.enrolTitle')}
        description={t(locale, 'admin.enrolLead')}
      >
        <p className="mb-6 text-start text-sm">{lead}</p>
        <EnrolStep enrol={enrol} />
      </BrandedPanel>
    </AppFrame>
  );
}
