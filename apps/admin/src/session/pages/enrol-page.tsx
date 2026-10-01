'use client';

import { t } from '@pospay/i18n';

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
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <h1 className="text-start text-xl font-bold">{t(locale, 'admin.enrolTitle')}</h1>
        <p className="text-start text-sm text-muted-foreground">{t(locale, 'admin.enrolLead')}</p>
        <p className="text-start text-sm">{lead}</p>
        <EnrolStep enrol={enrol} />
      </div>
    </AppFrame>
  );
}
