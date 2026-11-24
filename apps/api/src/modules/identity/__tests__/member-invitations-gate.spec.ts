import { errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// AC-F1-7c على مسارات G1: البوابة مقفولة افتراضياً (plan §1.1) فالمسارات الثلاثة بترجع
// 503 NOT_READY قبل أي حارس أو قاعدة — الشاشة بتخفي المدخل على نفس الرد.
let h: Harness;
const owner = { email: 'g1-gate-owner@example.test', cookie: '', userId: '' };

beforeAll(async () => {
  h = await startHarness({});
  owner.cookie = await h.signedInOperator(owner.email);
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${owner.email}`;
  owner.userId = (row?.['id'] as string) ?? '';
});

afterAll(async () => {
  await h?.close();
});

it('every membership-invitation route answers 503 NOT_READY while the gate is off', async () => {
  const company = await h.onboard(owner.cookie, 'G1 Gate Company');
  const posted = await h.send('POST', '/v1/memberships/invitations', {
    cookie: owner.cookie,
    company,
    body: {
      email: 'gate@example.test',
      name: 'Gate',
      role: 'accountant',
      scope: { type: 'COMPANY', id: company },
      email_confirmed: true,
    },
  });
  const listed = await h.send('GET', '/v1/memberships/invitations', {
    cookie: owner.cookie,
    company,
  });
  const reissued = await h.send('POST', '/v1/memberships/invitations/01920000-0000-7000-8000-0000000000d1/link', {
    cookie: owner.cookie,
    company,
  });
  for (const response of [posted, listed, reissued]) {
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([503, 'NOT_READY']);
  }
  expect(
    await h.owner`SELECT count(*)::int AS n FROM member_invitations WHERE company_id = ${company}`,
  ).toEqual([{ n: 0 }]);
});
