import { personalWorkspace, type PersonalOtpRequestInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';

import { AppFrame } from '@/shared/frame/app-frame';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';
import { usePersonalSession } from '../api/use-personal-session';
import { PersonalSignIn } from './personal-sign-in';
import { EnrolPasskeyScreen } from './enrol-passkey-screen';

/** الرجوع اختياري عشان صفحة الويب المشتركة تفضل من غير أي تحكم جديد. */
export function PersonalScreen({
  workspace,
  connect,
  sessionGate,
  startOver,
  locked,
}: {
  workspace?: Pick<PersonalOtpRequestInput, 'company_id' | 'business_id'>;
  connect?: ReactNode;
  startOver?: ReactNode;
  locked?: boolean;
  sessionGate?: (
    session: NonNullable<ReturnType<typeof usePersonalSession>['session']>,
  ) => ReactNode | null;
}) {
  const locale = useLocale();
  const state = usePersonalSession();
  const params = new URLSearchParams(window.location.search);
  const fromQuery = personalWorkspace.safeParse({
    company_id: params.get('company'),
    business_id: params.get('business'),
  });
  // نسخة التطبيق بتبعت النشاط المتذكر من غير query string؛ نسخة الويب بتفضل تقرأه من العنوان.
  const hint = workspace ?? (fromQuery.success ? fromQuery.data : undefined);
  // نسخة التطبيق بس بتبعت الرجوع، وبيظهر بعد ما السيرفر يأكد إن مفيش جلسة.
  return (
    <AppFrame brand={t(locale, 'pos.appName')} actions={<LocaleSwitch />}>
      <section className="mx-auto grid w-full max-w-md gap-6">
        <h1 className="text-2xl font-semibold">{t(locale, 'personalStaff.title')}</h1>
        <p>{t(locale, 'personalStaff.lead')}</p>
        {!state.online ? (
          <p role="status">{t(locale, 'personalStaff.offline')}</p>
        ) : state.loading ? (
          <p role="status">{t(locale, 'personalStaff.loading')}</p>
        ) : state.session ? (
          (sessionGate?.(state.session) ?? (
            <EnrolPasskeyScreen
              key={`${state.epoch}:${state.session.employee_id}`}
              employeeId={state.session.employee_id}
              companyId={state.session.company_id}
              onSignOut={state.signOut}
            />
          ))
        ) : hint ? (
          <PersonalSignIn
            key={state.epoch}
            workspace={hint}
            changed={state.changed}
            startOver={state.confirmedNoSession ? startOver : undefined}
            locked={locked}
          />
        ) : (
          <>
            <p>{t(locale, 'personalStaff.linkRequired')}</p>
            {connect}
            {state.confirmedNoSession ? startOver : null}
          </>
        )}
      </section>
    </AppFrame>
  );
}
