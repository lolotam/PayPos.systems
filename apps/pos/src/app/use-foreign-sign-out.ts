import { useCallback, useEffect, useRef, useState } from 'react';

import { endPersonalSession } from './end-sessions';

interface ForeignSignOutOptions {
  sessionKey: string;
  outcome: 'running' | 'failed' | undefined;
  onOutcome: (key: string, next: 'running' | 'failed') => void;
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
  const current = useRef({ id: 0, accepting: false });
  const begin = useCallback(
    (isRetry: boolean) => {
      const id = current.current.id + 1;
      current.current = { id, accepting: true };
      if (isRetry) setRetrying(true);
      setAttempt(id);
      onOutcome(sessionKey, 'running');
      void endPersonalSession().then((result) => {
        if (!mounted.current || current.current.id !== id || !current.current.accepting) return;
        if (result === 'failed') current.current.accepting = false;
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
      if (!mounted.current || current.current.id !== attempt || !current.current.accepting) return;
      current.current.accepting = false;
      setRetrying(false);
      onOutcome(sessionKey, 'failed');
    }, waitMs);
    return () => clearTimeout(timer);
  }, [attempt, onOutcome, sessionKey, waitMs]);

  const retry = useCallback(() => begin(true), [begin]);
  return { retrying, retry };
}
