import { useCallback, useRef, useState } from 'react';

import { switchBusiness, type SwitchOutcome } from './business-switch';
import { rememberBusiness, type DeviceRole } from './device-role';
import { endPersonalSession } from './end-sessions';
import {
  endEmployeeSessionFirst,
  resolveChoice,
  resolveLink,
  resolveStartOver,
  stateAfterFailure,
  stateAfterSwitch,
  stateForRole,
  stateFromLink,
  stateWithoutPending,
  type NativeState,
} from './link-rules';
import type { PersonalWorkspace } from './manager-link';
import { useStepQueue } from './use-step-queue';

/** حالة شاشة النسخة الأصلية وخطواتها. */
export interface NativeFlow {
  state: NativeState;
  busy: boolean;
  onStart: (role: DeviceRole | null, saved: PersonalWorkspace | null) => void;
  onLink: (workspace: PersonalWorkspace | null) => Promise<void>;
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
    (role: DeviceRole | null, saved: PersonalWorkspace | null) => {
      apply((current: NativeState) =>
        current.kind === 'loading' ? stateForRole(role, saved) : current,
      );
    },
    [apply],
  );

  const onLink = useCallback(
    async (workspace: PersonalWorkspace | null) => {
      queue(async () => {
        const outcome = await resolveLink(workspace);
        apply((current: NativeState) => stateFromLink(current, outcome));
      });
    },
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
      });
    },
    [apply, queue],
  );

  const cancel = useCallback(() => {
    apply(stateWithoutPending(latest.current));
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
    endPersonalSession,
    rememberBusiness,
  });
}

/** نفس النشاط بالمعرّفين بتوعه. */
function sameBusiness(one: PersonalWorkspace, other: PersonalWorkspace): boolean {
  return one.company_id === other.company_id && one.business_id === other.business_id;
}
