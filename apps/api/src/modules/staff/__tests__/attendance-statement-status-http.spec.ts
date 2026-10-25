import { attendanceStatementStatus, documentStatusKey } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  attendanceStatementHttpFixture,
  type AttendanceStatementHttpFixture,
} from './attendance-statement-http.fixture.ts';
import {
  seedDocumentBytes,
  seedStatementRequest,
  seedStatusHash,
} from './attendance-statement-api.fixture.ts';
import {
  collectStatementHttp,
  readyStatement,
  statementStatusHttp,
} from './attendance-statement-download.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: AttendanceStatementHttpFixture;
beforeAll(async () => {
  f = await attendanceStatementHttpFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it.each(['QUEUED', 'RENDERING', 'READY', 'FAILED'])('returns %s without caching', async (state) => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state, errorCode: 'STATEMENT_EMPTY' });
  if (state === 'READY') await seedDocumentBytes(f, renderId);
  const response = await statementStatusHttp(f, renderId);
  expect(response.status).toBe(200);
  expect(attendanceStatementStatus.parse(response.body)).toEqual({
    state,
    ...(state === 'FAILED' ? { error_code: 'STATEMENT_EMPTY' } : {}),
  });
  expect(response.headers['cache-control']).toBe('no-store');
});

it('reports expired bytes and consumed downloads accurately', async () => {
  const missing = await seedStatementRequest(f);
  await seedStatusHash(f, missing, { state: 'READY' });
  expect((await statementStatusHttp(f, missing)).body).toEqual({ state: 'EXPIRED' });
  const ready = await readyStatement(f);
  expect((await collectStatementHttp(f, ready)).statusCode).toBe(200);
  expect((await statementStatusHttp(f, ready)).body).toEqual({ state: 'CONSUMED' });
});

it('returns the same 404 for unknown, expired and inaccessible request bindings', async () => {
  const renderId = await readyStatement(f);
  const unknown = await statementStatusHttp(f, salaryIds.newId());
  expect(unknown.status).toBe(404);
  for (const options of [
    { cookie: f.ownerCookie },
    { branchId: f.sameBusinessBranch },
    { businessId: f.secondBusiness },
  ]) {
    const refused = await statementStatusHttp(f, renderId, options);
    expect(refused.status).toBe(404);
    expect(refused.body).toEqual(unknown.body);
  }
  const foreignScope = { ...f, company: f.otherCompany };
  const foreign = await seedStatementRequest(foreignScope, {
    businessId: f.foreignBusiness,
    branchId: f.foreignBranch,
  });
  await seedStatusHash(foreignScope, foreign);
  expect((await statementStatusHttp(f, foreign)).body).toEqual(unknown.body);
  await f.h.redis.del(documentStatusKey(f.company, renderId));
  const expired = await statementStatusHttp(f, renderId);
  expect(expired.status).toBe(404);
  expect(expired.body).toEqual(unknown.body);
});

it('refuses a caller without the attendance permission', async () => {
  const renderId = await readyStatement(f);
  expect((await statementStatusHttp(f, renderId, { cookie: f.readerCookie })).status).toBe(403);
});
