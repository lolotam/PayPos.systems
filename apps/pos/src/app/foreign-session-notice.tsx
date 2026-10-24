import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { LoadingNotice } from './loading-notice';
import { useForeignSignOut } from './use-foreign-sign-out';

// الموظفة ما ينفعش تفضل على تنبيه تحميل من غير حاجة تدوسها (#603)،
// وأي رد بعد المهلة مش موثوق، فبيتجاهل.
export const FOREIGN_SIGN_OUT_WAIT_MS = 10_000;

/** حالة الخروج من جلسة نشاط تاني: شغّال أو مرفوض. */
export type ForeignSessionOutcome = 'running' | 'failed';

/**
 * تنبيه الجلسة اللي فاضلة من نشاط تاني.
 *
 * الموظفة ما تشوفش شاشات الصالون القديم أبداً، فالجلسة بتخلص من السيرفر أول ما
 * تظهر. كل محاولة ليها مهلة؛ لو السيرفر ماردش أو الجلسة لسه مقروءة بعدها، بيظهر
 * الفشل وزر إعادة المحاولة، وأي رد متأخر بيتجاهل من غير إعادة تلقائية.
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
  const { retrying, retry } = useForeignSignOut({
    sessionKey,
    outcome,
    onOutcome,
    waitMs: FOREIGN_SIGN_OUT_WAIT_MS,
  });

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
