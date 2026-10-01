'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { signOutSession } from './session-calls';

export function useSignOut() {
  const router = useRouter();
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
    router.push('/login');
    router.refresh();
  }

  return { pending, failed, submit };
}
