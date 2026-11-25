import { documentStatusKey } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  bytesPresent,
  collectExport,
  exportAudits,
  exportFixture,
  exportPath,
  exportRow,
  requestExport,
  seedReadyDocument,
  type ExportFixture,
} from './statement-export.fixture.ts';

// مسار HTTP على Redis حقيقي (الحارس والرد والعناوين). تدفق النطاق والتحميل نفسه متغطي في statement-export-flow.spec.ts.
let f: ExportFixture;
beforeAll(async () => {
  f = await exportFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const renderIdOf = (body: Record<string, unknown>) => body['render_id'] as string;
const poll = (cookie: string, renderId: string, company = f.company) =>
  f.h.send('GET', exportPath(f, `/${renderId}`), { cookie, company });
const pollRaw = (cookie: string, renderId: string) =>
  f.h.app.inject({
    method: 'GET',
    url: exportPath(f, `/${renderId}`),
    headers: { cookie, 'x-company-id': f.company },
  });

it('CM-55d: 202 with a render id, the request row stored with the branch scope, and the job state queued', async () => {
  const response = await requestExport(f, f.branchCookie, { language: 'en' });
  expect(response.status).toBe(202);
  const renderId = renderIdOf(response.body);
  expect(await exportRow(f, renderId)).toMatchObject({
    scope: 'BRANCHES',
    branch_ids: [f.branch],
    employee_ids: [f.employee],
    language: 'en',
  });
  expect(await f.h.redis.hget(documentStatusKey(f.company, renderId), 'state')).toBe('QUEUED');
  const polled = await pollRaw(f.branchCookie, renderId);
  expect(polled.statusCode).toBe(200);
  expect(polled.headers['cache-control']).toBe('no-store');
  expect(polled.json()).toEqual({ state: 'QUEUED' });
});

it('the language is required, a month that is not approved is 409, and an outsider is the uniform 403', async () => {
  for (const body of [{}, { language: 'fr' }]) {
    const response = await requestExport(f, f.cookie, body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  }
  const notApproved = await requestExport(f, f.cookie, { language: 'ar' }, '2027-01');
  expect(notApproved.status).toBe(409);
  expect(notApproved.body).toMatchObject({ code: 'COMMISSION_STATEMENT_NOT_APPROVED' });
  const outsider = await f.h.signedInOperator('statement-export-http-outsider@example.test');
  expect((await requestExport(f, outsider, { language: 'ar' })).status).toBe(403);
});

it('CM-55e: the requester downloads once with the xlsx type and one audit entry; another user gets 404 and the bytes stay', async () => {
  const renderId = renderIdOf((await requestExport(f, f.branchCookie)).body);
  expect((await collectExport(f, f.branchCookie, renderId)).statusCode).toBe(409);
  await seedReadyDocument(f, renderId, f.branchManagerUser);
  expect((await collectExport(f, f.cookie, renderId)).statusCode).toBe(404);
  expect(await bytesPresent(f, renderId)).toBe(true);
  const file = await collectExport(f, f.branchCookie, renderId);
  expect(file.statusCode).toBe(200);
  expect(file.headers['content-type']).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(file.headers['content-disposition']).toContain('commission-statement-2026-10.xlsx');
  expect(file.headers['cache-control']).toBe('no-store');
  expect(file.rawPayload.toString()).toBe('synthetic-xlsx-bytes');
  expect(await exportAudits(f, renderId)).toHaveLength(1);
  expect((await collectExport(f, f.branchCookie, renderId)).statusCode).toBe(410);
});

it('poll answers 404 for another user or unknown id, 403 for unpermitted/cross-company/feature-off, and concurrent collect lets only one win', async () => {
  const renderId = renderIdOf((await requestExport(f, f.branchCookie)).body);
  expect((await poll(f.cookie, renderId)).status).toBe(404);
  expect((await poll(f.branchCookie, '01920000-0000-7000-8000-000000000999')).status).toBe(404);
  const outsider = await f.h.signedInOperator('statement-export-poll-outsider@example.test');
  expect((await poll(outsider, renderId)).status).toBe(403);
  const otherCompany = await f.h.onboard(outsider, 'Other export company');
  expect((await poll(outsider, renderId, otherCompany)).status).toBe(403);

  const [operator] = await f.h.owner`SELECT id FROM "user" WHERE email='commission-estimate-owner@example.test'`;
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'commissions',false,'http feature proof',${operator?.['id']}::uuid)`;
  try {
    const reqOff = await requestExport(f, f.branchCookie, { language: 'ar' });
    expect(reqOff.status).toBe(403);
    expect((reqOff.body as { code: string }).code).toBe('FEATURE_DISABLED');
    const pollOff = await poll(f.branchCookie, renderId);
    expect(pollOff.status).toBe(403);
    expect((pollOff.body as { code: string }).code).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='commissions'`;
  }

  await seedReadyDocument(f, renderId, f.branchManagerUser);
  const [first, second] = await Promise.all([
    collectExport(f, f.branchCookie, renderId),
    collectExport(f, f.branchCookie, renderId),
  ]);
  expect([first.statusCode, second.statusCode].sort()).toEqual([200, 410]);
  expect(await exportAudits(f, renderId)).toHaveLength(1);
});
