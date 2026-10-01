'use client';

import type { TotpCodeInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { verifyTotpCode } from './session-calls';

export function useVerifyTotp() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>();

  async function submit(values: TotpCodeInput): Promise<void> {
    setPending(true);
    setError(undefined);
    const failure = await verifyTotpCode(values.code);
    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return { pending, error, submit };
}
