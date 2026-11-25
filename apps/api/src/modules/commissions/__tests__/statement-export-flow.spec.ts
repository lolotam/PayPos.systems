import { afterAll, beforeAll, expect, it } from 'vitest';

import { statementExportReaders } from '../../../../test/statement-export-readers.ts';
import { StatementExportError } from '../use-cases/statement-export-error.ts';
import { createStatementExportTransactions } from '../persistence/statement-export-transactions.ts';
import { CollectStatementExportUseCase } from '../use-cases/collect-statement-export/collect-statement-export.usecase.ts';
import { RequestStatementExportUseCase } from '../use-cases/request-statement-export/request-statement-export.usecase.ts';
import { customRoleMember, ids, permissionOverride } from './commission-estimate.fixture.ts';
import { memoryDocuments } from './statement-export-memory.fixture.ts';
import {
  addBranchMembership,
  businessReader,
  exportAudits,
  exportFixture,
  exportRow,
  EXPORT_PERIOD,
  PAID_PERIOD,
  type ExportFixture,
} from './statement-export.fixture.ts';

// تدفق الطلب والتحميل على Postgres حقيقي (نطاق الصلاحية والتدقيق والقفل) بنقل ومخزن في الذاكرة، من غير Redis.
let f: ExportFixture;
let ownerUser: string;
beforeAll(async () => {
  f = await exportFixture();
  const [owner] = await f.h.owner`SELECT user_id FROM memberships
    WHERE company_id=${f.company} AND scope_type='COMPANY' LIMIT 1`;
  ownerUser = owner?.['user_id'] as string;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function setup() {
  const memory = memoryDocuments();
  const transactions = createStatementExportTransactions(f.db, ids, statementExportReaders);
  const clock = { now: () => new Date('2026-11-05T09:00:00Z') };
  return {
    memory,
    request: new RequestStatementExportUseCase(
      transactions,
      memory.transport,
      memory.rateLimiter,
      clock,
      ids,
    ),
    collect: new CollectStatementExportUseCase(transactions, memory.store, clock),
  };
}

const scopeFor = (userId: string) => ({ companyId: f.company, userId, businessId: f.business });
const requestAs = (
  s: ReturnType<typeof setup>,
  userId: string,
  period = EXPORT_PERIOD,
  language: 'ar' | 'en' = 'ar',
) => s.request.execute({ ...scopeFor(userId), period, input: { language } });
const collectAs = (s: ReturnType<typeof setup>, userId: string, renderId: string) =>
  s.collect.execute({ ...scopeFor(userId), period: EXPORT_PERIOD, renderId });
const codeOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof StatementExportError) return error.code;
    throw error;
  }
  return 'ACCEPTED';
};

it('CM-55d: a branch reader gets BRANCHES with her whole set and only her employees, written before the job is queued', async () => {
  const s = setup();
  const { render_id } = await requestAs(s, f.branchManagerUser, EXPORT_PERIOD, 'en');
  expect(await exportRow(f, render_id)).toMatchObject({
    scope: 'BRANCHES',
    branch_ids: [f.branch],
    employee_ids: [f.employee],
    language: 'en',
    requested_by: f.branchManagerUser,
    requested_membership_id: f.branchManagerMembership,
    collected_at: null,
    period: EXPORT_PERIOD,
  });
  expect(s.memory.queued).toEqual([
    expect.objectContaining({
      renderId: render_id,
      kind: 'commission-statement-xlsx',
      filename: 'commission-statement-2026-10.xlsx',
      requestedBy: f.branchManagerUser,
    }),
  ]);
});

it('a business-wide reader gets BUSINESS with no arrays, and the PDF renderer is never consulted', async () => {
  const s = setup();
  s.memory.state.rendererAlive = false;
  const { render_id } = await requestAs(s, ownerUser);
  expect(await exportRow(f, render_id)).toMatchObject({
    scope: 'BUSINESS',
    branch_ids: null,
    employee_ids: null,
  });
});

it('a month that is not approved, or has no statement, is refused and writes nothing; a PAID month is accepted', async () => {
  const s = setup();
  const before = await f.h.owner`SELECT count(*)::int AS n FROM commission_statement_exports`;
  expect(await codeOf(requestAs(s, ownerUser, '2027-01'))).toBe('NOT_APPROVED');
  const after = await f.h.owner`SELECT count(*)::int AS n FROM commission_statement_exports`;
  expect(after[0]?.['n']).toBe(before[0]?.['n']);
  expect(s.memory.queued).toEqual([]);
  expect(await codeOf(requestAs(s, ownerUser, PAID_PERIOD))).toBe('ACCEPTED');
});

it('a caller with no membership or no permission is refused uniformly, and no row or job exists', async () => {
  const s = setup();
  const email = 'statement-export-flow-outsider@example.test';
  await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const memberWithoutPerm = await customRoleMember(f, 'flow_no_read_perm', 'BUSINESS');
  const before = await f.h.owner`SELECT count(*)::int AS n FROM commission_statement_exports`;
  expect(await codeOf(requestAs(s, user?.['id'] as string))).toBe('FORBIDDEN');
  expect(await codeOf(requestAs(s, memberWithoutPerm.userId))).toBe('FORBIDDEN');
  const after = await f.h.owner`SELECT count(*)::int AS n FROM commission_statement_exports`;
  expect(after[0]?.['n']).toBe(before[0]?.['n']);
  expect(s.memory.queued).toEqual([]);
});

it('CM-23d and CM-23g: two branch memberships give the union as the whole set, still BRANCHES', async () => {
  const s = setup();
  const email = 'statement-export-flow-union@example.test';
  await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = user?.['id'] as string;
  await addBranchMembership(f, userId, f.branch);
  await addBranchMembership(f, userId, f.secondBranch);
  const { render_id } = await requestAs(s, userId);
  const row = await exportRow(f, render_id);
  expect(row?.['scope']).toBe('BRANCHES');
  expect([...(row?.['branch_ids'] as string[])].sort()).toEqual([f.branch, f.secondBranch].sort());
  expect([...(row?.['employee_ids'] as string[])].sort()).toEqual(
    [f.employee, f.secondEmployee].sort(),
  );
});

it('CM-23e: a DENY on one branch turns a business reader into BRANCHES without it; a DENY on the business refuses', async () => {
  const s = setup();
  const partial = await businessReader(f, 'flow_denied_branch');
  await permissionOverride(f, partial.membershipId, 'DENY', { type: 'BRANCH', id: f.secondBranch });
  const { render_id } = await requestAs(s, partial.userId);
  expect(await exportRow(f, render_id)).toMatchObject({
    scope: 'BRANCHES',
    branch_ids: [f.branch],
    employee_ids: [f.employee],
  });
  const blocked = await businessReader(f, 'flow_denied_business');
  await permissionOverride(f, blocked.membershipId, 'DENY', { type: 'BUSINESS', id: f.business });
  expect(await codeOf(requestAs(s, blocked.userId))).toBe('FORBIDDEN');
});

it('a failed enqueue leaves the stored request and reports the transport as unavailable', async () => {
  const s = setup();
  s.memory.state.queueFails = true;
  const before = await f.h
    .owner`SELECT count(*)::int AS n FROM commission_statement_exports WHERE company_id=${f.company} AND requested_by=${ownerUser}`;
  expect(await codeOf(requestAs(s, ownerUser))).toBe('TRANSPORT_UNAVAILABLE');
  const after = await f.h
    .owner`SELECT count(*)::int AS n FROM commission_statement_exports WHERE company_id=${f.company} AND requested_by=${ownerUser}`;
  expect(after[0]?.['n']).toBe((before[0]?.['n'] as number) + 1);
});

it('the user rate limit refuses before anything is written', async () => {
  const s = setup();
  s.memory.state.limitAllows = false;
  const before = await f.h.owner`SELECT count(*)::int AS n FROM commission_statement_exports`;
  expect(await codeOf(requestAs(s, ownerUser))).toBe('RATE_LIMITED');
  const after = await f.h.owner`SELECT count(*)::int AS n FROM commission_statement_exports`;
  expect(after[0]?.['n']).toBe(before[0]?.['n']);
});

it('collects once: the bytes, one audit entry by the requester, collected_at set, and a second collect is expired', async () => {
  const s = setup();
  const { render_id } = await requestAs(s, f.branchManagerUser);
  expect(await codeOf(collectAs(s, f.branchManagerUser, render_id))).toBe('NOT_READY');
  s.memory.ready(f.company, render_id);
  const file = await collectAs(s, f.branchManagerUser, render_id);
  expect(file.bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(file.filename).toBe('commission-statement-2026-10.xlsx');
  expect((await exportRow(f, render_id))?.['collected_at']).not.toBeNull();
  const audits = await exportAudits(f, render_id);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actor_user_id: f.branchManagerUser,
    after: { scope: 'BRANCHES', branch_ids: [f.branch], period: EXPORT_PERIOD, language: 'ar' },
  });
  expect(JSON.stringify(audits[0]?.['after'])).not.toContain(f.employee);
  expect(await codeOf(collectAs(s, f.branchManagerUser, render_id))).toBe('EXPIRED');
  expect(await exportAudits(f, render_id)).toHaveLength(1);
});

it('CM-55e: another user gets the uniform not-found and the bytes stay, so the requester can still collect them', async () => {
  const s = setup();
  const { render_id } = await requestAs(s, f.branchManagerUser);
  s.memory.ready(f.company, render_id);
  expect(await codeOf(collectAs(s, ownerUser, render_id))).toBe('NOT_FOUND');
  expect(await codeOf(collectAs(s, f.branchManagerUser, ids.newId()))).toBe('NOT_FOUND');
  expect(s.memory.bytesPresent(f.company, render_id)).toBe(true);
  expect((await collectAs(s, f.branchManagerUser, render_id)).bytes).toHaveLength(3);
});

it('CM-55e: a requester whose branch changed before collecting is refused, the bytes are discarded, nothing is audited and collected_at stays empty', async () => {
  const s = setup();
  const email = 'statement-export-flow-transferred@example.test';
  await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = user?.['id'] as string;
  const membership = await addBranchMembership(f, userId, f.branch);
  const { render_id } = await requestAs(s, userId);
  s.memory.ready(f.company, render_id);
  await f.h
    .owner`UPDATE memberships SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
    WHERE company_id=${f.company} AND id=${membership}`;
  await addBranchMembership(f, userId, f.secondBranch);
  expect(await codeOf(collectAs(s, userId, render_id))).toBe('FORBIDDEN');
  expect(s.memory.bytesPresent(f.company, render_id)).toBe(false);
  expect(await exportAudits(f, render_id)).toEqual([]);
  expect((await exportRow(f, render_id))?.['collected_at']).toBeNull();
});

it('CM-55e: a revoked permission override and a new DENY on the saved branch both refuse collect and discard bytes', async () => {
  const s = setup();
  const revoked = await businessReader(f, 'flow_revoked');
  const a = await requestAs(s, revoked.userId);
  s.memory.ready(f.company, a.render_id);
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${revoked.membershipId}`;
  expect(await codeOf(collectAs(s, revoked.userId, a.render_id))).toBe('FORBIDDEN');
  expect(s.memory.bytesPresent(f.company, a.render_id)).toBe(false);
  expect((await exportRow(f, a.render_id))?.['collected_at']).toBeNull();
  expect(await exportAudits(f, a.render_id)).toEqual([]);

  const denied = await businessReader(f, 'flow_denied_later');
  const b = await requestAs(s, denied.userId);
  s.memory.ready(f.company, b.render_id);
  await permissionOverride(f, denied.membershipId, 'DENY', { type: 'BRANCH', id: f.branch });
  expect(await codeOf(collectAs(s, denied.userId, b.render_id))).toBe('FORBIDDEN');
  expect(s.memory.bytesPresent(f.company, b.render_id)).toBe(false);
  expect((await exportRow(f, b.render_id))?.['collected_at']).toBeNull();
  expect(await exportAudits(f, b.render_id)).toEqual([]);
});

it('P2-2: refuses request with FEATURE_DISABLED and refuses READY collect with FORBIDDEN when commissions feature is off', async () => {
  const s = setup();
  const ready = await requestAs(s, f.branchManagerUser);
  s.memory.ready(f.company, ready.render_id);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'commissions',false,'export feature proof',${ownerUser}::uuid)`;
  try {
    const before = await f.h.owner`SELECT count(*)::int AS n FROM commission_statement_exports`;
    expect(await codeOf(requestAs(s, f.branchManagerUser))).toBe('FEATURE_DISABLED');
    const after = await f.h.owner`SELECT count(*)::int AS n FROM commission_statement_exports`;
    expect(after[0]?.['n']).toBe(before[0]?.['n']);
    expect(s.memory.queued).toHaveLength(1);

    expect(await codeOf(collectAs(s, f.branchManagerUser, ready.render_id))).toBe('FORBIDDEN');
    expect(s.memory.bytesPresent(f.company, ready.render_id)).toBe(false);
    expect(await exportAudits(f, ready.render_id)).toEqual([]);
    expect((await exportRow(f, ready.render_id))?.['collected_at']).toBeNull();
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='commissions'`;
  }
});
