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

interface TenantCall {
  companyId: string;
  options: unknown;
  statements: string[];
}

function statementText(query: unknown): string {
  if (typeof query !== 'object' || query === null || !('queryChunks' in query)) return '';
  const chunks = (query as { queryChunks: readonly unknown[] }).queryChunks;
  return chunks
    .map((chunk) => {
      if (typeof chunk !== 'object' || chunk === null || !('value' in chunk)) return '';
      const value = (chunk as { value: unknown }).value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join('');
}

function mockDatabase(
  memberRows: unknown[],
  companyRows: unknown[] = [{ id: VALID_COMPANY }],
): { database: TenantWrappers; calls: TenantCall[] } {
  const calls: TenantCall[] = [];
  const database = {
    withUser: (): Promise<unknown> => {
      throw new Error('withUser must not be called');
    },
    withTenant: async (
      companyId: string,
      callback: (tx: { execute: (query: unknown) => Promise<unknown[]> }) => Promise<unknown>,
      options?: unknown,
    ) => {
      const statements: string[] = [];
      calls.push({ companyId, options, statements });
      return callback({
        execute: async (query) => {
          statements.push(statementText(query));
          return statements.length === 1 ? memberRows : companyRows;
        },
      });
    },
  };
  return { database: database as unknown as TenantWrappers, calls };
}

function userPrincipal(): Principal {
  return {
    kind: 'user',
    userId: USER_ID,
    companyId: null,
    deviceId: null,
    employeeId: null,
    grants: [],
    memberships: [],
  };
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
  {
    desc: 'a company where user has no membership',
    header: VALID_COMPANY,
    rows: [],
    error: 'FORBIDDEN',
  },
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
  const db = mockDatabase(rows);
  const guard = new SelectedCompanyGuard(db.database);
  await expect(guard.canActivate(context)).rejects.toMatchObject({ code: error });
  expect(db.calls).toHaveLength(error === 'BAD_REQUEST' ? 0 : 1);
  if (error === 'BAD_REQUEST') return;
  expect(db.calls[0]).toMatchObject({ companyId: VALID_COMPANY, options: { userId: USER_ID } });
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
  const { context, request } = makeContext(principal, VALID_COMPANY.toUpperCase());
  const db = mockDatabase([{ id: '01920000-0000-7000-8000-000000000001' }]);
  const guard = new SelectedCompanyGuard(db.database);
  const result = await guard.canActivate(context);
  expect(result).toBe(true);
  expect(request.principal.companyId).toBe(VALID_COMPANY);
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0]).toMatchObject({ companyId: VALID_COMPANY, options: { userId: USER_ID } });
  expect(db.calls[0]?.statements[0]).toContain('user_id');
  expect(db.calls[0]?.statements[0]).toContain('company_id');
});

it('refuses an expired membership with FORBIDDEN', async () => {
  const { context, request } = makeContext(userPrincipal(), VALID_COMPANY);
  const db = mockDatabase([]);
  await expect(new SelectedCompanyGuard(db.database).canActivate(context)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(request.principal.companyId).toBeNull();
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0]).toMatchObject({ companyId: VALID_COMPANY, options: { userId: USER_ID } });
});

it('refuses a deleted company with FORBIDDEN', async () => {
  const { context, request } = makeContext(userPrincipal(), VALID_COMPANY);
  const db = mockDatabase([{ id: '01920000-0000-7000-8000-000000000001' }], []);
  await expect(new SelectedCompanyGuard(db.database).canActivate(context)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(request.principal.companyId).toBeNull();
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0]).toMatchObject({ companyId: VALID_COMPANY, options: { userId: USER_ID } });
});
