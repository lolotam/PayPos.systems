import { t } from '@pospay/i18n';
import { Card } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import { useCardClock } from '../api/use-card-clock';
import { ClockByCardForm } from './clock-by-card-form';
import { ClockByCardResult } from './clock-by-card-result';

/** شاشة استقبال الكارت على الجهاز المثبّت: الماسح يكتب الكود ثم Enter، والمسح online-only. */
export function ClockByCardScreen({ onRejected }: { onRejected?: () => Promise<void> }) {
  const locale = useLocale();
  const state = useCardClock(onRejected);
  return (
    <Card className="flex min-w-0 flex-col gap-4 p-6">
      <h2 className="text-xl font-bold">{t(locale, 'pos.cardTitle')}</h2>
      <p className="text-base text-muted-foreground">{t(locale, 'pos.cardLead')}</p>
      <ClockByCardForm
        code={state.code}
        online={state.online}
        pending={state.pending || state.outcome?.kind === 'signed-out'}
        onChange={state.setCode}
        onSubmit={state.submit}
      />
      {state.pending ? <p role="status">{t(locale, 'personalAttendance.pending')}</p> : null}
      {state.outcome ? <ClockByCardResult outcome={state.outcome} /> : null}
    </Card>
  );
}
