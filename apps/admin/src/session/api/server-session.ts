import { createPospayAuthClient } from '@pospay/auth/client';
import { cookies } from 'next/headers';

import { apiOrigin } from '@/shared/api/origin';

import { anonymousStatus, hasUser } from './auth-error';

export type SessionRead = { kind: 'signed-in' } | { kind: 'anonymous' } | { kind: 'error' };

function classify(result: { data: unknown; error: unknown }): SessionRead {
  if (result.error) {
    return anonymousStatus(result.error) ? { kind: 'anonymous' } : { kind: 'error' };
  }
  return hasUser(result.data) ? { kind: 'signed-in' } : { kind: 'anonymous' };
}

export async function readSession(): Promise<SessionRead> {
  const jar = await cookies();
  let origin: string;
  try {
    origin = apiOrigin();
  } catch {
    return { kind: 'error' };
  }
  const cookie = jar
    .getAll()
    .map((item) => `${item.name}=${item.value}`)
    .join('; ');
  try {
    const result = await createPospayAuthClient(origin).getSession({
      fetchOptions: { headers: { cookie }, cache: 'no-store' },
    });
    return classify(result);
  } catch {
    return { kind: 'error' };
  }
}
