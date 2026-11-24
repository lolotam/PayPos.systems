import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { readCommissionScope } from '../persistence/commission-read-scope.ts';
import { startHarness } from '../../../../test/harness.ts';
import type { Harness } from '../../../../test/harness.ts';

/**
 * توقيت القرار الواحد لقارئ نطاق العمولات: لما المتصل اللي بيقرا تحت أقفاله يممر توقيت قراره،
 * قارئ النطاق بيقيّم المنح عليه هو، مش بيسحب ساعة تانية — ففحص الإجراء وفحص القراءة على مستوى
 * النشاط كله بيقراوا نفس اللحظة جوّه المعاملة، ولما التوقيت يتغاب بيتعيّن من الساعة زي ما كان.
 */

let h: Harness;
let owner: postgres.Sql;
let company: string;
let business: string;
let branch: string;
let userId: string;
let membershipId: string;

beforeAll(async () => {
  h = await startHarness();
  owner = postgres(h.urls.owner, { max: 2, onnotice: () => undefined });
  const cookie = await h.signedInOperator('commission-scope-decision@example.test');
  company = await h.onboard(cookie, 'Commission scope decision employer');
  const created = (
    await h.send('POST', '/v1/businesses', {
      cookie,
      company,
      key: 'commission-scope-decision-business',
      body: { vertical_type: 'salon', name_en: 'Scope decision salon', timezone: 'Asia/Kuwait' },
    })
  ).body['id'] as string;
  business = created;
  const branchResponse = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: 'commission-scope-decision-branch',
    body: { name_en: 'Scope decision branch' },
  });
  branch = branchResponse.body['id'] as string;
  const email = 'commission-scope-decision-member@example.test';
  await h.signedInOperator(email);
  const [user] = await owner`SELECT id FROM "user" WHERE email=${email}`;
  userId = user?.['id'] as string;
  const role = '01940000-0000-7000-8000-000000000001';
  membershipId = '01940000-0000-7000-8000-000000000002';
  await owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${company},'scope_decision_member','Decision time member role')`;
  // العضوية بتبدأ قبل توقيت القرار التاريخي، وإلا كانت بتنعتم غير نشطة عنده وحكم المنحة بيروح.
  await owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES (${company},${membershipId},${userId},${role},${company},'BRANCH',${branch}::uuid,
      '2025-01-01')`;
  await owner`INSERT INTO permission_overrides(
    company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by,expires_at)
    VALUES (${company},gen_random_uuid(),${membershipId}::uuid,'read:commissions:business',
      'ALLOW','BUSINESS',${business}::uuid,'decision time spec',${userId},'2026-06-01')`;
});

afterAll(async () => {
  await owner.end();
  await h.close();
});

it('evaluates the override window at the decision time the caller passes, not at a second clock sample', async () => {
  const { createDatabase } = await import('@pospay/db');
  const { systemUuidV7 } = await import('@pospay/ids');
  const wrappers = createDatabase({ url: h.urls.app, ids: systemUuidV7() });
  try {
    const atGrantTime = new Date('2026-01-01T00:00:00Z');
    await wrappers.withTenant(company, async (tx) => {
      const withDecisionAt = await readCommissionScope(
        tx,
        company,
        userId,
        business,
        atGrantTime,
      );
      expect(withDecisionAt.kind).toBe('scope');
      if (withDecisionAt.kind === 'scope') expect(withDecisionAt.scope.businessWide).toBe(true);
      const atRealClock = await readCommissionScope(tx, company, userId, business);
      expect(atRealClock.kind).toBe('forbidden');
    });
  } finally {
    await wrappers.close();
  }
});
