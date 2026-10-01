import type { QueryClient } from '@tanstack/react-query';

import { readDeviceMe } from './device-calls';
import type { MeResult } from './screen-state';

export async function probeDevice(queryClient: QueryClient): Promise<MeResult> {
  try {
    return await queryClient.fetchQuery({
      queryKey: ['devices', 'me'],
      staleTime: 0,
      queryFn: readDeviceMe,
    });
  } catch {
    return { kind: 'offline' };
  }
}
