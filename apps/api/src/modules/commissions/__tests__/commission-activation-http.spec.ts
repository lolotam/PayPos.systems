import { afterAll, beforeAll, expect, it } from 'vitest';

import { activationCli } from '../../../../../../packages/db/test/commission-activation-cli.ts';
import {
  approve,
  approverMember,
  reviewedStatement,
  type Approver,
} from './approve-statement.fixture.ts';
import { statementFixture, type StatementFixture } from './commission-statement.fixture.ts';

// CI فقط محلياً: harness يفتح Redis حقيقياً، والمدير منع أي اتصال Redis على جهاز المسارات المتوازية.
let f: StatementFixture;
let approver: Approver;
beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'activation');
});
afterAll(async () => {
  await f?.h.close();
});

it('operator commands open the real HTTP approval only after a post-enable proof, then disable closes it', async () => {
  const fingerprints = await reviewedStatement(f, approver);
  const [operator] = await f.h.owner`SELECT email FROM "user" WHERE id = ${approver.userId}`;
  const [clock] = await f.h
    .owner`SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date + 1)::text AS bound`;
  const toggle = (enabled: boolean) =>
    activationCli('switch', f.h.urls, [
      '--company',
      f.company,
      enabled ? '--enable' : '--disable',
      '--reason',
      'synthetic HTTP activation',
      '--operator-email',
      String(operator?.['email']),
    ]);
  const args = [
    '--company',
    f.company,
    '--businesses',
    f.business,
    '--from',
    '0001-01-01',
    '--to',
    String(clock?.['bound']),
    '--run-id',
    'http-activation',
    '--release',
    'test',
  ];

  expect((await toggle(true)).code).toBe(0);
  const closed = await approve(f, approver.cookie, 'activation-no-proof', fingerprints);
  expect(closed.status).toBe(422);
  expect(closed.body).toMatchObject({ code: 'COMMISSION_COVERAGE_NOT_PROVEN' });
  expect((await activationCli('issue', f.h.urls, [...args, '--dry-run'])).code).toBe(0);
  expect((await activationCli('issue', f.h.urls, args)).code).toBe(0);
  const approved = await approve(f, approver.cookie, 'activation-approved', fingerprints);
  expect(approved.status).toBe(200);
  const [state] = await f.h
    .owner`SELECT status FROM commission_statements WHERE company_id = ${f.company}`;
  expect(state?.['status']).toBe('APPROVED');

  // شهر آخر REVIEWED حتى يُقاس القفل بالمفتاح، لا رفض شهر مغلق أصلاً.
  const earlier = await reviewedStatement(f, approver, '2026-10');
  expect((await toggle(false)).code).toBe(0);
  const disabled = await approve(f, approver.cookie, 'activation-disabled', earlier, '2026-10');
  expect(disabled.status).toBe(403);
  expect(disabled.body).toMatchObject({ code: 'FEATURE_DISABLED' });
  const [untouched] = await f.h.owner`SELECT status FROM commission_statements
    WHERE company_id = ${f.company} AND period = '2026-10'`;
  expect(untouched?.['status']).toBe('REVIEWED');
});
