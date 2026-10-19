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

interface MemberCall {
  userId: string;
  companyId: string;
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
  proven: boolean,
  companyRows: unknown[] = [{ id: VALID_COMPANY }],
): { database: TenantWrappers; calls: MemberCall[] } {
  const calls: MemberCall[] = [];
  const database = {
    withUser: (): Promise<unknown> => {
      throw new Error('withUser must not be called');
    },
    withTenant: (): Promise<unknown> => {
      throw new Error('withTenant must not be called');
    },
    withMember: async (
      userId: string,
      companyId: string,
      callback: (tx: { execute: (query: unknown) => Promise<unknown[]> }) => Promise<unknown>,
    ) => {
      const statements: string[] = [];
      calls.push({ userId, companyId, statements });
      if (!proven) return null;
      return callback({
        execute: async (query) => {
          statements.push(statementText(query));
          return companyRows;
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
  { desc: 'no header', header: undefined },
  { desc: 'malformed header', header: 'not-a-valid-uuid' },
])('refuses $desc with BAD_REQUEST', async ({ header }) => {
  const { context } = makeContext(userPrincipal(), header);
  const db = mockDatabase(true);
  const guard = new SelectedCompanyGuard(db.database);
  await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(db.calls).toHaveLength(0);
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
  const db = mockDatabase(true);
  const guard = new SelectedCompanyGuard(db.database);
  const result = await guard.canActivate(context);
  expect(result).toBe(true);
  expect(request.principal.companyId).toBe(VALID_COMPANY);
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0]).toMatchObject({ userId: USER_ID, companyId: VALID_COMPANY });
  expect(db.calls[0]?.statements).toHaveLength(1);
  expect(db.calls[0]?.statements[0]).toContain('deleted_at');
  expect(db.calls[0]?.statements[0]).not.toContain('memberships');
});

it('refuses when membership is not proven', async () => {
  const { context, request } = makeContext(userPrincipal(), VALID_COMPANY.toUpperCase());
  const db = mockDatabase(false);
  await expect(new SelectedCompanyGuard(db.database).canActivate(context)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(request.principal.companyId).toBeNull();
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0]).toMatchObject({ userId: USER_ID, companyId: VALID_COMPANY });
  expect(db.calls[0]?.statements).toHaveLength(0);
});

it('refuses a deleted company with FORBIDDEN', async () => {
  const { context, request } = makeContext(userPrincipal(), VALID_COMPANY);
  const db = mockDatabase(true, []);
  await expect(new SelectedCompanyGuard(db.database).canActivate(context)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(request.principal.companyId).toBeNull();
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0]).toMatchObject({ userId: USER_ID, companyId: VALID_COMPANY });
  expect(db.calls[0]?.statements[0]).toContain('deleted_at');
});
