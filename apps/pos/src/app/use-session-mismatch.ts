import { useEffect, useRef } from 'react';

import { usePersonalSession } from '@/personal-staff/api/use-personal-session';

import { endPersonalSession } from './end-sessions';
import type { PersonalWorkspace } from './manager-link';

/** الجلسة الشخصية اللي الشاشة بتقراها. */
type PersonalSession = ReturnType<typeof usePersonalSession>['session'];

/** الجلسة اللي الشاشة بتقدر تعرضها، وهل هي لنشاط تاني غير المتذكر. */
export interface PersonalSessionView {
  session: PersonalSession;
  mismatched: boolean;
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
 * @returns الجلسة اللي الشاشة بتقدر تعرضها
 */
export function useSessionMismatch(remembered: PersonalWorkspace | null): PersonalSessionView {
  const { session } = usePersonalSession();
  const ended = useRef(new Set<string>());
  const mismatched =
    remembered !== null &&
    session !== null &&
    (session.company_id !== remembered.company_id ||
      session.business_id !== remembered.business_id);
  useEffect(() => {
    if (!mismatched || session === null) return;
    const key = `${session.company_id}:${session.business_id}:${session.user_id}:${session.expires_at}`;
    if (ended.current.has(key)) return;
    ended.current.add(key);
    void endPersonalSession().then((result) => {
      // الخروج المرفوض مش تكرار: القراءة الجاية تحاول تاني، بس من غير حلقة مفرغة.
      if (result === 'failed') ended.current.delete(key);
    });
  }, [mismatched, session]);
  return { session: mismatched ? null : session, mismatched };
}
