import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { closeAt, openedDeadlines } from '../model/private-view-deadline';
import { WorkHttpError, sessionEnded, windowExpired } from '../model/work-error';
import { privateViewCalls } from './private-view-calls';
import { type ConfirmedWindow, monotonicNow, usePrivateViewInput } from './use-private-view-input';

/** اللي الشاشة الخاصة بتديه للقراءات: رقم النافذة (جهاز الاستقبال بس) ومعالج الرفض. */
export type PrivateViewAccess = {
  windowId: string | undefined;
  refused: (error: unknown) => void;
};

type Problem = 'invalid' | 'failed' | 'expired' | null;
type Options = {
  mode: 'personal' | 'reception';
  cachePrefix: readonly unknown[];
  onLeave: () => void;
};

/** نتيجة محاولة فتح النافذة بالـ PIN؛ المواعيد بتتحسب من لحظة إرسال الطلب. */
async function attemptOpen(pin: string) {
  const sentAt = monotonicNow();
  try {
    const opened = await privateViewCalls.open(pin);
    const confirmed: ConfirmedWindow = {
      windowId: opened.window_id,
      deadlines: openedDeadlines(sentAt, opened),
    };
    return { kind: 'opened', confirmed } as const;
  } catch (error) {
    if (sessionEnded(error)) return { kind: 'ended' } as const;
    const wrong = error instanceof WorkHttpError && error.code === 'PIN_INVALID';
    return { kind: wrong ? 'invalid' : 'failed' } as const;
  }
}

/** مسح الكاش وقفل النافذة عند الانتهاء أو الخروج، ومعالج الرفض اللي بيقرر ترجع لـ PIN ولا تخرج. */
function usePrivateViewLock(
  options: Options,
  setConfirmed: (window: ConfirmedWindow | undefined) => void,
) {
  const cache = useQueryClient();
  const [problem, setProblem] = useState<Problem>(null);
  const live = useRef<string | undefined>(undefined);
  const latest = useRef(options);
  latest.current = options;
  const release = useCallback(() => {
    const id = live.current;
    live.current = undefined;
    const queryKey = latest.current.cachePrefix;
    void cache.cancelQueries({ queryKey });
    cache.removeQueries({ queryKey });
    if (id !== undefined) void privateViewCalls.close(id);
  }, [cache]);
  const lock = useCallback(
    (reason: Problem) => {
      setConfirmed(undefined);
      setProblem(reason);
      release();
    },
    [release, setConfirmed],
  );
  const refused = useCallback(
    (error: unknown) => {
      if (windowExpired(error)) lock('expired');
      else if (sessionEnded(error)) {
        lock(null);
        latest.current.onLeave();
      }
    },
    [lock],
  );
  const expire = useCallback(() => lock('expired'), [lock]);
  return { live, latest, problem, setProblem, release, refused, expire };
}

/**
 * القطعة المشتركة لأي شاشة خاصة (شغلي، وبعدها حضوري): خطوة الـ PIN على جهاز الاستقبال، قفل في
 * الأبكر بين موعد الخمول المؤكَّد من السيرفر والسقف المطلق، لمس السيرفر كل 20 ثانية على الأكتر
 * (الموعد بيتحرك لما اللمسة تنجح بس)، ومسح الكاش عند القفل أو الخروج.
 * الموبايل الشخصي ما بيحتاجش نافذة: بيتفتح على طول.
 *
 * @param options.mode موبايلها الشخصي أو جهاز الاستقبال
 * @param options.cachePrefix بداية مفاتيح الكاش اللي بتتمسح مع النافذة
 * @param options.onLeave بتتنده لما الجلسة نفسها تتقفل (401) والشاشة الخاصة لازم تتقفل كلها
 * @returns حالة الفتح، أدوات القراءة، وأفعال الإدخال
 */
export function usePrivateView(options: Options) {
  const reception = options.mode === 'reception';
  const [confirmed, setConfirmed] = useState<ConfirmedWindow>();
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const lock = usePrivateViewLock(options, setConfirmed);
  const { release } = lock;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      release();
    };
  }, [release]);
  usePrivateViewInput(reception ? confirmed : undefined, lock.expire, lock.refused);
  const windowId = confirmed?.windowId;
  const submitPin = async (pin: string) => {
    if (pending || !navigator.onLine) return;
    setPending(true);
    lock.setProblem(null);
    const outcome = await attemptOpen(pin);
    if (!mounted.current) {
      if (outcome.kind === 'opened') void privateViewCalls.close(outcome.confirmed.windowId);
      return;
    }
    setPending(false);
    if (outcome.kind === 'opened') {
      if (closeAt(outcome.confirmed.deadlines) <= monotonicNow()) {
        void privateViewCalls.close(outcome.confirmed.windowId);
        lock.setProblem('expired');
        return;
      }
      lock.live.current = outcome.confirmed.windowId;
      setConfirmed(outcome.confirmed);
    } else if (outcome.kind === 'ended') lock.latest.current.onLeave();
    else lock.setProblem(outcome.kind);
  };
  return {
    open: !reception || windowId !== undefined,
    access: { windowId, refused: lock.refused } satisfies PrivateViewAccess,
    pending,
    problem: lock.problem,
    submitPin,
  };
}
