import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { grantPlatformPermission } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import { assertDevelopmentTarget } from './demo-guard.ts';
import {
  createTenant,
  enrolTotp,
  insertBranchMembership,
  openAuth,
  provisionUser,
  readSeedTarget,
  type SeedTarget,
  type SeedTenant,
  type SeedUser,
} from './seed-e2e-tenant.ts';

const statePath = join(dirname(fileURLToPath(import.meta.url)), '../../admin/e2e/.state/session.env');

function suffix(): string {
  return `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}

function grantOwner(target: SeedTarget, email: string): Promise<unknown> {
  return grantPlatformPermission(
    target.migrationUrl,
    { email, permission: 'create:companies:platform', operator: 'e2e-seed' },
    systemUuidV7(),
  );
}

function catalogEntries(home: SeedTenant): Record<string, string> {
  const standard = home.services[0];
  const odd = home.services[1];
  if (standard === undefined || odd === undefined || home.employees.length !== 4) {
    throw new Error('e2e:seed catalog missing');
  }
  const entries: Record<string, string> = {
    STANDARD_SERVICE_ID: standard.id,
    STANDARD_SERVICE_NAME: standard.name,
    ODD_SERVICE_ID: odd.id,
    ODD_SERVICE_NAME: odd.name,
  };
  for (const [index, employee] of home.employees.entries()) {
    entries[`EMPLOYEE_${index + 1}_ID`] = employee.id;
    entries[`EMPLOYEE_${index + 1}_NAME`] = employee.name;
  }
  return entries;
}

function stateText(
  target: SeedTarget,
  owner: SeedUser,
  recorder: SeedUser,
  secret: string,
  other: SeedUser,
  home: SeedTenant,
  foreign: SeedTenant,
): string {
  const entries: Record<string, string> = {
    API_BASE: target.apiBase,
    ORIGIN: target.origin,
    OWNER_EMAIL: owner.email,
    OWNER_PASSWORD: owner.password,
    RECORDER_EMAIL: recorder.email,
    RECORDER_PASSWORD: recorder.password,
    RECORDER_TOTP_SECRET: secret,
    OTHER_EMAIL: other.email,
    OTHER_PASSWORD: other.password,
    COMPANY_ID: home.companyId,
    COMPANY_NAME: home.companyName,
    BUSINESS_ID: home.businessId,
    BRANCH_ID: home.branchId,
    BRANCH_NAME: home.branchName,
    OTHER_COMPANY_ID: foreign.companyId,
    OTHER_COMPANY_NAME: foreign.companyName,
    OTHER_BUSINESS_ID: foreign.businessId,
    OTHER_BRANCH_ID: foreign.branchId,
    OTHER_BRANCH_NAME: foreign.branchName,
    ...catalogEntries(home),
  };
  return `${Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

async function writeState(text: string): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, text, { mode: 0o600 });
}

async function seed(): Promise<void> {
  assertDevelopmentTarget(process.env);
  const target = readSeedTarget(process.env);
  const auth = await openAuth(target);
  try {
    const tag = suffix();
    const owner = await provisionUser(auth, target, `e2e-owner-${tag}@example.test`, `E2E Owner ${tag}`);
    await grantOwner(target, owner.email);
    const home = await createTenant(target, owner.cookie, `${tag} Home`, true);
    const recorder = await provisionUser(
      auth,
      target,
      `e2e-recorder-${tag}@example.test`,
      `E2E Recorder ${tag}`,
    );
    const secret = await enrolTotp(target, recorder);
    const other = await provisionUser(auth, target, `e2e-other-${tag}@example.test`, `E2E Other ${tag}`);
    await grantOwner(target, other.email);
    const foreign = await createTenant(target, other.cookie, `${tag} Other`, false);
    await insertBranchMembership(target.migrationUrl, {
      companyId: home.companyId,
      userId: recorder.userId,
      roleCode: 'cashier',
      branchId: home.branchId,
      limitBps: 1000,
    });
    // A viewer membership makes the foreign branch selectable. Viewer cannot record, so the context is 403.
    await insertBranchMembership(target.migrationUrl, {
      companyId: foreign.companyId,
      userId: recorder.userId,
      roleCode: 'viewer',
      branchId: foreign.branchId,
      limitBps: null,
    });
    await writeState(stateText(target, owner, recorder, secret, other, home, foreign));
  } finally {
    await auth.close();
  }
}

try {
  await seed();
  console.log('e2e seed wrote apps/admin/e2e/.state/session.env');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const safe = /^(seed |e2e:seed|demo:seed)/u.test(message);
  console.error(safe ? message : 'e2e:seed failed');
  process.exitCode = 1;
}
