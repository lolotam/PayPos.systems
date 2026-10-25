import { documentBytesKey, documentStatusKey } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  attendanceStatementHttpFixture,
  sendStatementRequest,
  statementBody,
  type AttendanceStatementHttpFixture,
} from './attendance-statement-http.fixture.ts';
import { seedDocumentBytes, seedStatusHash } from './attendance-statement-api.fixture.ts';
import {
  collectStatementHttp,
  readyStatement,
  statementAudits,
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

it('delivers the exact PDF once, records its scope and consumes the bytes', async () => {
  const renderId = await readyStatement(f);
  const response = await collectStatementHttp(f, renderId);
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe('synthetic-pdf-bytes');
  expect(response.headers['content-type']).toBe('application/pdf');
  expect(response.headers['content-disposition']).toBe(
    'attachment; filename="attendance-statement-branch-2026-10-01_2026-10-31.pdf"; filename*=UTF-8\'\'attendance-statement-branch-2026-10-01_2026-10-31.pdf',
  );
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  const audits = await statementAudits(f, renderId);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    entity: 'attendance_statement',
    entity_id: renderId,
    action: 'attendance.statement.downloaded',
    actor_user_id: f.userId,
    after: {
      form: 'BRANCH',
      business_id: f.business,
      branch_id: f.branch,
      employee_id: null,
      from: '2026-10-01',
      to: '2026-10-31',
      shift: null,
      language: 'ar',
    },
  });
  expect(await f.h.redis.exists(documentBytesKey(f.company, renderId))).toBe(0);
  expect((await statementStatusHttp(f, renderId)).body).toEqual({ state: 'CONSUMED' });
  const second = await collectStatementHttp(f, renderId);
  expect(second.statusCode).toBe(410);
  expect(second.json()).toMatchObject({ code: 'DOCUMENT_EXPIRED' });
  expect(await statementAudits(f, renderId)).toHaveLength(1);
});

it.each(['QUEUED', 'RENDERING', 'FAILED'])(
  'refuses %s without consuming or auditing',
  async (state) => {
    const renderId = await readyStatement(f);
    await seedStatusHash(f, renderId, { state });
    const response = await collectStatementHttp(f, renderId);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'DOCUMENT_NOT_READY' });
    expect(await f.h.redis.exists(documentBytesKey(f.company, renderId))).toBe(1);
    expect(await statementAudits(f, renderId)).toHaveLength(0);
  },
);

it('audits the requested shift filter in branch-local HH:MM form', async () => {
  const shift = { start: '09:00', end: '20:00' };
  const accepted = await sendStatementRequest(f, statementBody({ shift }));
  expect(accepted.status).toBe(202);
  const renderId = accepted.body['render_id'] as string;
  await seedStatusHash(f, renderId, { state: 'READY' });
  await seedDocumentBytes(f, renderId);
  expect((await collectStatementHttp(f, renderId)).statusCode).toBe(200);
  expect((await statementAudits(f, renderId))[0]).toMatchObject({ after: { shift } });
});

it('returns 410 without an audit when the bytes expired', async () => {
  const renderId = await readyStatement(f);
  await f.h.redis.del(documentBytesKey(f.company, renderId));
  const response = await collectStatementHttp(f, renderId);
  expect(response.statusCode).toBe(410);
  expect(response.json()).toMatchObject({ code: 'DOCUMENT_EXPIRED' });
  expect(await statementAudits(f, renderId)).toHaveLength(0);
});

it('delivers a concurrent collect to exactly one caller with exactly one audit', async () => {
  const renderId = await readyStatement(f);
  const responses = await Promise.all([
    collectStatementHttp(f, renderId),
    collectStatementHttp(f, renderId),
  ]);
  expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 410]);
  expect(responses.filter((response) => response.body === 'synthetic-pdf-bytes')).toHaveLength(1);
  expect(await statementAudits(f, renderId)).toHaveLength(1);
});

it('keeps bytes and audit untouched for every refused binding and permission', async () => {
  const renderId = await readyStatement(f);
  const missing = await collectStatementHttp(f, salaryIds.newId());
  expect(missing.statusCode).toBe(404);
  for (const options of [
    { cookie: f.ownerCookie },
    { branchId: f.sameBusinessBranch },
    { businessId: f.secondBusiness },
  ]) {
    const response = await collectStatementHttp(f, renderId, options);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(missing.json());
  }
  expect((await collectStatementHttp(f, renderId, { cookie: f.readerCookie })).statusCode).toBe(
    403,
  );
  expect(await f.h.redis.exists(documentBytesKey(f.company, renderId))).toBe(1);
  expect(await statementAudits(f, renderId)).toHaveLength(0);
});

it('does not deliver a PDF if the audit write fails', async () => {
  const renderId = await readyStatement(f);
  await f.h.owner`CREATE FUNCTION reject_statement_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.entity = 'attendance_statement' THEN RAISE EXCEPTION 'synthetic audit refusal'; END IF; RETURN NEW; END $$`;
  await f.h
    .owner`CREATE TRIGGER reject_statement_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_statement_audit()`;
  try {
    const response = await collectStatementHttp(f, renderId);
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).not.toContain('application/pdf');
    expect(response.body).not.toBe('synthetic-pdf-bytes');
    expect(await statementAudits(f, renderId)).toHaveLength(0);
    expect(await f.h.redis.hget(documentStatusKey(f.company, renderId), 'state')).toBe('READY');
  } finally {
    await f.h.owner`DROP TRIGGER reject_statement_audit ON audit_log`;
    await f.h.owner`DROP FUNCTION reject_statement_audit()`;
  }
});
