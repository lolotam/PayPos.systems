import { useCallback, useState } from 'react';

import { switchBusiness } from './business-switch';
import { rememberBusiness, type DeviceRole } from './device-role';
import { endPersonalSession } from './end-sessions';
import {
  resolveChoice,
  resolveLink,
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
  confirm: (pending: PersonalWorkspace) => void;
  cancel: () => void;
}

/**
 * خطوات شاشة النسخة الأصلية: لينك المدير، اختيار نوع الجهاز، وتبديل النشاط.
 *
 * كل الخطوات ورا بعض في طابور واحد، وكل خطوة بتقرا الدور والنشاط من التخزين قبل
 * ما تقرر، فخطوة متأخرة ما بتقدّمش على خطوة أحدث (BR-001). تبديل النشاط كمان
 * بيروح في نفس الطابور: الخروج من السيرفر يسبق حفظ النشاط الجديد (FR-012).
 *
 * @returns حالة الشاشة والخطوات اللي بتغيّرها
 */
export function useNativeFlow(): NativeFlow {
  const [state, setState] = useState<NativeState>({ kind: 'loading' });
  const onError = useCallback(() => {
    setState((current) => stateAfterFailure(current, null, null));
  }, []);
  const { busy, queue } = useStepQueue(onError);

  const onStart = useCallback((role: DeviceRole | null, saved: PersonalWorkspace | null) => {
    setState((current) => (current.kind === 'loading' ? stateForRole(role, saved) : current));
  }, []);

  const onLink = useCallback(
    async (workspace: PersonalWorkspace | null) => {
      queue(async () => {
        const outcome = await resolveLink(workspace);
        setState((current) => stateFromLink(current, outcome));
      });
    },
    [queue],
  );

  const choose = useCallback(
    (role: DeviceRole) => {
      queue(async () => setState(await resolveChoice(role)));
    },
    [queue],
  );

  const confirm = useCallback(
    (pending: PersonalWorkspace) => {
      queue(async () => {
        const outcome = await switchBusiness(pending, {
          isOnline: () => navigator.onLine,
          endPersonalSession,
          rememberBusiness,
        });
        setState((current) => stateAfterSwitch(current, outcome, pending));
      });
    },
    [queue],
  );

  const cancel = useCallback(() => {
    setState((current) => stateWithoutPending(current));
  }, []);

  return { state, busy, onStart, onLink, choose, confirm, cancel };
}
