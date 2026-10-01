import { createPospayAuthClient, type PospayAuthClient } from '@pospay/auth/client';

import { apiOrigin } from '@/shared/api/origin';

let singleton: PospayAuthClient | undefined;

export function browserAuthClient(): PospayAuthClient {
  singleton ??= createPospayAuthClient(apiOrigin());
  return singleton;
}
