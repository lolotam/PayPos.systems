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
  locked = false,
}: {
  workspace: { company_id: string; business_id: string };
  changed: () => void;
  startOver?: ReactNode;
  locked?: boolean;
}) {
  const locale = useLocale();
  const state = usePersonalSignIn(workspace, changed);
  // أثناء الطلب، رد متأخر ممكن يفتح جلسة بعد الرجوع ومسح الدور.
  // وأثناء الرجوع لاختيار نوع الجهاز، تسجيل جديد هيفتح جلسة خطوة الرجوع مش قادرة تنهيها.
  return (
    <div className="grid gap-6">
      {state.challenge === null ? (
        <PersonalPhoneForm pending={state.pending || locked} onSubmit={state.request} />
      ) : (
        <PersonalCodeForm
          key={state.challenge}
          pending={state.pending || locked}
          onSubmit={state.verify}
        />
      )}
      {state.error !== null ? <p role="alert">{t(locale, state.error)}</p> : null}
      {state.challenge !== null ? (
        <Button
          variant="outline"
          size="touch"
          disabled={state.pending || locked}
          onClick={state.restart}
        >
          {t(locale, 'personalStaff.retry')}
        </Button>
      ) : null}
      {state.pending ? null : startOver}
    </div>
  );
}
