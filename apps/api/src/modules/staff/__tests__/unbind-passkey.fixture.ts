import { createPlatformUser, type EnrollmentScope } from '@pospay/auth';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { testAuthenticator } from '../../../../../../packages/auth/src/__tests__/webauthn.fixture.ts';
import { createPasskeyTransactions } from '../persistence/passkey-transactions.ts';
import { createUnbindPasskeyTransactions } from '../persistence/unbind-passkey-transactions.ts';
import { EnrolPasskey } from '../use-cases/enrol-passkey/enrol-passkey.ts';
import { UnbindPasskeyUseCase } from '../use-cases/unbind-passkey/unbind-passkey.usecase.ts';
import type { ManagerPasskeyScope } from '../ports/unbind-passkey.port.ts';
import { createAttendanceDeviceRefusals } from '../persistence/attendance-device-refusals.ts';

export type UnbindFixture = Awaited<ReturnType<typeof personalFixture>> & {
  manager: Awaited<ReturnType<typeof managerFor>>;
  enrol: EnrolPasskey;
  unbind: UnbindPasskeyUseCase;
  personal: EnrollmentScope;
  scope: ManagerPasskeyScope;
  url: string;
};
export async function unbindFixture(): Promise<UnbindFixture> {
  const f = await personalFixture();
  const manager = await managerFor(f, 'owner', 'COMPANY', f.companyId);
  const enrol = new EnrolPasskey(
    f.auth.passkeys,
    createPasskeyTransactions(f.database, f.ids),
    f.ids,
    { now: () => new Date() },
    createAttendanceDeviceRefusals(f.database, f.ids, () => undefined),
  );
  const clock = { now: () => new Date() };
  const unbind = new UnbindPasskeyUseCase(
    createUnbindPasskeyTransactions(f.database, f.ids, clock),
  );
  const personal = {
    companyId: f.companyId,
    businessId: f.businessId,
    employeeId: f.employeeId,
    userId: f.userId,
    sessionId: f.ids.newId(),
  };
  return {
    ...f,
    manager,
    enrol,
    unbind,
    personal,
    scope: { ...personal, userId: manager.userId },
    url: `/v1/businesses/${f.businessId}/employees/${f.employeeId}/passkeys`,
  };
}

export async function managerFor(
  f: Awaited<ReturnType<typeof personalFixture>>,
  role: string,
  scopeType: string,
  scopeId: string,
) {
  const label = f.ids.newId();
  const { link } = await createPlatformUser(f.auth, {
    email: `${label}@example.test`,
    name: 'Synthetic manager',
    operator: 'test',
    redirectTo: `${personalOrigin}/set-password`,
  });
  const token = new URL(link).pathname.split('/').pop();
  const post = (path: string, payload: object) =>
    f.app.inject({
      method: 'POST',
      url: `/v1/auth${path}`,
      headers: { origin: personalOrigin },
      payload,
    });
  await post('/reset-password', { token, newPassword: 'synthetic-manager-password' });
  const response = await post('/sign-in/email', {
    email: `${label}@example.test`,
    password: 'synthetic-manager-password',
  });
  const raw = response.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw : [String(raw)])
    .map((part) => part.split(';')[0])
    .join('; ');
  const [user] = await f.owner`SELECT id FROM "user" WHERE email=${label + '@example.test'}`;
  const userId = String(user?.['id']);
  const membershipId = f.ids.newId();
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${f.companyId},${membershipId},${userId},id,'global',${scopeType},${scopeId} FROM roles WHERE company_id IS NULL AND code=${role}`;
  return { cookie, userId, membershipId };
}

export async function enrollFor(f: UnbindFixture) {
  const device = testAuthenticator();
  const generated = await f.auth.passkeys.enrollmentOptions(f.personal);
  const binding = await f.enrol.execute(
    f.personal,
    generated.challengeId,
    device.registration(generated.options.challenge, personalOrigin, 'localhost'),
  );
  return { device, binding };
}
export function requestFor(f: UnbindFixture, manager = f.manager) {
  return (method: 'GET' | 'POST', url = f.url, body?: object) =>
    f.app.inject({
      method,
      url,
      headers: { cookie: manager.cookie, 'x-company-id': f.companyId },
      ...(body === undefined ? {} : { payload: body }),
    });
}
