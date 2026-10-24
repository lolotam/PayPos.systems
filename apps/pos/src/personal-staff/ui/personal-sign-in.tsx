import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { usePersonalSignIn } from '../api/use-personal-sign-in';
import { PersonalPhoneForm } from './personal-phone-form';
import { PersonalCodeForm } from './personal-code-form';

export function PersonalSignIn({
  workspace,
  changed,
  startOver,
}: {
  workspace: { company_id: string; business_id: string };
  changed: () => void;
  startOver?: ReactNode;
}) {
  const locale = useLocale();
  const state = usePersonalSignIn(workspace, changed);
  // أثناء الطلب، رد متأخر ممكن يفتح جلسة بعد الرجوع ومسح الدور.
  return (
    <div className="grid gap-6">
      {state.challenge === null ? (
        <PersonalPhoneForm pending={state.pending} onSubmit={state.request} />
      ) : (
        <PersonalCodeForm key={state.challenge} pending={state.pending} onSubmit={state.verify} />
      )}
      {state.error !== null ? <p role="alert">{t(locale, state.error)}</p> : null}
      {state.challenge !== null ? (
        <Button variant="outline" size="touch" disabled={state.pending} onClick={state.restart}>
          {t(locale, 'personalStaff.retry')}
        </Button>
      ) : null}
      {state.pending ? null : startOver}
    </div>
  );
}
