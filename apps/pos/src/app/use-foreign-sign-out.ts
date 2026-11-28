import { useCallback, useEffect, useRef, useState } from 'react';

import { endPersonalSession } from './end-sessions';

/** حالة الخروج من جلسة نشاط تاني: شغّال أو مرفوض. */
export type ForeignSessionOutcome = 'running' | 'failed';

interface ForeignSignOutOptions {
  sessionKey: string;
  outcome: ForeignSessionOutcome | undefined;
  onOutcome: (key: string, next: ForeignSessionOutcome) => void;
  waitMs: number;
}

interface SignOutAttempt {
  id: number;
  accepting: boolean;
  controller: AbortController | null;
}

interface SignOutReport {
  onOutcome: (key: string, next: ForeignSessionOutcome) => void;
  sessionKey: string;
}

function useSignOutWaitTimer(
  attempt: number,
  waitMs: number,
  mounted: { current: boolean },
  attemptRef: { current: SignOutAttempt },
  reportRef: { current: SignOutReport },
  setRetrying: (value: boolean) => void,
): void {
  useEffect(() => {
    if (attempt === 0) return;
    const timer = setTimeout(() => {
      const active = attemptRef.current;
      if (!mounted.current || active.id !== attempt || !active.accepting) return;
      active.accepting = false;
      // مهلة الانتظار لازم تلغي الطلب نفسه، عشان الرد المتأخر ما يمسحش جلسة أحدث وسياج الإلغاء يستناه.
      active.controller?.abort();
      active.controller = null;
      setRetrying(false);
      reportRef.current.onOutcome(reportRef.current.sessionKey, 'failed');
    }, waitMs);
    return () => clearTimeout(timer);
  }, [attempt, attemptRef, mounted, reportRef, setRetrying, waitMs]);
}

/**
 * بيدير محاولات إنهاء الجلسة الغريبة بمهلة محددة، عشان الموظفة ما تفضلش على
 * شاشة تحميل من غير زر، وأي رد متأخر أو جاي من محاولة أقدم ما يغيّرش النتيجة.
 * والتنبيه الجديد اللي يلاقي running محفوظة بيعاملها كفشل بدل انتظار رد مش هيستلمه.
 */
export function useForeignSignOut({
  sessionKey,
  outcome,
  onOutcome,
  waitMs,
}: ForeignSignOutOptions) {
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const started = useRef(false);
  const mounted = useRef(false);
  const attemptRef = useRef<SignOutAttempt>({ id: 0, accepting: false, controller: null });
  const reportRef = useRef<SignOutReport>({ onOutcome, sessionKey });
  reportRef.current = { onOutcome, sessionKey };
  const begin = useCallback(
    (isRetry: boolean) => {
      attemptRef.current.controller?.abort();
      const id = attemptRef.current.id + 1;
      const controller = new AbortController();
      attemptRef.current = { id, accepting: true, controller };
      if (isRetry) setRetrying(true);
      setAttempt(id);
      onOutcome(sessionKey, 'running');
      void endPersonalSession(controller.signal).then((result) => {
        const active = attemptRef.current;
        if (active.id === id) active.controller = null;
        if (!mounted.current || active.id !== id || !active.accepting) return;
        if (result === 'failed') active.accepting = false;
        setRetrying(false);
        onOutcome(sessionKey, result === 'failed' ? 'failed' : 'running');
      });
    },
    [onOutcome, sessionKey],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // إلغاء أي خروج جاري وقت التفكيك الحقيقي (بعد microtask عشان StrictMode يعيد التركيب من غير قطع).
      queueMicrotask(() => {
        if (mounted.current) return;
        attemptRef.current.controller?.abort();
        attemptRef.current.controller = null;
      });
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (outcome === 'running') onOutcome(sessionKey, 'failed');
    else if (outcome === undefined) begin(false);
  }, [begin, outcome, onOutcome, sessionKey]);

  useSignOutWaitTimer(attempt, waitMs, mounted, attemptRef, reportRef, setRetrying);
  const retry = useCallback(() => begin(true), [begin]);
  return { retrying, retry };
}
