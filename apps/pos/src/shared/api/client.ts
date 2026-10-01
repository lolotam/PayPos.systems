import createClient from 'openapi-fetch';

import { currentDeviceToken } from './device-auth';
import { apiOrigin } from './origin';
import type { paths } from './schema';

function withDevice(request: Request, token: string): Request {
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Device ${token}`);
  return new Request(request, { headers });
}

export function createApiClient() {
  const client = createClient<paths>({
    baseUrl: apiOrigin(),
    credentials: 'omit',
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

export function apiClient(): ApiClient {
  singleton ??= createApiClient();
  return singleton;
}
