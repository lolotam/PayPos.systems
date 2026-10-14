import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { grantPlatformPermission } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { totpCode } from './seed-e2e-support.ts';

import { createTenant, type SeedTenant } from './seed-e2e-catalog.ts';
import { approveLeave } from './seed-e2e-leave.ts';
import { insertMemberships } from './seed-e2e-membership.ts';
import {
  enrolTotp,
  openAuth,
  provisionUser,
  readSeedTarget,
  type SeedTarget,
  type SeedUser,
} from './seed-e2e-http.ts';

const statePath = join(dirname(fileURLToPath(import.meta.url)), '../../admin/e2e/.state/session.env');
// RFC 6238 Appendix B: المفتاح العام المنشور للاختبار ("12345678901234567890" بـ base32)، مش سر.
const VECTOR_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function suffix(): string {
  return `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}

function assertTotpVector(): void {
  const at = new Date(59_000);
  if (totpCode(VECTOR_SECRET, at, 8) !== '94287082' || totpCode(VECTOR_SECRET, at) !== '287082') {
    throw new Error('e2e:seed totp vector mismatch');
  }
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
  const onLeave = home.employees[0];
  if (standard === undefined || odd === undefined || onLeave === undefined || home.employees.length !== 4) {
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
  memberships: readonly string[],
): string {
  const primary = memberships[0];
  const narrow = memberships[1];
  if (primary === undefined || narrow === undefined) throw new Error('e2e:seed membership missing');
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
    RECORDER_MEMBERSHIP_ID: primary,
    NARROW_MEMBERSHIP_ID: narrow,
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

async function provision(target: SeedTarget, auth: Awaited<ReturnType<typeof openAuth>>): Promise<string> {
  const tag = suffix();
  const owner = await provisionUser(auth, target, `e2e-owner-${tag}@example.test`, `E2E Owner ${tag}`);
  await grantOwner(target, owner.email);
  const home = await createTenant(target, owner.cookie, `${tag} Home`, true);
  const recorder = await provisionUser(auth, target, `e2e-recorder-${tag}@example.test`, `E2E Recorder ${tag}`);
  const secret = await enrolTotp(target, recorder);
  const other = await provisionUser(auth, target, `e2e-other-${tag}@example.test`, `E2E Other ${tag}`);
  await grantOwner(target, other.email);
  const foreign = await createTenant(target, other.cookie, `${tag} Other`, false);
  const memberships = await insertMemberships(target.migrationUrl, [
    { companyId: home.companyId, userId: recorder.userId, roleCode: 'cashier', branchId: home.branchId, limitBps: 1000 },
    { companyId: home.companyId, userId: recorder.userId, roleCode: 'cashier', branchId: home.branchId, limitBps: 500 },
    { companyId: foreign.companyId, userId: recorder.userId, roleCode: 'viewer', branchId: foreign.branchId, limitBps: null },
  ]);
  const onLeave = home.employees[0];
  if (onLeave === undefined) throw new Error('e2e:seed catalog missing');
  await approveLeave(target, owner.cookie, {
    companyId: home.companyId,
    businessId: home.businessId,
    branchId: home.branchId,
    employeeId: onLeave.id,
    timeZone: home.timeZone,
  });
  return stateText(target, owner, recorder, secret, other, home, foreign, memberships);
}

async function seed(): Promise<void> {
  assertTotpVector();
  const target = readSeedTarget(process.env);
  const auth = await openAuth(target);
  try {
    await writeState(await provision(target, auth));
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
