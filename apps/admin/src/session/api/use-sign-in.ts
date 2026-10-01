'use client';

import type { LoginInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { loadPage } from '@/shared/browser/load-page';

import { signInWithPassword } from './session-calls';

export function useSignIn() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>();

  async function submit(values: LoginInput): Promise<void> {
    setPending(true);
    setError(undefined);
    const outcome = await signInWithPassword(values.email, values.password);
    setPending(false);
    if (outcome === 'totp') {
      router.push('/login/two-factor');
      return;
    }
    if (outcome === 'done') {
      loadPage('/');
      return;
    }
    setError(outcome);
  }

  return { pending, error, submit };
}
