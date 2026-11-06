import { useEffect, useRef } from 'react';
import { timestamp } from '@pospay/contracts';

export function useSessionDeadline(expiresAt: string | undefined, expired: () => void) {
  const notified = useRef<string | undefined>(undefined);
  const parsed = timestamp.safeParse(expiresAt);
  const deadline = parsed.success ? Date.parse(parsed.data) : NaN;
  useEffect(() => {
    if (expiresAt === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      const remaining = deadline - Date.now();
      if (!(remaining > 0)) {
        if (notified.current !== expiresAt) {
          notified.current = expiresAt;
          expired();
        }
      } else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    // مؤقت الخلفية قد يتأخر؛ الرجوع أو التركيز يعيدان فحص الأجل المعروف فورًا.
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [expiresAt, deadline, expired]);
  return Number.isFinite(deadline) && Date.now() < deadline;
}
