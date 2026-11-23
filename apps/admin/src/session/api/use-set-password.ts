'use client';

import type { MessageKey } from '@pospay/i18n';
import { useState } from 'react';

import { setPassword, type SetPasswordOutcome } from './set-password-calls';

export type SetPasswordStep = 'form' | 'done' | 'invalid-link';

export function useSetPassword(token: string) {
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<SetPasswordStep>('form');
  const [error, setError] = useState<MessageKey | undefined>();

  async function submit(newPassword: string): Promise<void> {
    setPending(true);
    setError(undefined);
    const outcome: SetPasswordOutcome = await setPassword(token, newPassword);
    setPending(false);
    if (outcome === 'done' || outcome === 'invalid-link') {
      setStep(outcome);
      return;
    }
    setError(outcome);
  }

  return { pending, step, error, submit };
}
