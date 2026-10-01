import createClient from 'openapi-fetch';

import { apiOrigin } from './origin';
import type { paths } from './schema';
import { readSelection } from './selection-cookie';

function withCompany(request: Request): Request {
  if (request.headers.has('x-company-id')) return request;
  if (typeof document === 'undefined') return request;
  const companyId = readSelection().companyId;
  if (!companyId) return request;
  const headers = new Headers(request.headers);
  headers.set('x-company-id', companyId);
  return new Request(request, { headers });
}

export function createApiClient() {
  const client = createClient<paths>({
    baseUrl: apiOrigin(),
    credentials: 'include',
  });
  client.use({
    onRequest({ request }) {
      return withCompany(request);
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
