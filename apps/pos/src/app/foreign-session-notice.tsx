import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef, useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import { endPersonalSession } from './end-sessions';
import { LoadingNotice } from './loading-notice';

/** حالة الخروج من جلسة نشاط تاني: شغّال أو مرفوض. */
export type ForeignSessionOutcome = 'running' | 'failed';

/**
 * تنبيه الجلسة اللي فاضلة من نشاط تاني.
 *
 * الموظفة ما تشوفش شاشات الصالون القديم أبداً، فالجلسة بتخلص من السيرفر أول ما
 * تظهر؛ ولو الخروج اترفض، الموظفة هي اللي تقرر تعيد المحاولة — من غير تلقاء.
 */
export function ForeignSessionNotice({
  sessionKey,
  outcome,
  onOutcome,
}: {
  sessionKey: string;
  outcome: ForeignSessionOutcome | undefined;
  onOutcome: (key: string, next: ForeignSessionOutcome) => void;
}) {
  const locale = useLocale();
  const started = useRef(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // الجلسة دي اتجرّبت قبل كده: من غير حلقة مفرغة، واللي يقدر يعيد المحاولة هو الموظفة.
    if (outcome !== undefined || started.current) return;
    started.current = true;
    onOutcome(sessionKey, 'running');
    void endPersonalSession().then((result) => {
      onOutcome(sessionKey, result === 'failed' ? 'failed' : 'running');
    });
  }, [outcome, onOutcome, sessionKey]);

  const retry = () => {
    setRetrying(true);
    onOutcome(sessionKey, 'running');
    void endPersonalSession().then((result) => {
      setRetrying(false);
      onOutcome(sessionKey, result === 'failed' ? 'failed' : 'running');
    });
  };

  if (outcome !== 'failed' && !retrying) return <LoadingNotice />;
  return (
    <div className="mx-auto mt-4 grid w-full max-w-md gap-3">
      <p role="alert" className="bg-destructive/10 px-4 py-3 text-center text-destructive">
        {t(locale, 'nativeShell.roleChangeFailed')}
      </p>
      <Button disabled={retrying} onClick={retry}>
        {t(locale, 'nativeShell.retry')}
      </Button>
    </div>
  );
}
