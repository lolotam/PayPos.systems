import { businessIdentity, errorEnvelope } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  newHeldMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import {
  businessIdentityReadStatement,
  readBusinessIdentity,
} from '../persistence/read-business-identity.ts';
import { businessIdentityQuery } from '../queries/business-identity.query.ts';
import { deviceToken, foreignBusinessId, insertLogoFile } from './set-business-logo.support.ts';

let f: PermissionFixture;
let deniedBody = '';

beforeAll(async () => {
  f = await permissionFixture();
  const refused = await read(f.managerCookie);
  expect(refused.statusCode).toBe(403);
  deniedBody = refused.body;
  expect(errorEnvelope.parse(refused.json()).code).toBe('FORBIDDEN');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function read(cookie: string, business = f.business, company = f.company, authorization?: string) {
  const headers: Record<string, string> = {
    'x-company-id': company,
    origin: 'http://admin.test',
  };
  if (authorization === undefined) headers.cookie = cookie;
  else headers.authorization = authorization;
  return f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${business}/settings/identity`,
    headers,
  });
}

async function stored(logoId: string) {
  await f.h.owner`INSERT INTO business_settings
      (company_id, business_id, official_name_ar, official_name_en, logo_file_id)
    VALUES (${f.company}, ${f.business}, 'Alpha', 'Shop', ${logoId})
    ON CONFLICT (company_id, business_id) DO UPDATE
      SET official_name_ar = EXCLUDED.official_name_ar,
          official_name_en = EXCLUDED.official_name_en,
          logo_file_id = EXCLUDED.logo_file_id`;
}

it('returns the same forbidden body for an unknown business and a foreign business', async () => {
  const foreign = await foreignBusinessId(f);
  const unknown = await read(f.cookie, f.ids.newId());
  const other = await read(f.cookie, foreign);
  expect(unknown.statusCode).toBe(403);
  expect(unknown.body).toBe(deniedBody);
  expect(other.statusCode).toBe(403);
  expect(other.body).toBe(deniedBody);
});

it('refuses a device principal with the same body', async () => {
  const token = await deviceToken(f);
  const res = await read(f.cookie, f.business, f.company, `Device ${token}`);
  expect(res.statusCode).toBe(403);
  expect(res.body).toBe(deniedBody);
});

it('refuses a settings reader who does not hold the identity permission', async () => {
  const cookie = await f.h.signedInOperator('identity-screen-settings-reader@example.test');
  const [user] = await f.h.owner`SELECT id FROM "user"
    WHERE email = 'identity-screen-settings-reader@example.test'`;
  await newHeldMember(f, { userId: user?.['id'] as string }, 'business_manager');
  const settings = await f.h.send('GET', `/v1/businesses/${f.business}/settings`, {
    cookie,
    company: f.company,
  });
  expect(settings.status).toBe(200);
  const res = await read(cookie);
  expect(res.statusCode).toBe(403);
  expect(res.body).toBe(deniedBody);
});

it('returns the stored identity to a holder who cannot read settings', async () => {
  const logoId = await insertLogoFile(f);
  await stored(logoId);
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:business-identity:business',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  const settings = await f.h.send('GET', `/v1/businesses/${f.business}/settings`, {
    cookie: f.managerCookie,
    company: f.company,
  });
  expect(settings.status).toBe(403);
  const res = await read(f.managerCookie);
  expect(res.statusCode).toBe(200);
  expect(businessIdentity.parse(res.json())).toEqual({
    official_name_ar: 'Alpha',
    official_name_en: 'Shop',
    logo_file_id: logoId,
  });
});

it('returns exactly the stored names and logo', async () => {
  const logoId = await insertLogoFile(f);
  await stored(logoId);
  const result = await f.db.withTenant(
    f.company,
    (tx) => businessIdentityQuery(tx, f.company, f.business, { read: readBusinessIdentity }),
    { userId: f.userId },
  );
  expect(result).toEqual({
    official_name_ar: 'Alpha',
    official_name_en: 'Shop',
    logo_file_id: logoId,
  });
});

it('plans the identity read on the settings key without a sequential scan', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': { Plan: ExplainNode }[] }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${businessIdentityReadStatement(f.company, f.business)}`,
    );
    const scanned = planNodes(row?.['QUERY PLAN'][0]?.Plan).filter(
      (node) => node['Relation Name'] === 'business_settings',
    );
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
  });
});

it('does not wait while another transaction holds the settings row', async () => {
  let release!: () => void;
  const released = new Promise<void>((done) => {
    release = done;
  });
  let held!: () => void;
  const holding = new Promise<void>((done) => {
    held = done;
  });
  const holder = f.db.withTenant(
    f.company,
    async (tx) => {
      await tx.execute(sql`SELECT business_id FROM business_settings
        WHERE company_id=${f.company} AND business_id=${f.business} FOR UPDATE`);
      held();
      await released;
    },
    { userId: f.userId },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let holderError: unknown;
  const ended = holder.then(
    () => 'ended' as const,
    (error: unknown) => {
      holderError = error;
      return 'failed' as const;
    },
  );
  try {
    const gate = await Promise.race([holding.then(() => 'held' as const), ended]);
    if (gate !== 'held') throw holderError ?? new Error('settings lock ended before the read');
    const response = await Promise.race([
      read(f.cookie),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('IDENTITY_READ_BLOCKED_ON_SETTINGS_LOCK')),
          1_500,
        );
      }),
    ]);
    expect(response.statusCode).toBe(200);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    release();
    await ended;
  }
});

it('returns nulls and does not create a settings row', async () => {
  await f.h.owner`DELETE FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const result = await f.db.withTenant(
    f.company,
    (tx) => businessIdentityQuery(tx, f.company, f.business, { read: readBusinessIdentity }),
    { userId: f.userId },
  );
  expect(result).toEqual({ official_name_ar: null, official_name_en: null, logo_file_id: null });
  const rows = await f.h.owner`SELECT business_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(rows).toHaveLength(0);
  const http = await read(f.cookie);
  expect(http.statusCode).toBe(200);
  expect(businessIdentity.parse(http.json())).toEqual(result);
});

interface ExplainNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: ExplainNode[];
}

function planNodes(node: ExplainNode | undefined): ExplainNode[] {
  return node ? [node, ...(node.Plans ?? []).flatMap(planNodes)] : [];
}
