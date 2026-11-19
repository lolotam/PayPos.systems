'use client';
import { useEffect, useState } from 'react';
import { saleAttemptExpired, saleAttemptExpiresIn, type HeldAttempt } from './package-sale-attempt';

// Background tabs and sleeping devices throttle timers, so focus and visibility wake-ups
// re-check the same expiry the timeout targets. The wake-ups record an observation even
// when the attempt is already expired, so the expiry latch reaches the journal record.
export function usePackageSaleWindow(attempt: HeldAttempt | undefined, onObserve: () => void) {
  const [tick, bump] = useState(0);
  useEffect(() => {
    if (!attempt || attempt.saleId !== undefined) return undefined;
    const wake = () => {
      onObserve();
      bump((value) => value + 1);
    };
    const timer = saleAttemptExpired(attempt, Date.now())
      ? null
      : setTimeout(wake, Math.min(saleAttemptExpiresIn(attempt, Date.now()), 2 ** 31 - 1));
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [
    attempt,
    attempt?.key,
    attempt?.createdAt,
    attempt?.seenAt,
    attempt?.saleId,
    tick,
    onObserve,
  ]);
}
