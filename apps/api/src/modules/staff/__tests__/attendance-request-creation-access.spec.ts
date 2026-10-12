import { attendanceChangeRequestPage } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { REQUEST_AUTHORIZER, type RequestAuthorizer } from '../../../shared/request-authorizer.ts';
import { asRole } from './attendance-exception.fixture.ts';
import {
  attendanceCorrectionFixture,
  type AttendanceCorrectionFixture,
} from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: AttendanceCorrectionFixture;
beforeAll(async () => {
  f = await attendanceCorrectionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const headers = () => ({ cookie: f.approverCookie, 'x-company-id': f.company });
const page = async (branch?: string) => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/attendance-change-requests?status=REJECTED&limit=1${branch ? `&branch_id=${branch}` : ''}`,
    headers: headers(),
  });
  expect(response.statusCode).toBe(200);
  return attendanceChangeRequestPage.parse(response.json());
};
it.each([false, true])(
  'selected branch creation matches shared authorization with owner=%s and board DENY',
  async (owner) => {
    await asRole(f, owner ? 'owner' : 'accountant');
    const ids: string[] = [];
    const grants = [
      ['request:attendance-change:branch', 'ALLOW', 'COMPANY', f.company],
      ['request:attendance-change:branch', 'DENY', 'BRANCH', f.secondBranch],
      ['read:attendance:branch', 'DENY', 'COMPANY', f.company],
    ] as const;
    try {
      for (const [permission, effect, scope, scopeId] of grants) {
        const id = leaveIds.newId();
        ids.push(id);
        await f.h
          .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
        VALUES(${f.company},${id},${f.approverMember},${permission},${effect},${scope},${scopeId},'Synthetic creation access',${f.userId})`;
      }
      const board = await f.h.app.inject({
        method: 'GET',
        url: `/v1/businesses/${f.business}/branches/${f.branch}/attendance-capabilities`,
        headers: headers(),
      });
      expect(board.statusCode).toBe(owner ? 200 : 404);
      const authorizer = f.h.app.get<RequestAuthorizer>(REQUEST_AUTHORIZER);
      for (const branch of [f.branch, f.secondBranch]) {
        const result = await page(branch);
        expect(result.items).toEqual([]);
        expect(result.can_request).toBe(
          (await authorizer.execute({
            userId: f.approverId,
            requestedCompany: f.company,
            branchParam: branch,
            permission: 'request:attendance-change:branch',
          })) !== null,
        );
        expect(result.can_request).toBe(branch === f.branch || owner);
      }
    } finally {
      for (const id of ids)
        await f.h
          .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`;
    }
  },
);
it('creation requires a selected branch in the business and accepts upper-case ids', async () => {
  await asRole(f, 'owner');
  expect((await page(f.branch.toUpperCase())).can_request).toBe(true);
  expect((await page()).can_request).toBe(false);
  expect((await page(f.foreignBranch)).can_request).toBe(false);
  expect((await page(leaveIds.newId())).can_request).toBe(false);
});
it('board-read-only membership has no creation capability on an empty selected-branch page', async () => {
  await asRole(f, 'accountant');
  const board = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/branches/${f.branch}/attendance-capabilities`,
    headers: headers(),
  });
  expect(board.statusCode).toBe(200);
  expect((await page(f.branch)).can_request).toBe(false);
});
it('an inactive selected branch cannot enable creation for the owner', async () => {
  await asRole(f, 'owner');
  await f.h
    .owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
  try {
    expect((await page(f.branch)).can_request).toBe(false);
  } finally {
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`;
  }
});
