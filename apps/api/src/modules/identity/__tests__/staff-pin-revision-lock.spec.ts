import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { present } from '../../../../../../packages/db/test/present.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { takeTestEmployeeNumber } from '../../../../test/test-employee-number.ts';
import { createRedisPinAttempts } from '../persistence/redis-pin-attempts.ts';
import { createStaffEligibility } from '../persistence/staff-eligibility.ts';
import { createStaffPinProofIssuer } from '../persistence/staff-pin-proofs.ts';
import { createStaffPinTransactions } from '../persistence/staff-pin-transactions.ts';
import { authPinHasher } from '../persistence/auth-pin-hasher.ts';
import type { StaffPinTransactions } from '../ports/staff-pins.port.ts';
import { OpenPrivateView } from '../use-cases/open-private-view/open-private-view.ts';
import { ResetStaffPin } from '../use-cases/reset-staff-pin/reset-staff-pin.ts';
import { SignInStaffPin } from '../use-cases/sign-in-staff-pin/sign-in-staff-pin.ts';

const ids = systemUuidV7();
const ownPin = '1234';
const nextPin = '5678';
const phone = '+99900000077';

let h: Harness;
let locker: postgres.Sql;
let manager: string;
let actor: string;
let company: string;
let business: string;
let branch: string;
let device: Awaited<ReturnType<typeof paired>>;
let userId: string;
let staffCookie: string;

beforeAll(async () => {
  h = await startHarness({ staffOrigin: origin, staffAccessRoutes: true });
  locker = postgres(h.ownerUrl, { max: 2, onnotice: () => undefined });
  manager = await h.signedInOperator('pin-lock-manager@synthetic.invalid');
  actor = present(await h.auth.getSession(new Headers({ cookie: manager }))).userId;
  company = await h.onboard(manager, 'Synthetic PIN Lock');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'pin-lock-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  branch = (
    await h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: manager,
      company,
      key: 'pin-lock-branch',
      body: { name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  device = await paired(h, manager, company, branch);
  userId = await h.auth.provisionUser({
    email: 'pin-lock-user@synthetic.invalid',
    name: 'Synthetic staff',
    password: 'synthetic'.repeat(8),
  });
  await h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
  const employeeId = randomUUID();
  await h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${company},${employeeId},${business},${branch},${userId},'Synthetic staff',${employeeNameMatchKey('Synthetic staff')},'staff','2026-01-01',${takeTestEmployeeNumber(company)})`;
  await h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${company},${randomUUID()},${business},${employeeId},${branch},'2026-01-01')`;
  expect(
    (
      await h.send('POST', '/v1/staff-pins/reset', {
        cookie: manager,
        company,
        body: { user_id: userId, pin: ownPin },
      })
    ).status,
  ).toBe(204);
  const signedIn = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone, pin: ownPin },
  });
  expect(signedIn.statusCode).toBe(200);
  staffCookie = present(String(signedIn.headers['set-cookie']).split(';')[0]);
});

afterAll(async () => {
  await locker?.end({ timeout: 2 });
  await h?.close();
});

async function waitForBlockedLock(): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [row] = await h.owner`
      SELECT count(*)::int AS n FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted AND a.datname = current_database()`;
    if ((row?.['n'] ?? 0) >= 1) return;
    if (Date.now() > deadline) throw new Error('LOCK_WAITER_NOT_SEEN');
  }
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function wrapPinDb(hooks: {
  afterFindLocked?: () => Promise<void>;
  beforeFindLocked?: () => Promise<void>;
  afterTxCommit?: () => void;
}): StaffPinTransactions {
  const real = createStaffPinTransactions(h.app.get(DATABASE), ids);
  return {
    run: async (companyId, runActor, work) => {
      let lockedInTx = false;
      const result = await real.run(companyId, runActor, (scope) =>
        work({
          ...scope,
          findLocked: async (targetUserId) => {
            lockedInTx = true;
            await hooks.beforeFindLocked?.();
            const row = await scope.findLocked(targetUserId);
            await hooks.afterFindLocked?.();
            return row;
          },
        }),
      );
      if (lockedInTx) hooks.afterTxCommit?.();
      return result;
    },
  };
}

function deviceContext() {
  return { companyId: company, businessId: business, branchId: branch, deviceId: device.id };
}

async function resetWith(pin: string) {
  const useCase = new ResetStaffPin(
    createStaffPinTransactions(h.app.get(DATABASE), ids),
    authPinHasher,
    { now: () => new Date() },
  );
  return useCase.execute({ companyId: company, actor, target: userId, pin });
}

it('OpenPrivateView holds FOR SHARE on cashier_pins until commit, blocking a concurrent reset (#792)', async () => {
  const entered = gate();
  const proceed = gate();
  const events: string[] = [];
  const db = wrapPinDb({
    afterFindLocked: async () => {
      entered.open();
      await proceed.promise;
    },
    afterTxCommit: () => events.push('tx:committed'),
  });
  const useCase = new OpenPrivateView(
    db,
    createRedisPinAttempts(h.redis, ids),
    createStaffEligibility(h.app.get(DATABASE)),
    present(h.auth.privateView),
  );
  const session = present(
    await present(h.auth.staff).resolve(new Headers({ cookie: staffCookie }), deviceContext()),
  );
  const opening = useCase.execute({ pin: ownPin, session });
  try {
    await entered.promise;
    const resetting = resetWith(nextPin).then((ok) => {
      events.push(`reset:${ok}`);
      return ok;
    });
    await waitForBlockedLock();
    expect(events).toEqual([]);
    proceed.open();
    await expect(opening).resolves.toMatchObject({ kind: 'opened' });
    await expect(resetting).resolves.toBe(true);
    expect(events).toEqual(['tx:committed', 'reset:true']);
  } finally {
    proceed.open();
    await resetWith(ownPin);
  }
});

it('OpenPrivateView waits on a concurrent PIN reset, observes the new revision, and refuses without audit (#792)', async () => {
  const lockAcquired = gate();
  const releaseReset = gate();
  const db = wrapPinDb({
    beforeFindLocked: async () => {
      await lockAcquired.promise;
    },
  });
  const auditsBefore =
    await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id=${company} AND action='staff.private_view_opened'`;
  const useCase = new OpenPrivateView(
    db,
    createRedisPinAttempts(h.redis, ids),
    createStaffEligibility(h.app.get(DATABASE)),
    present(h.auth.privateView),
  );
  const session = present(
    await present(h.auth.staff).resolve(new Headers({ cookie: staffCookie }), deviceContext()),
  );
  const resetTx = locker.begin(async (tx) => {
    await tx`UPDATE cashier_pins SET id=${randomUUID()} WHERE company_id=${company} AND user_id=${userId}`;
    lockAcquired.open();
    await releaseReset.promise;
  });
  const opening = useCase.execute({ pin: ownPin, session });
  try {
    await lockAcquired.promise;
    await waitForBlockedLock();
  } finally {
    lockAcquired.open();
    releaseReset.open();
    await resetTx.catch(() => undefined);
  }
  await expect(opening).resolves.toEqual({ kind: 'refused' });
  const auditsAfter =
    await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id=${company} AND action='staff.private_view_opened'`;
  expect(auditsAfter[0]?.['n']).toBe(auditsBefore[0]?.['n']);
});

it('SignInStaffPin holds FOR SHARE on cashier_pins until commit, blocking a concurrent reset (#792)', async () => {
  const entered = gate();
  const proceed = gate();
  const events: string[] = [];
  const db = wrapPinDb({
    afterFindLocked: async () => {
      entered.open();
      await proceed.promise;
    },
    afterTxCommit: () => events.push('tx:committed'),
  });
  const useCase = new SignInStaffPin(
    db,
    authPinHasher,
    createRedisPinAttempts(h.redis, ids),
    { sessions: present(h.auth.staff), ...createStaffEligibility(h.app.get(DATABASE)) },
    createStaffPinProofIssuer(),
    { now: () => new Date() },
    ids,
    true,
  );
  const signingIn = useCase.execute({ phone, pin: ownPin, device: deviceContext() });
  try {
    await entered.promise;
    const resetting = resetWith(nextPin).then((ok) => {
      events.push(`reset:${ok}`);
      return ok;
    });
    await waitForBlockedLock();
    expect(events).toEqual([]);
    proceed.open();
    await expect(signingIn).resolves.not.toBeNull();
    await expect(resetting).resolves.toBe(true);
    expect(events).toEqual(['tx:committed', 'reset:true']);
  } finally {
    proceed.open();
    await resetWith(ownPin);
  }
});

it('SignInStaffPin waits on a concurrent PIN reset, sees the new revision, and refuses without issuing session or audit (#792)', async () => {
  const lockAcquired = gate();
  const releaseReset = gate();
  const db = wrapPinDb({
    beforeFindLocked: async () => {
      await lockAcquired.promise;
    },
  });
  const auditsBefore =
    await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id=${company} AND action='staff.pin_signed_in'`;
  const sessionsBefore =
    await h.owner`SELECT id FROM session WHERE user_id=${userId} AND purpose='STAFF_POS' ORDER BY id`;
  const useCase = new SignInStaffPin(
    db,
    authPinHasher,
    createRedisPinAttempts(h.redis, ids),
    { sessions: present(h.auth.staff), ...createStaffEligibility(h.app.get(DATABASE)) },
    createStaffPinProofIssuer(),
    { now: () => new Date() },
    ids,
    true,
  );
  const resetTx = locker.begin(async (tx) => {
    await tx`UPDATE cashier_pins SET id=${randomUUID()} WHERE company_id=${company} AND user_id=${userId}`;
    lockAcquired.open();
    await releaseReset.promise;
  });
  const signingIn = useCase.execute({ phone, pin: ownPin, device: deviceContext() });
  try {
    await lockAcquired.promise;
    await waitForBlockedLock();
  } finally {
    lockAcquired.open();
    releaseReset.open();
    await resetTx.catch(() => undefined);
  }
  await expect(signingIn).resolves.toBeNull();
  const auditsAfter =
    await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id=${company} AND action='staff.pin_signed_in'`;
  expect(auditsAfter[0]?.['n']).toBe(auditsBefore[0]?.['n']);
  const sessionsAfter =
    await h.owner`SELECT id FROM session WHERE user_id=${userId} AND purpose='STAFF_POS' ORDER BY id`;
  expect(sessionsAfter).toEqual(sessionsBefore);
});
