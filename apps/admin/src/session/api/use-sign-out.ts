'use client';

import { useState } from 'react';

import { loadPage } from '@/shared/browser/load-page';

import { signOutSession } from './session-calls';

export function useSignOut() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(): Promise<void> {
    setPending(true);
    setFailed(false);
    const ok = await signOutSession();
    setPending(false);
    if (!ok) {
      setFailed(true);
      return;
    }
    loadPage('/login');
  }

  return { pending, failed, submit };
}
