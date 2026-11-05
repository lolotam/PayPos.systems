import createClient from 'openapi-fetch';
import type { paths } from './schema';

export function ratingClient() {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) throw new Error('RATING_API_NOT_CONFIGURED');
  return createClient<paths>({
    baseUrl: configured.replace(/\/+$/, ''),
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
}
