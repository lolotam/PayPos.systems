import type { ExecutionContext } from '@nestjs/common';
import type { Principal } from '@pospay/auth';
import type { TenantWrappers } from '@pospay/db';
import { expect, it } from 'vitest';

import { SelectedCompanyGuard } from '../selected-company.guard.ts';

const USER_ID = '01920000-0000-7000-8000-0000000000f1';
const VALID_COMPANY = '01920000-0000-7000-8000-0000000000a0';

function makeContext(
  principal: Principal,
  companyHeader: string | undefined,
): {
  context: ExecutionContext;
  request: { principal: Principal; headers: Record<string, string | undefined> };
} {
  const request = {
    principal,
    headers: { 'x-company-id': companyHeader },
  };
  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext,
    request,
  };
}

function mockDatabase(memberRows: unknown[]): TenantWrappers {
  return {
    withUser: async (
      _userId: string,
      callback: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) => callback({ execute: async () => memberRows }),
  } as unknown as TenantWrappers;
}

it.each(['device', 'api-key'] as const)(
  'refuses %s even with a user id and claimed membership',
  async (kind) => {
    const principal: Principal = {
      kind,
      userId: USER_ID,
      companyId: VALID_COMPANY,
      deviceId: null,
      employeeId: null,
      grants: [],
      memberships: [{ companyId: VALID_COMPANY, scopeType: 'COMPANY', scopeId: VALID_COMPANY }],
    };
    const { context } = makeContext(principal, VALID_COMPANY);
    // Reject before database readiness/membership: principal type cannot borrow session authorization.
    await expect(new SelectedCompanyGuard(null).canActivate(context)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  },
);

it.each([
  { desc: 'no header', header: undefined, error: 'BAD_REQUEST' },
  { desc: 'malformed header', header: 'not-a-valid-uuid', error: 'BAD_REQUEST' },
  { desc: 'a company where user has no membership', header: VALID_COMPANY, rows: [], error: 'FORBIDDEN' },
  { desc: 'an ended membership', header: VALID_COMPANY, rows: [], error: 'FORBIDDEN' },
  { desc: 'a not-yet-started membership', header: VALID_COMPANY, rows: [], error: 'FORBIDDEN' },
])('refuses $desc with $error', async ({ header, rows = [], error }) => {
  const principal: Principal = {
    kind: 'user',
    userId: USER_ID,
    companyId: null,
    deviceId: null,
    employeeId: null,
    grants: [],
    memberships: [],
  };
  const { context } = makeContext(principal, header);
  const guard = new SelectedCompanyGuard(mockDatabase(rows));
  await expect(guard.canActivate(context)).rejects.toMatchObject({ code: error });
});

it('allows active membership and sets companyId on the principal', async () => {
  const principal: Principal = {
    kind: 'user',
    userId: USER_ID,
    companyId: null,
    deviceId: null,
    employeeId: null,
    grants: [],
    memberships: [],
  };
  const { context, request } = makeContext(principal, VALID_COMPANY);
  const guard = new SelectedCompanyGuard(
    mockDatabase([{ id: '01920000-0000-7000-8000-000000000001' }]),
  );
  const result = await guard.canActivate(context);
  expect(result).toBe(true);
  expect(request.principal.companyId).toBe(VALID_COMPANY);
});

