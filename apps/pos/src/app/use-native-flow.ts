import { useCallback, useRef, useState } from 'react';

import { markLaunchLinkHandled } from '@/shared/platform/launch-links';

import { switchBusiness, type SwitchOutcome } from './business-switch';
import { rememberBusiness, type DeviceRole } from './device-role';
import {
  endEmployeeSessionFirst,
  endPersonalSessionWithTimeout,
  resolveChoice,
  resolveLink,
  resolveStartOver,
  stateAfterFailure,
  stateAfterSwitch,
  stateForRole,
  stateFromLink,
  stateWithoutPending,
  type KnownShellState,
  type NativeState,
} from './link-rules';
import type { PersonalWorkspace } from './manager-link';
import { useStepQueue } from './use-step-queue';

/** حالة شاشة النسخة الأصلية وخطواتها. */
export interface NativeFlow {
  state: NativeState;
  busy: boolean;
  onStart: (
    role: DeviceRole | null,
    saved: PersonalWorkspace | null,
    readFailed?: boolean,
    businessUnreadable?: boolean,
  ) => void;
  onLink: (workspace: PersonalWorkspace | null, fallback?: KnownShellState) => Promise<boolean>;
  choose: (role: DeviceRole) => void;
  /** بيرجع لاختيار نوع الجهاز لما مفيش اقتران ولا جلسة (FR-001). */
  startOver: () => void;
  confirm: (pending: PersonalWorkspace) => void;
  cancel: () => void;
}

/**
 * خطوات شاشة النسخة الأصلية: لينك المدير، اختيار نوع الجهاز، الرجوع له، وتبديل النشاط.
 *
 * كل الخطوات ورا بعض في طابور واحد، وكل خطوة بتقرا الدور والنشاط من التخزين قبل
 * ما تقرر، فخطوة متأخرة ما بتقدّمش على خطوة أحدث (BR-001). تبديل النشاط كمان
 * بيروح في نفس الطابور: الخروج من السيرفر يسبق حفظ النشاط الجديد (FR-012).
 *
 * @returns حالة الشاشة والخطوات اللي بتغيّرها
 */
export function useNativeFlow(): NativeFlow {
  const [state, setState] = useState<NativeState>({ kind: 'loading' });
  // نسخة من الحالة بتتحدّث مع كل تغيير: الخطوة اللي في الطابور بتشوف الحالة
  // الراهنة من غير ما تقرا حالة React.
  const latest = useRef<NativeState>(state);
  const apply = useCallback((next: NativeState | ((current: NativeState) => NativeState)) => {
    const value = typeof next === 'function' ? next(latest.current) : next;
    latest.current = value;
    setState(value);
  }, []);
  const onError = useCallback(() => {
    apply(stateAfterFailure(latest.current, null, null));
  }, [apply]);
  const { busy, queue } = useStepQueue(onError);

  const onStart = useCallback(
    (
      role: DeviceRole | null,
      saved: PersonalWorkspace | null,
      readFailed?: boolean,
      businessUnreadable?: boolean,
    ) => {
      apply((current) => startState(current, role, saved, readFailed, businessUnreadable));
    },
    [apply],
  );

  const onLink = useCallback(
    (workspace: PersonalWorkspace | null, fallback?: KnownShellState): Promise<boolean> =>
      runQueuedLink(queue, apply, workspace, fallback),
    [apply, queue],
  );

  const choose = useCallback(
    (role: DeviceRole) => {
      queue(async () => {
        apply(await resolveChoice(role));
      });
    },
    [apply, queue],
  );

  const startOver = useCallback(() => {
    queue(async () => {
      const refused = await endEmployeeSessionFirst(latest.current);
      if (refused !== null) return apply(refused);
      apply(await resolveStartOver());
    });
  }, [apply, queue]);

  const confirm = useCallback(
    (pending: PersonalWorkspace) => {
      queue(async () => {
        const outcome = await switchStep(pending, latest.current);
        if (outcome === null) return;
        apply((current: NativeState) => stateAfterSwitch(current, outcome, pending));
        // اللينك الافتتاحي المعلّق ما بيتقفلش غير لما التبديل يكمل فعلًا، ولو فشل بيفضل قابل للإعادة.
        if (outcome === 'switched') markLaunchLinkHandled();
      });
    },
    [apply, queue],
  );

  const cancel = useCallback(() => {
    apply(stateWithoutPending(latest.current));
    // رفض التبديل بيقفل اللينك الافتتاحي عشان إعادة التحميل ما تفتحش نفس اللوحة تاني.
    markLaunchLinkHandled();
  }, [apply]);

  return { state, busy, onStart, onLink, choose, startOver, confirm, cancel };
}

/**
 * خطوة تبديل النشاط: بتتأكد إن النشاط المطلوب لسه هو اللي على الشاشة قبل ما
 * تبدّل، فلينك أحدث بدّل النشاط الجديد ما يبقاش التبديل القديم هو اللي يجري.
 *
 * @param pending النشاط المطلوب تبديله
 * @param current حالة الشاشة الراهنة
 * @returns نتيجة التبديل، أو null لما النشاط المطلوب ما بقاش على الشاشة
 */
async function switchStep(
  pending: PersonalWorkspace,
  current: NativeState,
): Promise<SwitchOutcome | null> {
  if (current.kind !== 'flow' || current.pending === undefined) return null;
  if (!sameBusiness(current.pending, pending)) return null;
  return switchBusiness(pending, {
    isOnline: () => navigator.onLine,
    // الخروج ليه مهلة: طلب واقف ما يبقاش بيحجز الشاشة على شاشتها القديمة للأبد.
    endPersonalSession: endPersonalSessionWithTimeout,
    rememberBusiness,
  });
}

/** حالة البداية بعد قراءة التخزين: بتتطبق بس لو الشاشة لسه في مرحلة التحميل. */
function startState(
  current: NativeState,
  role: DeviceRole | null,
  saved: PersonalWorkspace | null,
  readFailed?: boolean,
  businessUnreadable?: boolean,
): NativeState {
  if (current.kind !== 'loading') return current;
  // قراءة فاشلة: الشاشة بتفضل على اللي معروف، والتنبيه بيقول إن القراءة فشلت.
  if (readFailed === true) return stateAfterFailure(current, role, saved, businessUnreadable);
  return stateForRole(role, saved);
}

/** ينفّذ تطبيق لينك جوه طابور الخطوات ويرجع هل اللينك اتطبّق ومش محتاج إعادة. */
function runQueuedLink(
  queue: (step: () => Promise<void>) => void,
  apply: (next: NativeState | ((current: NativeState) => NativeState)) => void,
  workspace: PersonalWorkspace | null,
  fallback?: KnownShellState,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let handled = false;
    queue(async () => {
      try {
        const outcome = await resolveLink(workspace, fallback);
        apply((current: NativeState) => stateFromLink(current, outcome));
        const hasPendingSwitch =
          outcome.kind === 'state' &&
          outcome.state.kind === 'flow' &&
          outcome.state.pending !== undefined;
        // الفشل المؤقت زي انقطاع النت أو انتظار تأكيد التبديل ما بيقفلش اللينك؛ ونجاح أي لينك أحدث بيقفل القديم.
        const settled =
          outcome.kind === 'state' &&
          outcome.state.kind !== 'loading' &&
          outcome.state.alert !== 'needsInternet' &&
          !hasPendingSwitch;
        if (settled) {
          markLaunchLinkHandled();
          handled = true;
        }
      } finally {
        resolve(handled);
      }
    });
  });
}

/** نفس النشاط بالمعرّفين بتوعه. */
function sameBusiness(one: PersonalWorkspace, other: PersonalWorkspace): boolean {
  return one.company_id === other.company_id && one.business_id === other.business_id;
}
