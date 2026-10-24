import { useCallback, useEffect, useRef, useState } from 'react';

import { usePersonalSession } from '@/personal-staff/api/use-personal-session';

import { endPersonalSession } from './end-sessions';
import type { PersonalWorkspace } from './manager-link';

/** الجلسة الشخصية اللي الشاشة بتقراها. */
type PersonalSession = NonNullable<ReturnType<typeof usePersonalSession>['session']>;

/** حالة فروق الجلسة: الجلسة لنشاط تاني، والخروج فشل، وإعادة المحاولة. */
export interface SessionMismatch {
  mismatched: boolean;
  failed: boolean;
  retry: () => void;
}

/**
 * بيخلّص أي جلسة شخصية فاضلة من نشاط تاني بعد ما النشاط يتبدّل.
 *
 * sign-in ممكن يسبق التبديل ويسيب جلسة النشاط القديم شغالة والجهاز متذكر نشاط
 * جديد. النشاط المتذكر هو اللي يغلب: هو اللينك اللي الموظفة أكّدته آخر مرة،
 * والسيرفر لسه بيقرر في كل طلب (BR-002) — فالشاشة تفضل على النشاط المتذكر
 * والجلسة القديمة بتخلص.
 *
 * @param remembered النشاط المتذكر على الجهاز
 * @returns هل الجلسة لنشاط تاني، وهل الخروج فشل، ودالة إعادة المحاولة
 */
export function useSessionMismatch(remembered: PersonalWorkspace | null): SessionMismatch {
  const { session } = usePersonalSession();
  const ended = useRef(new Set<string>());
  const [failed, setFailed] = useState(false);
  const mismatched =
    remembered !== null &&
    session !== null &&
    (session.company_id !== remembered.company_id ||
      session.business_id !== remembered.business_id);
  useEffect(() => {
    if (!mismatched || session === null) {
      setFailed(false);
      return;
    }
    const key = sessionKey(session);
    // الجلسة دي اتجرّبت قبل كده: من غير حلقة مفرغة، واللي يقدر يعيد المحاولة هو الموظفة.
    if (ended.current.has(key)) return;
    ended.current.add(key);
    setFailed(false);
    void endPersonalSession().then((result) => {
      if (result === 'failed') setFailed(true);
    });
  }, [mismatched, session]);
  const retry = useCallback(() => {
    if (session === null) return;
    setFailed(false);
    void endPersonalSession().then((result) => {
      if (result === 'failed') setFailed(true);
    });
  }, [session]);
  return { mismatched, failed, retry };
}

/** مفتاح الجلسة: نفس الجلسة بتخلص مرة واحدة بس، واللي يعيدها هو الموظفة. */
function sessionKey(session: PersonalSession): string {
  return `${session.company_id}:${session.business_id}:${session.user_id}:${session.expires_at}`;
}
