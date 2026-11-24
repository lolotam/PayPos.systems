'use client';

import type { LoginInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { loadPage } from '@/shared/browser/load-page';
import { applyAccountNavStyle } from '@/shared/nav-style/apply-account-nav-style';

import { signInWithPassword } from './session-calls';

export function useSignIn() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>();

  async function submit(values: LoginInput): Promise<void> {
    setPending(true);
    setError(undefined);
    const outcome = await signInWithPassword(values.email, values.password);
    if (outcome === 'totp') {
      setPending(false);
      router.push('/login/two-factor');
      return;
    }
    if (outcome === 'done') {
      await applyAccountNavStyle();
      loadPage('/');
      return;
    }
    setPending(false);
    setError(outcome);
  }

  return { pending, error, submit };
}
