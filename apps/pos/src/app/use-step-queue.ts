import { useCallback, useRef, useState } from 'react';

/**
 * طابور الخطوات: لينك أو اختيار دور، واحد ورا التاني.
 *
 * كل خطوة بتقرا الدور والنشاط من التخزين قبل ما تقرر، فخطوة متأخرة ما بتقدّمش على خطوة
 * أحدث، والجهاز ما بيضيعش منه دور اتغيّر في نص الطريق (BR-001).
 *
 * @returns علامة إن في خطوة شغالة، ودالة بتحط الخطوة في الطابور
 */
export function useStepQueue(): {
  busy: boolean;
  queue: (step: () => Promise<void>) => void;
} {
  const [busy, setBusy] = useState(false);
  const steps = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const queue = useCallback((step: () => Promise<void>) => {
    pending.current += 1;
    setBusy(true);
    const done = () => {
      pending.current -= 1;
      if (pending.current === 0) setBusy(false);
    };
    steps.current = steps.current
      .then(step)
      .catch(() => undefined)
      .finally(done);
  }, []);
  return { busy, queue };
}
