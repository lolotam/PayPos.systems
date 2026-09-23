import { parseArgs } from 'node:util';

import { systemUuidV7 } from '@pospay/ids';

import { createAuth } from '../src/config.ts';
import { createPlatformUser } from '../src/create-platform-user.ts';

// pnpm platform:create-user --email <e> --name <n> --operator <your name> [--redirect-to <admin set-password URL>]
// Runs as pospay_auth (AUTH_DATABASE_URL); never reachable through the API (ADR-0003 §3, §6).
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    operator: { type: 'string' },
    'redirect-to': { type: 'string' },
  },
});
const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set — see .env.example`);
  return value;
};
if (values.email === undefined || values.name === undefined || values.operator === undefined) {
  throw new Error(
    'usage: --email <email> --name <name> --operator <your name> [--redirect-to <url>]',
  );
}
const trustedOrigins = (process.env['AUTH_TRUSTED_ORIGINS'] ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');
const redirectTo =
  values['redirect-to'] ??
  (trustedOrigins[0] === undefined ? undefined : `${trustedOrigins[0]}/set-password`);
if (redirectTo === undefined)
  throw new Error('--redirect-to is required when AUTH_TRUSTED_ORIGINS is empty');

const auth = await createAuth({
  databaseUrl: env('AUTH_DATABASE_URL'),
  secret: env('BETTER_AUTH_SECRET'),
  baseURL: env('BETTER_AUTH_URL'),
  trustedOrigins,
  ids: systemUuidV7(),
  secureCookies: env('BETTER_AUTH_URL').startsWith('https:'),
  onLog: ({ level, message }) => console.error('auth', level, message),
});
try {
  const { userId, link } = await createPlatformUser(auth, {
    email: values.email,
    name: values.name,
    operator: values.operator,
    redirectTo,
  });
  // The link is a one-time secret for this operator to hand over; it is printed once and written nowhere else.
  console.log(`user created: ${userId}`);
  console.log(`one-time set-password link (valid 1 hour): ${link}`);
} finally {
  await auth.close();
}
