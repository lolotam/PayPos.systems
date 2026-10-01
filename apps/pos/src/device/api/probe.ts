import type { QueryClient } from '@tanstack/react-query';

import { readDeviceMe } from './device-calls';
import type { MeResult } from './screen-state';

export async function probeDevice(queryClient: QueryClient): Promise<MeResult> {
  try {
    return await queryClient.fetchQuery({
      queryKey: ['devices', 'me'],
      staleTime: 0,
      // الوضع الافتراضي 'online' بيوقّف الطلب لما المتصفح يقول إنه offline ومبيخلصش أبداً؛ الـ POS لازم يوصل
      // لشاشة عدم الاتصال بدل ما يفضل على «جاري التحميل».
      networkMode: 'always',
      queryFn: readDeviceMe,
    });
  } catch {
    return { kind: 'offline' };
  }
}
