import createClient from 'openapi-fetch';

import { usesNativeStaffTransport } from '../platform/native-shell';
import { currentDeviceToken } from './device-auth';
import { nativeStaffFetch } from './native-staff-fetch';
import { apiOrigin } from './origin';
import type { paths } from './schema';

function withDevice(request: Request, token: string): Request {
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Device ${token}`);
  return new Request(request, { headers });
}

export function createApiClient(
  credentials: RequestCredentials = 'omit',
  fetch?: (request: Request) => Promise<Response>,
) {
  const client = createClient<paths>({
    baseUrl: apiOrigin(),
    credentials,
    ...(fetch === undefined ? {} : { fetch }),
  });
  client.use({
    async onRequest({ request }) {
      const token = await currentDeviceToken();
      if (token === null || token.length === 0) return request;
      return withDevice(request, token);
    },
  });
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

let singleton: ApiClient | undefined;
let staffSingleton: ApiClient | undefined;

export function staffApiClient(): ApiClient {
  staffSingleton ??= createApiClient(
    'include',
    usesNativeStaffTransport() ? nativeStaffFetch : undefined,
  );
  return staffSingleton;
}

export function apiClient(): ApiClient {
  singleton ??= createApiClient();
  return singleton;
}
