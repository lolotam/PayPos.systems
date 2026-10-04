import { present } from '../../../db/test/present.ts';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import {
  createAuth,
  type AttendanceScope,
  type AuthLogEntry,
  type AuthService,
  type EnrollmentScope,
} from '../index.ts';
import { testAuthenticator } from './webauthn.fixture.ts';

const ids = systemUuidV7();
const origin = 'https://pos.pospay.systems';
const baseURL = 'https://api.pospay.systems';
let database: TestDatabase;
let owner: postgres.Sql;
let auth: AuthService;
let now = new Date();
const activeBindings = new Set<string>();
const logs: AuthLogEntry[] = [];
const scope: EnrollmentScope = {
  userId: ids.newId(),
  sessionId: ids.newId(),
  companyId: ids.newId(),
  businessId: ids.newId(),
  employeeId: ids.newId(),
};
beforeAll(async () => {
  database = await createTestDatabase();
  owner = postgres(database.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id,name,email) VALUES(${scope.userId},'Synthetic staff','passkey@example.test')`;
  auth = await createAuth({
    passkeyBindings: { forUser: async () => [...activeBindings] },
    databaseUrl: database.authUrl,
    staffPhoneLockKey: () => 1n,
    secret: 'synthetic-passkey-secret-more-than-32-characters',
    baseURL,
    trustedOrigins: [origin],
    ids,
    secureCookies: true,
    onLog: (entry) => logs.push(entry),
    clock: { now: () => now },
  });
});
afterAll(async () => {
  await auth?.close();
  await owner?.end();
  await database?.drop();
});

it.each(['missing UV', 'staging origin', 'wrong RP', 'wrong challenge', 'wrong user', 'expired'])(
  'registration refuses %s before storing a credential',
  async (failure) => {
    const device = testAuthenticator();
    const generated = await auth.passkeys.enrollmentOptions(scope);
    const response = device.registration(
      failure === 'wrong challenge' ? 'a'.repeat(43) : generated.options.challenge,
      failure === 'staging origin' ? 'https://pos.staging.pospay.systems' : origin,
      failure === 'wrong RP' ? 'other.test' : 'pospay.systems',
      failure !== 'missing UV',
    );
    if (failure === 'expired') now = new Date(now.getTime() + 120001);
    const requestScope = failure === 'wrong user' ? { ...scope, userId: ids.newId() } : scope;
    expect(await auth.passkeys.enroll(requestScope, generated.challengeId, response)).toBeNull();
    now = new Date();
    expect(await owner`SELECT id FROM passkey`).toHaveLength(0);
  },
);

it('stores through the plugin adapter, refuses replay and verifies fresh single-operation attendance proofs', async () => {
  const device = testAuthenticator();
  const generated = await auth.passkeys.enrollmentOptions(scope);
  expect(generated.options).toMatchObject({
    attestation: 'none',
    rp: { id: 'pospay.systems' },
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
  });
  const response = device.registration(generated.options.challenge, origin, 'pospay.systems');
  const passkeyId = await auth.passkeys.enroll(scope, generated.challengeId, response);
  expect(passkeyId).toMatch(/^[a-f0-9-]{36}$/);
  expect(await auth.passkeys.enroll(scope, generated.challengeId, response)).toBeNull();
  const clockScope: AttendanceScope = {
    ...scope,
    passkeyId: present(passkeyId),
    bindingId: ids.newId(),
    bindingRevision: 1,
    branchId: ids.newId(),
    operation: 'CLOCK_IN',
    qrContext: ids.newId(),
  };
  await rejectedAssertions(clockScope, device);
  const clock = await auth.passkeys.attendanceOptions(clockScope);
  const assertion = device.assertion(clock.options.challenge, origin, 'pospay.systems', true, 1);
  const results = await Promise.all([
    auth.passkeys.verifyAttendance(clockScope, clock.challengeId, assertion),
    auth.passkeys.verifyAttendance(clockScope, clock.challengeId, assertion),
  ]);
  const proof = present(results.find((result) => result !== null));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(proof.consume({ ...clockScope, bindingRevision: 2 })).toBe(false);
  expect(proof.consume(clockScope)).toBe(false);
  const zero = await auth.passkeys.attendanceOptions(clockScope);
  // counter=0 مدعوم قبل تقدم العداد؛ بعد تقدمه ترفض المكتبة الرجوع إلى الصفر.
  expect(
    await auth.passkeys.verifyAttendance(
      clockScope,
      zero.challengeId,
      device.assertion(zero.options.challenge, origin, 'pospay.systems', true, 0),
    ),
  ).toBeNull();
  await acceptedProofs(clockScope, device);
  expect(JSON.stringify(logs)).not.toContain(response.id);
  expect(JSON.stringify(logs)).not.toContain(response.response.attestationObject);
  expect(JSON.stringify(logs)).not.toContain(generated.options.challenge);
});

it.each([
  'generate-register-options',
  'verify-registration',
  'generate-authenticate-options',
  'verify-authentication',
  'list-user-passkeys',
  'delete-passkey',
  'update-passkey',
])('rejects the generic plugin route %s', async (path) => {
  const response = await auth.handler(
    new Request(`${baseURL}/v1/auth/passkey/${path}`, { headers: { origin } }),
  );
  expect(response.status).toBe(403);
});

it('synced backup credentials support fresh assertions with zero counters', async () => {
  const device = testAuthenticator(true);
  const generated = await auth.passkeys.enrollmentOptions(scope);
  const passkeyId = present(
    await auth.passkeys.enroll(
      scope,
      generated.challengeId,
      device.registration(generated.options.challenge, origin, 'pospay.systems'),
    ),
  );
  const clockScope: AttendanceScope = {
    ...scope,
    passkeyId,
    bindingId: ids.newId(),
    bindingRevision: 1,
    branchId: ids.newId(),
    operation: 'CLOCK_OUT',
    qrContext: ids.newId(),
  };
  for (let index = 0; index < 2; index++) {
    const clock = await auth.passkeys.attendanceOptions(clockScope);
    const proof = present(
      await auth.passkeys.verifyAttendance(
        clockScope,
        clock.challengeId,
        device.assertion(clock.options.challenge, origin, 'pospay.systems', true, 0),
      ),
    );
    expect(proof.consume(clockScope)).toBe(true);
    expect(proof.consume(clockScope)).toBe(false);
  }
  expect(
    await owner`SELECT device_type,backed_up,counter FROM passkey WHERE id=${passkeyId}`,
  ).toMatchObject([{ device_type: 'multiDevice', backed_up: true, counter: '0' }]);
});

it('credential grants belong only to auth; tenant and messaging roles cannot read or mutate global keys', async () => {
  for (const url of [database.appUrl, database.dispatcherUrl, database.notificationsUrl]) {
    const client = postgres(url, { max: 1, onnotice: () => undefined });
    try {
      await expect(client`SELECT id FROM passkey`).rejects.toThrow();
      await expect(client`UPDATE passkey SET counter=0`).rejects.toThrow();
      await expect(client`DELETE FROM passkey`).rejects.toThrow();
      await expect(client`INSERT INTO passkey(id,user_id,credential_id,public_key,counter,device_type,backed_up)
        VALUES(${ids.newId()},${scope.userId},'synthetic','synthetic',0,'singleDevice',false)`).rejects.toThrow();
    } finally {
      await client.end();
    }
  }
  const authRole = postgres(database.authUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await authRole`SELECT id FROM passkey`).toHaveLength(2);
    await expect(authRole`SELECT id FROM employee_passkeys`).rejects.toThrow();
    const [grants] =
      await authRole`SELECT has_table_privilege(current_user,'passkey','SELECT') AS read,
      has_table_privilege(current_user,'passkey','INSERT') AS insert,
      has_table_privilege(current_user,'passkey','UPDATE') AS update,
      has_table_privilege(current_user,'passkey','DELETE') AS delete,
      has_table_privilege(current_user,'passkey','REFERENCES,TRIGGER,TRUNCATE') AS excess`;
    expect(grants).toEqual({ read: true, insert: true, update: true, delete: true, excess: false });
  } finally {
    await authRole.end();
  }
});

it('excludes active bindings only; inert, unbound and foreign-user credentials stay out', async () => {
  const credentials =
    await owner`SELECT id,credential_id FROM passkey WHERE user_id=${scope.userId} ORDER BY id`;
  const active = present(credentials[0]);
  activeBindings.add(String(active['id']));
  const foreignUser = ids.newId(),
    foreignKey = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${foreignUser},'Synthetic foreign staff','foreign-passkey@example.test')`;
  await owner`INSERT INTO passkey(id,user_id,credential_id,public_key,counter,device_type,backed_up)
    SELECT ${foreignKey},${foreignUser},'synthetic-foreign-credential',public_key,0,'singleDevice',false
    FROM passkey WHERE id=${active['id']}`;
  activeBindings.add(foreignKey);
  const generated = await auth.passkeys.enrollmentOptions(scope);
  expect(generated.options.excludeCredentials).toEqual([
    { id: active['credential_id'], type: 'public-key', transports: ['internal'] },
  ]);
  activeBindings.clear();
  expect((await auth.passkeys.enrollmentOptions(scope)).options.excludeCredentials).toEqual([]);
});

it('the frozen attendance scope compares by content, not by object key order', async () => {
  const device = testAuthenticator(true);
  const generated = await auth.passkeys.enrollmentOptions(scope);
  const passkeyId = present(
    await auth.passkeys.enroll(
      scope,
      generated.challengeId,
      device.registration(generated.options.challenge, origin, 'pospay.systems'),
    ),
  );
  const clockScope: AttendanceScope = {
    ...scope,
    passkeyId,
    bindingId: ids.newId(),
    bindingRevision: 1,
    branchId: ids.newId(),
    operation: 'CLOCK_IN',
    qrContext: ids.newId(),
  };
  const reversed = (value: AttendanceScope) =>
    Object.fromEntries(Object.entries(value).reverse()) as AttendanceScope;
  const prove = async (verifyScope: AttendanceScope) => {
    const clock = await auth.passkeys.attendanceOptions(clockScope);
    return auth.passkeys.verifyAttendance(
      verifyScope,
      clock.challengeId,
      device.assertion(clock.options.challenge, origin, 'pospay.systems', true, 0),
    );
  };
  const proof = present(await prove(reversed(clockScope)));
  expect(proof.consume(reversed(clockScope))).toBe(true);
  expect(await prove(reversed({ ...clockScope, operation: 'CLOCK_OUT' }))).toBeNull();
  const changed = present(await prove(reversed(clockScope)));
  expect(changed.consume(reversed({ ...clockScope, bindingRevision: 2 }))).toBe(false);
});

async function rejectedAssertions(
  clockScope: AttendanceScope,
  device: ReturnType<typeof testAuthenticator>,
) {
  for (const failure of [
    'missing UV',
    'staging origin',
    'wrong RP',
    'unknown credential',
    'wrong revision',
    'expired',
  ]) {
    const clock = await auth.passkeys.attendanceOptions(clockScope);
    const assertion = device.assertion(
      clock.options.challenge,
      failure === 'staging origin' ? 'https://pos.staging.pospay.systems' : origin,
      failure === 'wrong RP' ? 'wrong.test' : 'pospay.systems',
      failure !== 'missing UV',
    );
    if (failure === 'unknown credential') assertion.id = 'unknown';
    if (failure === 'expired')
      await owner`UPDATE verification SET expires_at=now()-interval '1 second' WHERE identifier=${`staff-clock:${clock.challengeId}`}`;
    expect(
      await auth.passkeys.verifyAttendance(
        failure === 'wrong revision' ? { ...clockScope, bindingRevision: 2 } : clockScope,
        clock.challengeId,
        assertion,
      ),
    ).toBeNull();
    expect(
      await auth.passkeys.verifyAttendance(
        clockScope,
        clock.challengeId,
        device.assertion(clock.options.challenge, origin, 'pospay.systems'),
      ),
    ).toBeNull();
  }
}

async function acceptedProofs(
  clockScope: AttendanceScope,
  device: ReturnType<typeof testAuthenticator>,
) {
  const verify = async (counter: number) => {
    const generated = await auth.passkeys.attendanceOptions(clockScope);
    return present(
      await auth.passkeys.verifyAttendance(
        clockScope,
        generated.challengeId,
        device.assertion(generated.options.challenge, origin, 'pospay.systems', true, counter),
      ),
    );
  };
  const valid = await verify(2);
  expect(valid.consume(clockScope)).toBe(true);
  expect(valid.consume(clockScope)).toBe(false);
  const expired = await verify(3);
  now = new Date(now.getTime() + 120001);
  expect(expired.consume(clockScope)).toBe(false);
  now = new Date();
  const challenges = await Promise.all([
    auth.passkeys.attendanceOptions(clockScope),
    auth.passkeys.attendanceOptions(clockScope),
  ]);
  const proofs = await Promise.all(
    challenges.map((generated) =>
      auth.passkeys.verifyAttendance(
        clockScope,
        generated.challengeId,
        device.assertion(generated.options.challenge, origin, 'pospay.systems', true, 4),
      ),
    ),
  );
  expect(proofs.filter(Boolean)).toHaveLength(1);
}
