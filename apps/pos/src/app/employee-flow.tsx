import { personalLeave } from './personal-leave';
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
  /** قراءة النشاط المتذكر فشلت: الشاشات الخاصة بتفضل مخفية والجلسة الحية ما بتتخرجش. */
  businessUnreadable?: boolean;
  pending: PersonalWorkspace | null;
  busy: boolean;
  connect: ReactNode;
  /** تنبيه الشاشة: بينزل جوه إطار الشاشة الشخصية مش فوق الشاشة كلها. */
  notice?: ReactNode;
  startOver?: ReactNode;
  onConfirm: (pending: PersonalWorkspace) => void;
  onCancel: () => void;
}

/**
 * شاشة الموظفة: لوحة تبديل النشاط والشاشة الشخصية مع بعض.
 * الرجوع لاختيار نوع الجهاز بيتمرر للشاشة الشخصية وهي اللي بتحصره في حالة عدم وجود جلسة.
 *
 * الشاشة الشخصية هي اللي بتقرا الجلسة، فالبوابة بتتبعت ليها: لو الجلسة فاضلة من
 * نشاط تاني بتعرض تنبيه بيخلّصها بدل شاشات الصالون القديم (FR-012).
 *
 * من غير نشاط متذكر مؤكد غيابه، أي جلسة شخصية حية بتعتبر غريبة وبتتخلّص مرة واحدة.
 * أما لو قراءة النشاط من التخزين هي اللي فشلت، فالشاشات الخاصة بتتخفي وتظهر خانة الربط
 * من غير ما نخرج الجلسة الحية.
 */
export function EmployeeFlow({
  business,
  businessUnreadable = false,
  pending,
  busy,
  connect,
  notice,
  startOver,
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
      // قراءة النشاط فشلت: نخفي الشاشات الخاصة بس من غير ما نخرج جلسة ممكن تكون صح.
      if (businessUnreadable) return <>{connect}</>;
      if (sameBusiness(business, session)) return null;
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
    [business, businessUnreadable, connect, report],
  );
  const screenProps = {
    connect,
    sessionGate,
    locked: busy,
    ...(startOver === undefined ? {} : { startOver }),
    ...(notice === undefined ? {} : { notice }),
  };
  return (
    <>
      {pending ? (
        <SwitchBusinessPanel busy={busy} onConfirm={() => onConfirm(pending)} onCancel={onCancel} />
      ) : null}
      {business ? (
        <PersonalScreen
          ownLeave={personalLeave}
          key={business.business_id}
          workspace={business}
          {...screenProps}
        />
      ) : (
        <PersonalScreen ownLeave={personalLeave} {...screenProps} />
      )}
    </>
  );
}

/** هل الجلسة الحالية تابعة لنفس النشاط المتذكر على الجهاز؟ (FR-012) */
function sameBusiness(business: PersonalWorkspace | null, session: ForeignSession): boolean {
  // من غير نشاط متذكر مفيش مقارنة، فأي جلسة حية بتعتبر غريبة.
  return (
    business !== null &&
    session.company_id === business.company_id &&
    session.business_id === business.business_id
  );
}

/** مفتاح الجلسة: نفس الجلسة ليها حالة واحدة ثابتة. */
function foreignSessionKey(session: ForeignSession): string {
  return `${session.company_id}:${session.business_id}:${session.user_id}:${session.expires_at}`;
}
