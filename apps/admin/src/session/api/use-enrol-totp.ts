'use client';

import type { ConfirmPasswordInput, TotpCodeInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { useState } from 'react';

import { enableTotp, verifyTotpCode } from './session-calls';

export type EnrolState =
  | { kind: 'password' }
  | { kind: 'verify'; totpURI: string; backupCodes: string[] }
  | { kind: 'done' };

export interface EnrolController {
  step: EnrolState;
  pending: boolean;
  error: MessageKey | undefined;
  start: (values: ConfirmPasswordInput) => Promise<void>;
  confirm: (values: TotpCodeInput) => Promise<void>;
}

export function useEnrolTotp(): EnrolController {
  const [step, setStep] = useState<EnrolState>({ kind: 'password' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>();

  async function start(values: ConfirmPasswordInput): Promise<void> {
    setPending(true);
    setError(undefined);
    const outcome = await enableTotp(values.password);
    setPending(false);
    if (typeof outcome === 'string') {
      setError(outcome);
      return;
    }
    setStep({ kind: 'verify', totpURI: outcome.totpURI, backupCodes: outcome.backupCodes });
  }

  async function confirm(values: TotpCodeInput): Promise<void> {
    setPending(true);
    setError(undefined);
    const failure = await verifyTotpCode(values.code);
    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }
    setStep({ kind: 'done' });
  }

  return { step, pending, error, start, confirm };
}
