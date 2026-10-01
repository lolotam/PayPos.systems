import type { RegisterDeviceInput } from '@pospay/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import { clearCredentials } from '../model/credentials';
import { bootDevice } from './boot-device';
import type { DeviceScreenState } from './screen-state';
import { submitRegistration } from './submit-registration';
import { useClaimPoll } from './use-claim-poll';

interface Epoch {
  n: number;
}

export interface DeviceSession {
  screen: DeviceScreenState;
  retry: () => Promise<void>;
  submit: (input: RegisterDeviceInput) => Promise<string | null>;
  startOver: () => Promise<void>;
}

export function useDeviceSession(): DeviceSession {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<DeviceScreenState>({ kind: 'loading' });
  const epoch = useRef<Epoch>({ n: 0 });
  const boot = useCallback(() => runBoot(epoch.current, queryClient, setScreen), [queryClient]);
  useEffect(() => {
    void boot();
  }, [boot]);
  const onApproved = useCallback(() => {
    void boot();
  }, [boot]);
  const onRefused = useCallback(() => {
    setScreen({ kind: 'pairing', notice: 'refused' });
  }, []);
  useClaimPoll(screen.kind === 'waiting', onApproved, onRefused);
  const submit = useCallback(
    (input: RegisterDeviceInput) => runSubmit(input, locale, setScreen),
    [locale],
  );
  const startOver = useCallback(() => runStartOver(epoch.current, setScreen), []);
  return { screen, retry: boot, submit, startOver };
}

async function runBoot(
  epoch: Epoch,
  queryClient: QueryClient,
  setScreen: (next: DeviceScreenState) => void,
): Promise<void> {
  const seen = epoch.n;
  setScreen({ kind: 'loading' });
  try {
    const next = await bootDevice(queryClient);
    if (epoch.n === seen) setScreen(next);
  } catch {
    if (epoch.n === seen) setScreen({ kind: 'offline' });
  }
}

async function runSubmit(
  input: RegisterDeviceInput,
  locale: Parameters<typeof submitRegistration>[1],
  setScreen: (next: DeviceScreenState) => void,
): Promise<string | null> {
  const message = await submitRegistration(input, locale);
  if (message === null) setScreen({ kind: 'waiting' });
  return message;
}

async function runStartOver(
  epoch: Epoch,
  setScreen: (next: DeviceScreenState) => void,
): Promise<void> {
  epoch.n += 1;
  const seen = epoch.n;
  try {
    await clearCredentials();
  } catch {
    if (epoch.n === seen) setScreen({ kind: 'offline' });
    return;
  }
  if (epoch.n === seen) setScreen({ kind: 'pairing', notice: null });
}
