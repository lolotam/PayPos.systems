import { parseArgs } from 'node:util';

import { systemUuidV7 } from '@pospay/ids';

import { PERMISSIONS } from '../src/access-catalog.ts';
import { grantPlatformPermission, revokePlatformPermission } from '../src/platform-grants.ts';
import { describeFailure } from './failure.ts';

// pnpm platform:grant --email <e> --permission create:companies:platform --operator <name> [--expires <iso>] [--revoke]
// Runs as pospay_owner (MIGRATION_DATABASE_URL); never reachable through the API (ADR-0003 §3).
class OperatorInputError extends Error {
  override readonly name = 'OperatorInputError';
}

const PLATFORM = PERMISSIONS.filter((p) => p.endsWith(':platform')) as readonly string[];

function readInput() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      permission: { type: 'string' },
      operator: { type: 'string' },
      expires: { type: 'string' },
      revoke: { type: 'boolean', default: false },
    },
  });
  const { email, operator, permission } = values;
  if (email === undefined || operator === undefined || operator.trim() === '') {
    throw new OperatorInputError(
      'usage: --email <email> --permission <platform permission> --operator <your name>',
    );
  }
  if (permission === undefined || !PLATFORM.includes(permission)) {
    throw new OperatorInputError(`--permission must be one of: ${PLATFORM.join(', ')}`);
  }
  const expiresAt = values.expires === undefined ? undefined : new Date(values.expires);
  if (expiresAt !== undefined && Number.isNaN(expiresAt.getTime())) {
    throw new OperatorInputError('--expires is not a date');
  }
  return { request: { email, permission, operator }, expiresAt, revoke: values.revoke };
}

async function main(): Promise<void> {
  const url = process.env['MIGRATION_DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new OperatorInputError('MIGRATION_DATABASE_URL is not set — see .env.example');
  }
  const { request, expiresAt, revoke } = readInput();
  const outcome = revoke
    ? await revokePlatformPermission(url, request, systemUuidV7())
    : await grantPlatformPermission(
        url,
        { ...request, ...(expiresAt === undefined ? {} : { expiresAt }) },
        systemUuidV7(),
      );
  console.log('platform grant:', outcome.status);
}

try {
  await main();
} catch (error) {
  console.error('platform:grant failed:', describeFailure(error));
  process.exitCode = 1;
}
