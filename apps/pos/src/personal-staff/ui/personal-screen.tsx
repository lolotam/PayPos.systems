import { personalWorkspace } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { AppFrame } from '@/shared/frame/app-frame';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';
import { usePersonalSession } from '../api/use-personal-session';
import { PersonalSignIn } from './personal-sign-in';
import { EnrolPasskeyScreen } from './enrol-passkey-screen';

export function PersonalScreen() {
  const locale = useLocale();
  const state = usePersonalSession();
  const params = new URLSearchParams(window.location.search);
  const workspace = personalWorkspace.safeParse({
    company_id: params.get('company'),
    business_id: params.get('business'),
  });
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
          <EnrolPasskeyScreen
            key={`${state.epoch}:${state.session.employee_id}`}
            employeeId={state.session.employee_id}
            onSignOut={state.signOut}
          />
        ) : workspace.success ? (
          <PersonalSignIn key={state.epoch} workspace={workspace.data} changed={state.changed} />
        ) : (
          <p>{t(locale, 'personalStaff.linkRequired')}</p>
        )}
      </section>
    </AppFrame>
  );
}
