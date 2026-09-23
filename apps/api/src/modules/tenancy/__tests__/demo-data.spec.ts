import { PROVISIONAL_PLAN_ID, grantPlatformPermission } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDemoData } from '../../../../scripts/demo-data.ts';
import { startHarness, type Harness } from './harness.ts';

// Plan v4 T8: the demo data goes through the production routes — one company per vertical, each with its business
// of that vertical and one branch, all audited and evented like any other write.
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

describe('demo data', () => {
  it('creates one company per vertical through the API, with owner, business, branch and their events', async () => {
    const companies = await createDemoData({
      app: h.app,
      auth: h.auth,
      origin: 'http://admin.test',
      planId: PROVISIONAL_PLAN_ID,
      grant: async (email) => {
        const request = { email, permission: 'create:companies:platform', operator: 'demo-data' };
        await grantPlatformPermission(h.ownerUrl, request, systemUuidV7());
      },
    });
    expect(companies).toHaveLength(5);
    const verticals = await h.owner`
      SELECT b.vertical_type, count(br.id)::int AS branches
      FROM businesses b JOIN branches br ON br.company_id = b.company_id AND br.business_id = b.id
      WHERE b.company_id = ANY(${companies}::uuid[]) GROUP BY 1 ORDER BY 1`;
    expect(verticals).toEqual(
      ['laundry', 'restaurant', 'retail', 'salon', 'services'].map((v) => ({
        vertical_type: v,
        branches: 1,
      })),
    );
    const owners = await h.owner`
      SELECT count(*)::int AS n FROM memberships WHERE company_id = ANY(${companies}::uuid[])`;
    expect(owners).toEqual([{ n: 5 }]);
    const events = await h.owner`
      SELECT event_type, count(*)::int AS n FROM outbox WHERE company_id = ANY(${companies}::uuid[])
      GROUP BY 1 ORDER BY 1`;
    expect(events).toEqual([
      { event_type: 'BranchCreated', n: 5 },
      { event_type: 'BusinessCreated', n: 5 },
      { event_type: 'CompanyCreated', n: 5 },
    ]);
  });
});
