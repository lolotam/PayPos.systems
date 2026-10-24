import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { usePersonalSession } from '@/personal-staff/api/use-personal-session';
import { PersonalScreen } from '@/personal-staff/ui/personal-screen';

import { ForeignSessionNotice, type ForeignSessionOutcome } from './foreign-session-notice';
import type { PersonalWorkspace } from './manager-link';
import { SwitchBusinessPanel } from './switch-business-panel';

/** الجلسة الشخصية اللي الشاشة بتقراها. */
type ForeignSession = NonNullable<ReturnType<typeof usePersonalSession>['session']>;

/** خانات شاشة الموظفة: النشاط المتذكر، والنشاط الجديد، والشاشة الشخصية. */
export interface EmployeeFlowProps {
  business: PersonalWorkspace | null;
  pending: PersonalWorkspace | null;
  busy: boolean;
  connect: ReactNode;
  onConfirm: (pending: PersonalWorkspace) => void;
  onCancel: () => void;
}

/**
 * شاشة الموظفة: لوحة تبديل النشاط والشاشة الشخصية مع بعض.
 *
 * الشاشة الشخصية هي اللي بتقرا الجلسة، فالبوابة بتتبعت ليها: لو الجلسة فاتلة من
 * نشاط تاني بتعرض تنبيه بيخلّصها بدل شاشات الصالون القديم (B4a).
 */
export function EmployeeFlow({
  business,
  pending,
  busy,
  connect,
  onConfirm,
  onCancel,
}: EmployeeFlowProps) {
  // حالة كل جلسة غريبة: تعيش بعد ما التنبيه يتفك، عشان نفس الجلسة ما تاخدش
  // محاولة جديدة لو اتقرت تاني.
  const outcomes = useRef(new Map<string, ForeignSessionOutcome>());
  const [, redraw] = useState(0);
  const report = useCallback((key: string, next: ForeignSessionOutcome) => {
    outcomes.current.set(key, next);
    redraw((value) => value + 1);
  }, []);
  const sessionGate = useCallback(
    (session: ForeignSession): ReactNode | null => {
      if (business === null) return null;
      if (
        session.company_id === business.company_id &&
        session.business_id === business.business_id
      ) {
        return null;
      }
      const key = foreignSessionKey(session);
      return (
        <ForeignSessionNotice
          key={key}
          sessionKey={key}
          outcome={outcomes.current.get(key)}
          onOutcome={report}
        />
      );
    },
    [business, report],
  );
  return (
    <>
      {pending ? (
        <SwitchBusinessPanel busy={busy} onConfirm={() => onConfirm(pending)} onCancel={onCancel} />
      ) : null}
      {business ? (
        <PersonalScreen
          key={business.business_id}
          workspace={business}
          connect={connect}
          sessionGate={sessionGate}
        />
      ) : (
        <PersonalScreen connect={connect} sessionGate={sessionGate} />
      )}
    </>
  );
}

/** مفتاح الجلسة: نفس الجلسة ليها حالة واحدة ثابتة. */
function foreignSessionKey(session: ForeignSession): string {
  return `${session.company_id}:${session.business_id}:${session.user_id}:${session.expires_at}`;
}
