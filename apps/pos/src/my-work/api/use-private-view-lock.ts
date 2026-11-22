import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { announceWindowClosed, removeSharedKey } from '../model/private-view-key';
import { sessionEnded, windowExpired } from '../model/work-error';
import type { CloseScope } from './private-view-clock';
import { privateViewCalls } from './private-view-calls';

export type PrivateViewProblem = 'invalid' | 'failed' | 'expired' | 'unavailable' | null;
export type PrivateViewLockOptions = {
  cachePrefix: readonly unknown[];
  onLeave: () => void;
};

/**
 * مسح الكاش وقفل النافذة، ومعالج الرفض اللي بيقرر ترجع لـ PIN ولا تخرج.
 * قفل النافذة لكل التابات (`all`) بيبعت إغلاق للسيرفر ويمسح المفتاح المشترك لو لسه لنفس النافذة
 * ويبلّغ باقي التابات برقمها؛ وقفل من برّه (`self`) بيمسح التاب ده بس ومبيلمسش المفتاح ولا السيرفر،
 * فمفيش إشارة قفل تقدر توصل لنافذة أحدث.
 *
 * @param setConfirmed بتتنده بـ undefined لما النافذة تتقفل
 * @param options.cachePrefix بداية مفاتيح الكاش اللي بتتمسح مع النافذة
 * @param options.onLeave بتتنده لما الجلسة نفسها تتقفل (401)
 */
export function usePrivateViewLock(
  options: PrivateViewLockOptions,
  setConfirmed: (window: undefined) => void,
) {
  const cache = useQueryClient();
  const [problem, setProblem] = useState<PrivateViewProblem>(null);
  const [verifying, setVerifying] = useState(false);
  const live = useRef<string | undefined>(undefined);
  const latest = useRef(options);
  latest.current = options;
  const clearCache = useCallback(() => {
    const queryKey = latest.current.cachePrefix;
    void cache.cancelQueries({ queryKey });
    cache.removeQueries({ queryKey });
  }, [cache]);
  const release = useCallback(
    (scope: CloseScope = 'all') => {
      const id = live.current;
      live.current = undefined;
      clearCache();
      if (id === undefined || scope === 'self') return;
      void privateViewCalls.close(id);
      removeSharedKey(id);
      announceWindowClosed(id);
    },
    [clearCache],
  );
  const lock = useCallback(
    (reason: PrivateViewProblem, scope: CloseScope = 'all') => {
      setConfirmed(undefined);
      setVerifying(false);
      setProblem(reason);
      release(scope);
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
  const hide = useCallback(() => {
    setVerifying(true);
    clearCache();
  }, [clearCache]);
  const show = useCallback(() => setVerifying(false), []);
  const close = useCallback((scope: CloseScope) => lock('expired', scope), [lock]);
  return { live, latest, problem, setProblem, verifying, release, refused, hide, show, close };
}
