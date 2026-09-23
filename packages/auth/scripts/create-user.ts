import { parseArgs } from 'node:util';

import { systemUuidV7 } from '@pospay/ids';

import { createAuth } from '../src/config.ts';
import { OperatorInputError, createPlatformUser } from '../src/create-platform-user.ts';
import { describeFailure } from './failure.ts';

// pnpm platform:create-user --email <e> --name <n> --operator <your name> [--redirect-to <admin set-password URL>]
// Runs as pospay_auth (AUTH_DATABASE_URL); never reachable through the API (ADR-0003 §3, §6).
const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new OperatorInputError(`${name} is not set — see .env.example`);
  }
  return value;
};

function readInput(): { email: string; name: string; operator: string; redirectTo: string } {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      operator: { type: 'string' },
      'redirect-to': { type: 'string' },
    },
  });
  if (values.email === undefined || values.name === undefined || values.operator === undefined) {
    throw new OperatorInputError(
      'usage: --email <email> --name <name> --operator <your name> [--redirect-to <url>]',
    );
  }
  const origin = trustedOrigins()[0];
  const redirectTo =
    values['redirect-to'] ?? (origin === undefined ? undefined : `${origin}/set-password`);
  if (redirectTo === undefined) {
    throw new OperatorInputError('--redirect-to is required when AUTH_TRUSTED_ORIGINS is empty');
  }
  return { email: values.email, name: values.name, operator: values.operator, redirectTo };
}

function trustedOrigins(): string[] {
  return (process.env['AUTH_TRUSTED_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

async function main(): Promise<void> {
  const input = readInput();
  const auth = await createAuth({
    databaseUrl: env('AUTH_DATABASE_URL'),
    secret: env('BETTER_AUTH_SECRET'),
    baseURL: env('BETTER_AUTH_URL'),
    trustedOrigins: trustedOrigins(),
    ids: systemUuidV7(),
    secureCookies: env('BETTER_AUTH_URL').startsWith('https:'),
    onLog: ({ level, message }) => console.error('auth', level, message),
  });
  try {
    const { userId, link } = await createPlatformUser(auth, input);
    // The link is a one-time secret for this operator to hand over; it is printed once and written nowhere else.
    console.log('user created:', userId);
    console.log('one-time set-password link (valid 1 hour):', link);
  } finally {
    await auth.close();
  }
}

try {
  await main();
} catch (error) {
  console.error('platform:create-user failed:', describeFailure(error));
  process.exitCode = 1;
}
