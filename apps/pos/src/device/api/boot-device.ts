import type { QueryClient } from '@tanstack/react-query';

import { clearIfToken } from '../model/credentials';
import { deviceDb, CURRENT_DEVICE } from '../model/device-db';
import { probeDevice } from './probe';
import type { DeviceScreenState } from './screen-state';

// السؤال عن الجهاز برّه طابور الكتابة؛ مسح التوكن المرفوض بس هو اللي بيعدّي عليه، وبشرط إن التوكن لسه هو المحفوظ.
export async function bootDevice(queryClient: QueryClient): Promise<DeviceScreenState> {
  // من غير Web Locks مفيش طريقة تمنع تابين يطالبوا بنفس التسجيل (claim-loop.ts)، فالجهاز ما يتربطش أصلاً.
  if (globalThis.navigator?.locks === undefined) return { kind: 'unsupported' };
  const row = await deviceDb.credentials.get(CURRENT_DEVICE);
  if (row?.device_token) return identityScreen(queryClient, row.device_token);
  if (row?.claim_secret) return { kind: 'waiting' };
  return { kind: 'pairing', notice: null };
}

async function identityScreen(queryClient: QueryClient, token: string): Promise<DeviceScreenState> {
  const me = await probeDevice(queryClient);
  if (me.kind === 'ready') return { kind: 'ready', branchId: me.branchId };
  if (me.kind !== 'rejected') return { kind: 'offline' };
  if (await clearIfToken(token)) return { kind: 'pairing', notice: 'removed' };
  return bootDevice(queryClient);
}
