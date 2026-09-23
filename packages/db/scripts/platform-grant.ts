import { parseArgs } from 'node:util';

import { systemUuidV7 } from '@pospay/ids';

import { PERMISSIONS } from '../src/access-catalog.ts';
import { grantPlatformPermission, revokePlatformPermission } from '../src/platform-grants.ts';

// pnpm platform:grant --email <e> --permission create:companies:platform --operator <name> [--expires <iso>] [--revoke]
// Runs as pospay_owner (MIGRATION_DATABASE_URL); never reachable through the API (ADR-0003 §3).
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    permission: { type: 'string' },
    operator: { type: 'string' },
    expires: { type: 'string' },
    revoke: { type: 'boolean', default: false },
  },
});
const url = process.env['MIGRATION_DATABASE_URL'];
const platform = PERMISSIONS.filter((p) => p.endsWith(':platform')) as readonly string[];
if (url === undefined || url === '') throw new Error('MIGRATION_DATABASE_URL is not set — see .env.example');
if (values.email === undefined || values.operator === undefined) {
  throw new Error('usage: --email <email> --permission <platform permission> --operator <your name>');
}
if (values.permission === undefined || !platform.includes(values.permission)) {
  throw new Error(`--permission must be one of: ${platform.join(', ')}`);
}
const expiresAt = values.expires === undefined ? undefined : new Date(values.expires);
if (expiresAt !== undefined && Number.isNaN(expiresAt.getTime())) throw new Error('--expires is not a date');

const request = { email: values.email, permission: values.permission, operator: values.operator };
const outcome = values.revoke
  ? await revokePlatformPermission(url, request, systemUuidV7())
  : await grantPlatformPermission(url, { ...request, ...(expiresAt ? { expiresAt } : {}) }, systemUuidV7());
console.log(`platform grant: ${outcome.status}`);
