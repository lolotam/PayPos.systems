import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

import { approvePhoneBinding, createAuth, createPlatformUser } from '@pospay/auth';
import { readStagingStaffIdentity } from '@pospay/auth/operator/staging-staff';
import { canonicalStaffPhone } from '@pospay/contracts';
import {
  ensureEmployeeUserLink,
  ensureStaffBranchMembership,
  StagingStaffRefusal,
} from '@pospay/db/operator/staging-staff';
import { systemUuidV7 } from '@pospay/ids';
import { phoneLockKey } from '@pospay/notifications';

import { assertStagingTarget, OperatorInputError } from './staging-staff-guard.ts';

type CliInput = {
  target: string;
  companyId: string;
  businessId: string;
  branchId: string;
  employeeId?: string;
  phone: string;
  name: string;
  operator: string;
};
type Identity = Awaited<ReturnType<typeof readStagingStaffIdentity>>;

class IdentityConflictError extends Error {}
class BackOfficeOriginError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATOR = /^[a-zA-Z][a-zA-Z0-9_.-]{1,63}$/;

function readInput(argv: string[]): CliInput {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      target: { type: 'string' },
      company: { type: 'string' },
      business: { type: 'string' },
      branch: { type: 'string' },
      employee: { type: 'string' },
      phone: { type: 'string' },
      name: { type: 'string' },
      operator: { type: 'string' },
    },
  });
  const phone = canonicalStaffPhone.safeParse(values.phone);
  const ids = [values.company, values.business, values.branch];
  if (
    values.target === undefined ||
    values.name === undefined ||
    values.name.trim() === '' ||
    values.name.length > 255 ||
    values.operator === undefined ||
    !OPERATOR.test(values.operator) ||
    !ids.every((value) => value !== undefined && UUID.test(value)) ||
    (values.employee !== undefined && !UUID.test(values.employee)) ||
    !phone.success
  ) {
    throw new OperatorInputError('bad staging staff input');
  }
  return {
    target: values.target,
    companyId: (values.company ?? '').toLowerCase(),
    businessId: (values.business ?? '').toLowerCase(),
    branchId: (values.branch ?? '').toLowerCase(),
    ...(values.employee === undefined ? {} : { employeeId: values.employee.toLowerCase() }),
    phone: phone.data,
    name: values.name,
    operator: values.operator,
  };
}

function derivedEmail(input: CliInput): string {
  const digest = createHash('sha256')
    .update(`v1|${input.phone}|${input.companyId}|${input.businessId}|${input.branchId}`)
    .digest('hex')
    .slice(0, 48);
  return `staging-staff-${digest}@staging.pospay.invalid`;
}

function hasConflict(identity: Identity, phone: string): boolean {
  const user = identity.emailUser;
  if (user === null) return identity.phoneOwnerId !== null;
  return (
    (identity.phoneOwnerId !== null && identity.phoneOwnerId !== user.id) ||
    (user.phone !== null && user.phone !== phone)
  );
}

function backOfficeOrigin(env: NodeJS.ProcessEnv): string {
  for (const value of (env['AUTH_TRUSTED_ORIGINS'] ?? '').split(',')) {
    const origin = value.trim();
    try {
      if (new URL(origin).hostname.startsWith('app.')) return origin;
    } catch {
      // مدخل origin غير صالح لا يمكن أن يكون وجهة إدارية موثوقة.
    }
  }
  throw new BackOfficeOriginError();
}

async function createUser(
  input: CliInput,
  env: NodeJS.ProcessEnv,
  email: string,
): Promise<Identity> {
  const redirectTo = backOfficeOrigin(env);
  const ids = systemUuidV7();
  const baseURL = env['BETTER_AUTH_URL'] ?? '';
  const auth = await createAuth({
    staffPhoneLockKey: phoneLockKey,
    databaseUrl: env['AUTH_DATABASE_URL'] ?? '',
    secret: env['BETTER_AUTH_SECRET'] ?? '',
    baseURL,
    trustedOrigins: (env['AUTH_TRUSTED_ORIGINS'] ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
    ids,
    secureCookies: baseURL.startsWith('https:'),
    onLog: () => undefined,
  });
  try {
    const { userId } = await createPlatformUser(auth, {
      email,
      name: input.name,
      operator: input.operator,
      redirectTo,
    });
    return { emailUser: { id: userId, phone: null, phoneApproved: false }, phoneOwnerId: null };
  } finally {
    await auth.close();
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

async function ensureUser(
  input: CliInput,
  env: NodeJS.ProcessEnv,
  email: string,
  out: (line: string) => void,
): Promise<Identity> {
  let identity = await readStagingStaffIdentity({
    authDatabaseUrl: env['AUTH_DATABASE_URL'] ?? '',
    email,
    phone: input.phone,
  });
  if (hasConflict(identity, input.phone)) throw new IdentityConflictError();
  if (identity.emailUser !== null) {
    out(`user: unchanged ${identity.emailUser.id}`);
    return identity;
  }
  try {
    identity = await createUser(input, env, email);
    const userId = identity.emailUser?.id;
    if (userId === undefined) throw new Error('IDENTITY_RECONCILIATION_FAILED');
    out(`user: created ${userId}`);
    return identity;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    identity = await readStagingStaffIdentity({
      authDatabaseUrl: env['AUTH_DATABASE_URL'] ?? '',
      email,
      phone: input.phone,
    });
    if (hasConflict(identity, input.phone)) throw new IdentityConflictError();
    if (identity.emailUser === null) throw error;
    out(`user: unchanged ${identity.emailUser.id}`);
    return identity;
  }
}

async function run(
  input: CliInput,
  env: NodeJS.ProcessEnv,
  out: (line: string) => void,
): Promise<number> {
  const identity = await ensureUser(input, env, derivedEmail(input), out);
  const user = identity.emailUser;
  if (user === null) throw new Error('IDENTITY_RECONCILIATION_FAILED');
  if (user.phone === input.phone && user.phoneApproved) {
    out('phone binding: unchanged');
  } else {
    await approvePhoneBinding({
      databaseUrl: env['AUTH_DATABASE_URL'] ?? '',
      userId: user.id,
      phone: input.phone,
      operator: input.operator,
      ownershipVerified: true,
      approved: true,
      ids: systemUuidV7(),
      phoneLockKey,
      clock: { now: () => new Date() },
      isCanonicalPhone: (phone) => canonicalStaffPhone.safeParse(phone).success,
    });
    out('phone binding: approved');
  }
  const membership = await ensureStaffBranchMembership({
    appUrl: env['DATABASE_URL'] ?? '',
    ids: systemUuidV7(),
    companyId: input.companyId,
    businessId: input.businessId,
    branchId: input.branchId,
    userId: user.id,
    operator: input.operator,
  });
  out(`membership: ${membership}`);
  if (input.employeeId === undefined) {
    out('employee link: skipped');
  } else {
    const linked = await ensureEmployeeUserLink({
      appUrl: env['DATABASE_URL'] ?? '',
      ids: systemUuidV7(),
      companyId: input.companyId,
      businessId: input.businessId,
      employeeId: input.employeeId,
      userId: user.id,
      operator: input.operator,
    });
    out(`employee link: ${linked}`);
  }
  out(`next: set the PIN with POST /v1/staff-pins/reset for user ${user.id}`);
  return 0;
}

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  out: (line: string) => void,
): Promise<number> {
  let input: CliInput;
  try {
    input = readInput(argv);
  } catch {
    out('refused: bad input');
    return 1;
  }
  try {
    assertStagingTarget(input.target, env);
  } catch {
    out('refused: not staging');
    return 1;
  }
  if (
    env['STAFF_PHONE_OWNERSHIP_VERIFIED'] !== 'true' ||
    env['STAFF_PHONE_BINDING_APPROVED'] !== 'true'
  ) {
    out('refused: phone ownership not acknowledged');
    return 1;
  }
  try {
    return await run(input, env, out);
  } catch (error) {
    if (error instanceof StagingStaffRefusal) out(`refused: ${error.code}`);
    else if (error instanceof IdentityConflictError) out('refused: identity conflict');
    else if (error instanceof BackOfficeOriginError) out('refused: no back-office origin');
    else out(`failed: ${error instanceof Error ? error.constructor.name : 'Error'}`);
    return 1;
  }
}

if (import.meta.main)
  process.exitCode = await main(process.argv.slice(2), process.env, console.log);
