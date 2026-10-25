import { attendanceStatementAccepted, documentStatusKey } from '@pospay/contracts';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  attendanceStatementHttpFixture,
  rateKey,
  resetStatementHttp,
  sendStatementRequest,
  statementBody,
  statementRows,
  type AttendanceStatementHttpFixture,
} from './attendance-statement-http.fixture.ts';
import { seedLogoFile } from './attendance-statement-http-seed.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: AttendanceStatementHttpFixture;
beforeAll(async () => {
  f = await attendanceStatementHttpFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
beforeEach(async () => {
  await resetStatementHttp(f);
});

it('a manager gets 202 with the request row, the queued status and one job', async () => {
  const response = await sendStatementRequest(f, statementBody());
  expect(response.status).toBe(202);
  const accepted = attendanceStatementAccepted.parse(response.body);
  const rows = await statementRows(f);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: accepted.render_id,
    business_id: f.business,
    branch_id: f.branch,
    form: 'BRANCH',
    employee_id: null,
    period_from: '2026-10-01',
    period_to: '2026-10-31',
    language: 'ar',
    shift_start: null,
    shift_end: null,
    logo_file_id: null,
    requested_by: f.userId,
    requested_at: new Date('2026-10-23T07:00:00.000Z'),
  });
  const hash = await f.h.redis.hgetall(documentStatusKey(f.company, accepted.render_id));
  expect(hash).toMatchObject({
    state: 'QUEUED',
    requested_by: f.userId,
    filename: 'attendance-statement-branch-2026-10-01_2026-10-31.pdf',
  });
  expect(f.control.queued).toHaveLength(1);
  expect(f.control.queued[0]).toMatchObject({
    companyId: f.company,
    renderId: accepted.render_id,
    kind: 'attendance-statement',
    requestedBy: f.userId,
  });
});

it('a business with a bound logo records that logo on the request row', async () => {
  const response = await sendStatementRequest(f, statementBody(), {
    businessId: f.logoBusiness,
    branchId: f.logoBranch,
  });
  expect(response.status).toBe(202);
  const rows = await statementRows(f);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ business_id: f.logoBusiness, logo_file_id: f.logoFileId });
});

it('a logo bound after the request leaves the recorded row without a logo', async () => {
  const response = await sendStatementRequest(f, statementBody());
  expect(response.status).toBe(202);
  const logoFileId = await seedLogoFile(f);
  await f.h.owner`INSERT INTO business_settings(company_id,business_id,logo_file_id)
    VALUES(${f.company},${f.business},${logoFileId})`;
  const rows = await statementRows(f);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ logo_file_id: null });
});

it('a caller without the branch permission is refused with no row and no job', async () => {
  const response = await sendStatementRequest(f, statementBody(), { cookie: f.readerCookie });
  expect(response.status).toBe(403);
  expect(await statementRows(f)).toHaveLength(0);
  expect(f.control.queued).toHaveLength(0);
});

it('an unknown branch and a branch of another company are refused by the guard', async () => {
  for (const branchId of [salaryIds.newId(), f.foreignBranch]) {
    const response = await sendStatementRequest(f, statementBody(), { branchId });
    expect(response.status).toBe(403);
  }
  expect(await statementRows(f)).toHaveLength(0);
  expect(f.control.queued).toHaveLength(0);
});

it('a business route with another business branch is refused before the period check', async () => {
  const response = await sendStatementRequest(
    f,
    statementBody({ from: '2026-10-31', to: '2026-10-01' }),
    {
      branchId: f.otherBusinessBranch,
    },
  );
  expect(response.status).toBe(404);
  expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND' });
  expect(await statementRows(f)).toHaveLength(0);
  expect(f.control.queued).toHaveLength(0);
});

it('a down renderer is refused without a row, a job or a rate limit hit', async () => {
  f.control.alive = false;
  const response = await sendStatementRequest(f, statementBody());
  expect(response.status).toBe(503);
  expect(response.body).toMatchObject({ code: 'RENDERER_UNAVAILABLE' });
  expect(await statementRows(f)).toHaveLength(0);
  expect(f.control.queued).toHaveLength(0);
  expect(await f.h.redis.exists(rateKey(f))).toBe(0);
});

it('a failed enqueue keeps the request row and marks the render failed', async () => {
  f.control.failQueue = true;
  const response = await sendStatementRequest(f, statementBody());
  expect(response.status).toBe(503);
  expect(response.body).toMatchObject({ code: 'RENDERER_UNAVAILABLE' });
  const rows = await statementRows(f);
  expect(rows).toHaveLength(1);
  expect(f.control.failed).toEqual([rows[0]?.id]);
  const hash = await f.h.redis.hgetall(documentStatusKey(f.company, rows[0]?.id as string));
  expect(hash).toMatchObject({ state: 'FAILED', error_code: 'DOCUMENT_RENDER_FAILED' });
});

it('the twentieth request in the window is accepted and the twenty-first is refused', async () => {
  for (let index = 0; index < 20; index += 1) {
    expect((await sendStatementRequest(f, statementBody())).status).toBe(202);
  }
  const refused = await sendStatementRequest(f, statementBody());
  expect(refused.status).toBe(429);
  expect(refused.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_RATE_LIMITED' });
  expect(await statementRows(f)).toHaveLength(20);
  await f.h.redis.del(rateKey(f));
  expect((await sendStatementRequest(f, statementBody())).status).toBe(202);
});
