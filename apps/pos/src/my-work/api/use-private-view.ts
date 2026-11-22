import { useEffect, useRef, useState } from 'react';
import { closeAt, openedDeadlines } from '../model/private-view-deadline';
import { claimSharedKey, type SharedKey } from '../model/private-view-key';
import { WorkHttpError, sessionEnded } from '../model/work-error';
import { privateViewCalls } from './private-view-calls';
import {
  type ConfirmedWindow,
  monotonicNow,
  usePrivateViewInput,
  wallNow,
} from './use-private-view-input';
import { usePrivateViewLock } from './use-private-view-lock';

/** اللي الشاشة الخاصة بتديه للقراءات: رقم النافذة (جهاز الاستقبال بس) ومعالج الرفض. */
export type PrivateViewAccess = {
  windowId: string | undefined;
  refused: (error: unknown) => void;
};

type Options = {
  mode: 'personal' | 'reception';
  cachePrefix: readonly unknown[];
  onLeave: () => void;
};

/** نتيجة محاولة فتح النافذة بالـ PIN؛ المواعيد بتتحسب من لحظة إرسال الطلب (الرتيبة والجدارية). */
async function attemptOpen(pin: string) {
  const sentAt = monotonicNow();
  const sentWall = wallNow();
  try {
    const opened = await privateViewCalls.open(pin);
    const confirmed: ConfirmedWindow = {
      windowId: opened.window_id,
      deadlines: openedDeadlines(sentAt, opened),
      sentWall,
      shared: false,
    };
    const key: SharedKey = {
      windowId: opened.window_id,
      sessionRef: opened.session_ref,
      windowSeq: opened.window_seq,
      idleWallAt: sentWall + opened.idle_remaining_ms,
      capWallAt: sentWall + opened.cap_remaining_ms,
    };
    return { kind: 'opened', confirmed, key } as const;
  } catch (error) {
    if (sessionEnded(error)) return { kind: 'ended' } as const;
    const wrong = error instanceof WorkHttpError && error.code === 'PIN_INVALID';
    return { kind: wrong ? 'invalid' : 'failed' } as const;
  }
}

/**
 * القطعة المشتركة لأي شاشة خاصة (شغلي، وبعدها حضوري): خطوة الـ PIN على جهاز الاستقبال، قفل في
 * الأبكر بين موعد الخمول المؤكَّد من السيرفر والسقف المطلق، لمس السيرفر كل 20 ثانية على الأكتر
 * (الموعد بيتحرك لما اللمسة تنجح بس)، ومسح الكاش عند القفل أو الخروج. المفتاح المشترك بيخلّي أي
 * فتح أحدث يقفل التابات الأقدم، وقفل النافذة في تاب بيوصل لباقي التابات برقمها (ADR-0019).
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
  usePrivateViewInput(reception ? confirmed : undefined, lock);
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
      const { confirmed: opened, key } = outcome;
      if (closeAt(opened.deadlines) <= monotonicNow()) {
        void privateViewCalls.close(opened.windowId);
        lock.setProblem('expired');
        return;
      }
      const claim = claimSharedKey(key, wallNow());
      if (claim === 'older') {
        lock.setProblem('expired');
        return;
      }
      lock.live.current = opened.windowId;
      setConfirmed({ ...opened, shared: claim === 'written' });
    } else if (outcome.kind === 'ended') lock.latest.current.onLeave();
    else lock.setProblem(outcome.kind);
  };
  return {
    open: !reception || windowId !== undefined,
    verifying: lock.verifying,
    access: { windowId, refused: lock.refused } satisfies PrivateViewAccess,
    pending,
    problem: lock.problem,
    submitPin,
  };
}
