'use client';

import type { TotpCodeInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { useState } from 'react';

import { loadPage } from '@/shared/browser/load-page';
import { applyAccountNavStyle } from '@/shared/nav-style/apply-account-nav-style';

import { verifyTotpCode } from './session-calls';

export function useVerifyTotp() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>();

  async function submit(values: TotpCodeInput): Promise<void> {
    setPending(true);
    setError(undefined);
    const failure = await verifyTotpCode(values.code);
    if (failure) {
      setPending(false);
      setError(failure);
      return;
    }
    await applyAccountNavStyle();
    loadPage('/');
  }

  return { pending, error, submit };
}
