import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { globalRoleMember, permissionOverride } from './commission-estimate.fixture.ts';
import {
  auditAndOutboxCounts,
  generateStatement,
  ids,
  memberWithGrants,
  READ,
  REVIEW,
  statementFixture,
  statementRow,
  type StatementFixture,
} from './commission-statement.fixture.ts';

let f: StatementFixture;

beforeAll(async () => {
  f = await statementFixture();
});

afterAll(async () => {
  await f?.h.close();
});

/** كل رفض بيرجع 403 موحّد، وما بيكتبش صف كشف ولا تدقيق (CM-33d). */
async function expectRefused(cookie: string, key: string): Promise<void> {
  const before = await auditAndOutboxCounts(f);
  const response = await generateStatement(f, cookie, key);

  expect(response.status).toBe(403);
  expect((response.body as { code: string }).code).toBe('FORBIDDEN');
  expect(await auditAndOutboxCounts(f)).toEqual(before);
}

describe('CM-33 the review permission defaults', () => {
  it.each([
    ['general_manager', 'BUSINESS'],
    ['business_manager', 'BUSINESS'],
  ] as const)('lets the default %s role generate with no seed re-run', async (code, scope) => {
    const member = await globalRoleMember(f, code, scope);
    const response = await generateStatement(f, member.cookie, `default-${code}`);

    expect(response.status).toBe(200);
  });

  it('lets the owner generate', async () => {
    expect((await generateStatement(f, f.cookie, 'owner-generates')).status).toBe(200);
  });

  it.each([
    ['accountant', 'BUSINESS'],
    ['branch_manager', 'BRANCH'],
    ['viewer', 'BUSINESS'],
  ] as const)('refuses the %s role, which reads commissions or nothing but never reviews', async (code, scope) => {
    const member = await globalRoleMember(f, code, scope);
    await expectRefused(member.cookie, `refused-${code}`);
  });

  it('refuses a stranger with no membership in the company', async () => {
    const stranger = await f.h.signedInOperator(`statement-stranger-${ids.newId()}@example.test`);
    await expectRefused(stranger, 'stranger');
  });
});

describe('CM-33d the review permission is usable only with business-wide read', () => {
  it('lets a holder of review and business-wide read generate', async () => {
    const member = await memberWithGrants(f, 'both-business', [
      { permission: REVIEW, scope: 'BUSINESS' },
      { permission: READ, scope: 'BUSINESS' },
    ]);
    expect((await generateStatement(f, member.cookie, 'review-and-read')).status).toBe(200);
  });

  it('refuses review on the business with read on one branch only', async () => {
    const member = await memberWithGrants(f, 'review-business-read-branch', [
      { permission: REVIEW, scope: 'BUSINESS' },
      { permission: READ, scope: 'BRANCH' },
    ]);
    await expectRefused(member.cookie, 'review-business-read-branch');
  });

  it('refuses review on one branch even with business-wide read', async () => {
    const member = await memberWithGrants(f, 'review-branch-read-business', [
      { permission: REVIEW, scope: 'BRANCH' },
      { permission: READ, scope: 'BUSINESS' },
    ]);
    await expectRefused(member.cookie, 'review-branch-read-business');
  });

  it('refuses review without any read of commissions', async () => {
    const member = await memberWithGrants(f, 'review-only', [
      { permission: REVIEW, scope: 'BUSINESS' },
    ]);
    await expectRefused(member.cookie, 'review-only');
  });

  it('refuses a business-wide reader who holds a DENY of read on one branch', async () => {
    const member = await globalRoleMember(f, 'business_manager', 'BUSINESS');
    await permissionOverride(f, member.membershipId, 'DENY', { type: 'BRANCH', id: f.secondBranch });
    await expectRefused(member.cookie, 'denied-second-branch');
  });

  it('refuses a union of branch grants that covers every branch, for review and read alike', async () => {
    const member = await memberWithGrants(f, 'branch-unions', [
      { permission: REVIEW, scope: 'BRANCH' },
      { permission: REVIEW, scope: 'SECOND_BRANCH' },
      { permission: READ, scope: 'BRANCH' },
      { permission: READ, scope: 'SECOND_BRANCH' },
    ]);
    await expectRefused(member.cookie, 'branch-unions');
  });
});

describe('a withdrawn review permission takes effect on the next request', () => {
  it('refuses a new request, and a replay of the very same key, after the grant is deleted', async () => {
    const member = await memberWithGrants(f, 'revoked-later', [
      { permission: REVIEW, scope: 'BUSINESS' },
      { permission: READ, scope: 'BUSINESS' },
    ]);
    const first = await generateStatement(f, member.cookie, 'revoked-key');
    expect(first.status).toBe(200);

    await f.h.owner`DELETE FROM role_permissions WHERE company_id=${f.company}
      AND permission_code=${REVIEW}
      AND role_id IN (SELECT role_id FROM memberships WHERE company_id=${f.company}
        AND id = ANY(${member.membershipIds}::uuid[]))`;

    const replay = await generateStatement(f, member.cookie, 'revoked-key');
    expect(replay.status).toBe(403);
    expect((replay.body as { code: string }).code).toBe('FORBIDDEN');
    // الرد المخزّن ما بيرجعش لواحد اتسحبت صلاحيته، ومفتاح جديد بيترفض بنفس الشكل.
    expect((await generateStatement(f, member.cookie, 'revoked-new-key')).status).toBe(403);
  });

  it('answers 403 before 422 when the withdrawn holder reuses a key for another month', async () => {
    const member = await memberWithGrants(f, 'revoked-reuse', [
      { permission: REVIEW, scope: 'BUSINESS' },
      { permission: READ, scope: 'BUSINESS' },
    ]);
    await generateStatement(f, member.cookie, 'reuse-key', '2026-11');
    await f.h.owner`DELETE FROM role_permissions WHERE company_id=${f.company}
      AND permission_code=${REVIEW}
      AND role_id IN (SELECT role_id FROM memberships WHERE company_id=${f.company}
        AND id = ANY(${member.membershipIds}::uuid[]))`;

    const reused = await generateStatement(f, member.cookie, 'reuse-key', '2026-10');

    expect(reused.status).toBe(403);
    expect(await statementRow(f, '2026-10')).toBeUndefined();
  });
});

describe('refusals reveal nothing about the month', () => {
  it('answers the same 403 for a refused holder of a month that exists and one that never did', async () => {
    const member = await globalRoleMember(f, 'accountant', 'BUSINESS');
    const existing = await generateStatement(f, member.cookie, 'shape-existing', '2026-11');
    const missing = await generateStatement(f, member.cookie, 'shape-missing', '2026-01');

    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(existing.body).toEqual(missing.body);
  });
});
