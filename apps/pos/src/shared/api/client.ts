import createClient from 'openapi-fetch';

import { currentDeviceToken } from './device-auth';
import { apiOrigin } from './origin';
import type { paths } from './schema';

function withDevice(request: Request, token: string): Request {
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Device ${token}`);
  return new Request(request, { headers });
}

export function createApiClient(credentials: RequestCredentials = 'omit') {
  const client = createClient<paths>({
    baseUrl: apiOrigin(),
    credentials,
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
  staffSingleton ??= createApiClient('include');
  return staffSingleton;
}

export function apiClient(): ApiClient {
  singleton ??= createApiClient();
  return singleton;
}
