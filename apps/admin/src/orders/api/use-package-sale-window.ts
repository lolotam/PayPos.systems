'use client';
import { useEffect, useState } from 'react';
import { saleAttemptExpired, saleAttemptExpiresIn, type HeldAttempt } from './package-sale-attempt';

// Background tabs and sleeping devices throttle timers, so focus and visibility wake-ups
// re-check the same expiry the timeout targets.
export function usePackageSaleWindow(attempt: HeldAttempt | undefined) {
  const [tick, bump] = useState(0);
  useEffect(() => {
    if (!attempt || attempt.saleId !== undefined || saleAttemptExpired(attempt, Date.now()))
      return undefined;
    const delay = Math.min(saleAttemptExpiresIn(attempt, Date.now()), 2 ** 31 - 1);
    const timer = setTimeout(() => bump((value) => value + 1), delay);
    const wake = () => bump((value) => value + 1);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [attempt, attempt?.key, attempt?.createdAt, attempt?.seenAt, attempt?.saleId, tick]);
}
