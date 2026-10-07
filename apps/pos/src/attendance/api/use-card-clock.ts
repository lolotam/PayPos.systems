import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { clockByCard, type CardClockOutcome } from './clock-by-card';
import { useCardClockLifetime } from './use-card-clock-lifetime';

/** حالة مسح الكارت: مدخل واحد، مسح واحد أثناء الانتظار، ونتيجة أو رفض للعرض. */
export function useCardClock(onRejected?: () => Promise<void>) {
  const refresh = useCardSessionRefresh(onRejected);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<CardClockOutcome | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const active = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setCode('');
    setPending(false);
    setOutcome(null);
  }, []);
  useCardClockLifetime(clear, setOnline);

  const submit = useCallback(async () => {
    const value = code.trim();
    if (value.length === 0 || active.current !== null) return;
    setCode('');
    if (!navigator.onLine) {
      setOutcome({ kind: 'offline' });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setOutcome(null);
    try {
      const result = await clockByCard(value, controller.signal);
      if (!controller.signal.aborted) {
        setOutcome(result);
        if (result.kind === 'signed-out') refresh();
      }
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setPending(false);
      }
    }
  }, [code, refresh]);

  return { code, setCode, pending, outcome, online, submit };
}

function useCardSessionRefresh(onRejected?: () => Promise<void>) {
  const cache = useQueryClient();
  return useCallback(() => {
    void cache.invalidateQueries({ queryKey: ['staff-session'] });
    void onRejected?.();
  }, [cache, onRejected]);
}
