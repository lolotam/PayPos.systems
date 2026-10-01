import type { QueryClient } from '@tanstack/react-query';

import { deviceDb, CURRENT_DEVICE } from '../model/device-db';
import { enqueueWrite } from '../model/write-queue';
import { probeDevice } from './probe';
import type { DeviceScreenState } from './screen-state';

export function bootDevice(queryClient: QueryClient): Promise<DeviceScreenState> {
  return enqueueWrite(() => decide(queryClient));
}

async function decide(queryClient: QueryClient): Promise<DeviceScreenState> {
  const row = await deviceDb.credentials.get(CURRENT_DEVICE);
  if (row?.device_token) return identityScreen(queryClient);
  if (row?.claim_secret) return { kind: 'waiting' };
  return { kind: 'pairing', notice: null };
}

async function identityScreen(queryClient: QueryClient): Promise<DeviceScreenState> {
  const me = await probeDevice(queryClient);
  if (me.kind === 'ready') return { kind: 'ready', branchId: me.branchId };
  if (me.kind !== 'rejected') return { kind: 'offline' };
  await deviceDb.credentials.delete(CURRENT_DEVICE);
  return { kind: 'pairing', notice: 'removed' };
}
