import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ReactNode } from 'react';

import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { useLocale } from '@/shared/locale/locale-context';

import { LoadingNotice } from './loading-notice';
import type { PersonalWorkspace } from './manager-link';
import { SwitchBusinessPanel } from './switch-business-panel';
import { useSessionMismatch } from './use-session-mismatch';

/**
 * شاشة الموظفة: لوحة تبديل النشاط والشاشة الشخصية مع بعض.
 *
 * الشاشة الشخصية بتعرض أي جلسة السيرفر بيرجّعها، فالجلسة اللي فاضلة من نشاط تاني
 * لازم تخلص الأول — عشان الموظفة ما تشوفش شاشات الصالون القديم (B4a).
 */
export function EmployeeFlow({
  business,
  pending,
  busy,
  connect,
  onConfirm,
  onCancel,
}: {
  business: PersonalWorkspace | null;
  pending: PersonalWorkspace | null;
  busy: boolean;
  connect: ReactNode;
  onConfirm: (pending: PersonalWorkspace) => void;
  onCancel: () => void;
}) {
  const locale = useLocale();
  const mismatch = useSessionMismatch(business);
  const body = mismatch.mismatched ? (
    mismatch.failed ? (
      <div className="mx-auto mt-4 grid w-full max-w-md gap-3">
        <p role="alert" className="bg-destructive/10 px-4 py-3 text-center text-destructive">
          {t(locale, 'nativeShell.roleChangeFailed')}
        </p>
        <Button onClick={mismatch.retry}>{t(locale, 'nativeShell.retry')}</Button>
      </div>
    ) : (
      <LoadingNotice />
    )
  ) : business ? (
    <PersonalScreen key={business.business_id} workspace={business} connect={connect} />
  ) : (
    <PersonalScreen connect={connect} />
  );
  return (
    <>
      {pending ? (
        <SwitchBusinessPanel busy={busy} onConfirm={() => onConfirm(pending)} onCancel={onCancel} />
      ) : null}
      {body}
    </>
  );
}
