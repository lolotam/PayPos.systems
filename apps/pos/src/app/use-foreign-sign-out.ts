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
  const attemptRef = useRef({ id: 0, accepting: false });
  const reportRef = useRef({ onOutcome, sessionKey });
  reportRef.current = { onOutcome, sessionKey };
  const begin = useCallback(
    (isRetry: boolean) => {
      const id = attemptRef.current.id + 1;
      attemptRef.current = { id, accepting: true };
      if (isRetry) setRetrying(true);
      setAttempt(id);
      onOutcome(sessionKey, 'running');
      void endPersonalSession().then((result) => {
        const active = attemptRef.current;
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
    };
  }, []);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (outcome === 'running') {
      // running المحفوظة معناها رد محاولة قديمة مابقاش يوصل ونفس الجلسة لسه موجودة، فبتحسب فشل (#603).
      onOutcome(sessionKey, 'failed');
    } else if (outcome === undefined) {
      begin(false);
    }
  }, [begin, outcome, onOutcome, sessionKey]);
  useEffect(() => {
    if (attempt === 0) return;
    const timer = setTimeout(() => {
      const active = attemptRef.current;
      if (!mounted.current || active.id !== attempt || !active.accepting) return;
      active.accepting = false;
      setRetrying(false);
      reportRef.current.onOutcome(reportRef.current.sessionKey, 'failed');
    }, waitMs);
    return () => clearTimeout(timer);
  }, [attempt, waitMs]);
  const retry = useCallback(() => begin(true), [begin]);
  return { retrying, retry };
}
