import { errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { businessCountry } from '../queries/business-country.query.ts';
import { claimPayload } from '../../../../test/device-claim.ts';

// 34-pre-3 عبر الـ API على Postgres حقيقي: تغيير واحد مُدوَّن، والقيمة المتساوية بلا كتابة ولا تدقيق،
// والرفض 403 الصريح للنشاط الغائب والأجنبي والجهاز، وصلاحية النشاط وحده، وإرث الإعدادات غير الكائنية،
// وإنشاء نشاط يحجز مفتاح country. التزامن تحت قفل الصف وفشل التدقيق في ملف المعاملات نفسه.

let f: PermissionFixture;
let owner: string;
let business: string;
let otherBusiness: string;
let foreignBusiness: string;

beforeAll(async () => {
  f = await permissionFixture();
  owner = f.cookie;
  business = f.business;
  otherBusiness = f.otherBusiness;
  foreignBusiness = await foreignBusinessId();
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function foreignBusinessId(): Promise<string> {
  const [row] = await f.h
    .owner`SELECT business_id FROM branches WHERE company_id = ${f.otherCompany} AND id = ${f.foreignBranch}`;
  return row?.['business_id'] as string;
}

const put = (body: object, cookie = owner, company = f.company, id = business) =>
  f.h.send('PUT', `/v1/businesses/${id}/country`, { cookie, company, body });

const settingsOf = async (id = business, company = f.company): Promise<Record<string, unknown>> => {
  const [row] = await f.h
    .owner`SELECT settings FROM businesses WHERE company_id = ${company} AND id = ${id}`;
  return (row?.['settings'] ?? {}) as Record<string, unknown>;
};

const countryAudits = async (id = business, company = f.company) =>
  f.h.owner`SELECT before, after FROM audit_log
    WHERE company_id = ${company} AND entity = 'business' AND entity_id = ${id}
      AND action = 'country.changed' ORDER BY id`;

describe('setting a country after creation (B-6)', () => {
  it('sets a country on a business with template and custom keys, keeping them and auditing once', async () => {
    const created = await f.h.send('POST', '/v1/businesses', {
      cookie: owner,
      company: f.company,
      key: 'country-34p3-business',
      body: {
        vertical_type: 'salon',
        name_en: 'Country Salon',
        settings: { features: ['tables'], custom_key: 7 },
      },
    });
    expect(created.status).toBe(201);
    const id = created.body['id'] as string;
    const res = await put({ country: 'KW' }, owner, f.company, id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ business_id: id, country: 'KW' });
    expect(await settingsOf(id)).toEqual({
      modules: expect.anything(),
      features: ['tables'],
      custom_key: 7,
      country: 'KW',
    });
    expect(await countryAudits(id)).toEqual([
      { before: { country: null }, after: { country: 'KW' } },
    ]);
  });
});

describe('the country change route (B-6/B-7)', () => {
  it('sets the first value on the fixture business and audits unset before it', async () => {
    const res = await put({ country: 'KW' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ business_id: business, country: 'KW' });
    expect(await settingsOf()).toMatchObject({ country: 'KW' });
    expect(await countryAudits()).toEqual([
      { before: { country: null }, after: { country: 'KW' } },
    ]);
  });

  it('changes the value and audits the country before and after only', async () => {
    const res = await put({ country: 'SA' });
    expect(res.status).toBe(200);
    expect(await settingsOf()).toMatchObject({ country: 'SA' });
    expect(await countryAudits()).toEqual([
      { before: { country: null }, after: { country: 'KW' } },
      { before: { country: 'KW' }, after: { country: 'SA' } },
    ]);
  });

  it('answers 200 for the same value again without an UPDATE or a new audit row', async () => {
    const statementsBefore = f.h.calls.statements.length;
    const res = await put({ country: 'SA' });
    expect(res.status).toBe(200);
    expect(await countryAudits()).toHaveLength(2);
    expect(await settingsOf()).toMatchObject({ country: 'SA' });
    const newStatements = f.h.calls.statements.slice(statementsBefore);
    expect(newStatements.filter((statement) => /UPDATE\s+businesses/i.test(statement.sql))).toEqual(
      [],
    );
  });

  it('reaches a second business of the same company independently', async () => {
    const res = await put({ country: 'OM' }, owner, f.company, otherBusiness);
    expect(res.status).toBe(200);
    expect(await settingsOf(otherBusiness)).toMatchObject({ country: 'OM' });
  });
});

describe('the route refusals (B-7, B-8)', () => {
  it('refuses a country outside the permitted six and leaves the row unchanged', async () => {
    const res = await put({ country: 'EG' });
    expect(res.status).toBe(400);
    expect(await settingsOf()).toMatchObject({ country: 'SA' });
    expect(await countryAudits()).toHaveLength(2);
  });

  it('answers unknown and foreign businesses with the same 403 envelope and writes nothing', async () => {
    const foreignBefore = await settingsOf(foreignBusiness, f.otherCompany);
    const unknown = await put(
      { country: 'KW' },
      owner,
      f.company,
      '01920000-0000-7000-8000-00000000ffff',
    );
    const foreign = await put({ country: 'KW' }, owner, f.company, foreignBusiness);
    expect(unknown.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect(errorEnvelope.parse(unknown.body).code).toBe('FORBIDDEN');
    expect(errorEnvelope.parse(foreign.body).code).toBe('FORBIDDEN');
    // الصف الأجنبي بيتحقق تحت شركته هو، مش تحت شركة الفاعل، والتطابق ما يعنيش اجتياز على صف مش شايفه.
    expect(await settingsOf(foreignBusiness, f.otherCompany)).toEqual(foreignBefore);
    expect(await countryAudits(foreignBusiness, f.otherCompany)).toEqual([]);
    expect(await countryAudits()).toHaveLength(2);
  });

  it('refuses a member without manage:settings:business with the 403 envelope', async () => {
    const denied = await put({ country: 'QA' }, f.managerCookie);
    expect(denied.status).toBe(403);
    expect(errorEnvelope.parse(denied.body).code).toBe('FORBIDDEN');
    expect(await settingsOf()).toMatchObject({ country: 'SA' });
  });
});

describe('a real authenticated Device principal (403)', () => {
  it('refuses a Device principal paired through the real device routes', async (ctx) => {
    try {
      await f.h.redis.ping();
    } catch (error) {
      if (process.env['CI'] === 'true') throw error;
      ctx.skip('the local test lane has no Redis for the device routes');
      return;
    }
    // الأداة الحقيقية: رمز اقتران جهاز مصادق عليه من مسار الأجهزة الفعلي، مش كوكي عضوية معاد تسميتها.
    const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
      cookie: owner,
      company: f.company,
    });
    expect(code.status).toBe(201);
    const registered = await f.h.app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      payload: { pairing_code: code.body['code'], label: 'Synthetic country refusal' },
    });
    expect(registered.statusCode).toBe(201);
    const device = registered.json<{
      company_id: string;
      device_id: string;
      claim_secret: string;
    }>();
    const approved = await f.h.send(
      'POST',
      `/v1/branches/${f.branch}/devices/${device.device_id}/approve`,
      { cookie: owner, company: f.company },
    );
    expect(approved.status).toBe(204);
    const claimed = await f.h.app.inject({
      method: 'POST',
      url: '/v1/devices/claim',
      payload: claimPayload(device),
    });
    expect(claimed.statusCode).toBe(200);
    const token = claimed.json<{ device_token: string }>().device_token;
    const res = await f.h.app.inject({
      method: 'PUT',
      url: `/v1/businesses/${business}/country`,
      headers: { authorization: `Device ${token}`, 'x-company-id': f.company },
      payload: { country: 'KW' },
    });
    expect(res.statusCode).toBe(403);
    expect(errorEnvelope.parse(res.json()).code).toBe('FORBIDDEN');
    expect(await settingsOf()).toMatchObject({ country: 'SA' });
    expect(await countryAudits()).toHaveLength(2);
  });
});

describe('the sibling refusal with a business-only holder (OQ-2 scope)', () => {
  it('grants a business-only holder this business and refuses her the sibling before the grant is removed', async () => {
    const granted = await seedOverride(f, f.managerMember, {
      permission_code: 'manage:settings:business',
      scope_type: 'BUSINESS',
      scope_id: business,
    });
    const allowed = await put({ country: 'BH' }, f.managerCookie);
    expect(allowed.status).toBe(200);
    expect(await settingsOf()).toMatchObject({ country: 'BH' });
    // الأخت قبل شيل التفويض: نطاق BUSINESS الواحد ما بيمتدش لنشاط تاني، والإعدادات والتدقيق سليمين.
    const sibling = await put({ country: 'KW' }, f.managerCookie, f.company, otherBusiness);
    expect(sibling.status).toBe(403);
    expect(errorEnvelope.parse(sibling.body).code).toBe('FORBIDDEN');
    expect(await settingsOf(otherBusiness)).toMatchObject({ country: 'OM' });
    expect(await countryAudits(otherBusiness)).toHaveLength(1);
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${granted}`;
  });
});

describe('legacy non-object settings (manager correction 2026-11-21, item 1)', () => {
  // الأشكال الإرثية الثلاثة: jsonb null (المكافئ الفارغ لأن العمود NOT NULL)، ومصفوفة، وعدد.
  const legacyCases: [string, string, string][] = [
    ['a jsonb null', "'null'::jsonb", 'null'],
    ['a JSON array', "'[]'::jsonb", 'array'],
    ['a JSON scalar', "'965'::jsonb", 'number'],
  ];

  it.each(legacyCases)(
    'sets a country on a business whose settings are %s, merging from {}',
    async (_label, literal, expectedKind) => {
      const created = await f.h.send('POST', '/v1/businesses', {
        cookie: owner,
        company: f.company,
        key: `country-34p3-legacy-${expectedKind}`,
        body: { vertical_type: 'salon', name_en: `Legacy ${expectedKind}` },
      });
      expect(created.status).toBe(201);
      const id = created.body['id'] as string;
      // قيم ثابتة من هذا الملف فقط عبر unsafe — المسار الموثّق لpostgres.js للـ SQL الخام.
      await f.h.owner.unsafe(
        `UPDATE businesses SET settings = ${literal} WHERE company_id = '${f.company}' AND id = '${id}'`,
      );
      const [kindRow] = await f.h
        .owner`SELECT jsonb_typeof(settings) AS kind FROM businesses WHERE company_id=${f.company} AND id=${id}`;
      expect(kindRow?.['kind']).toBe(expectedKind);
      // القارئ الداخلي قبل التغيير: إرث غير كائني يعني «غير محددة»، مش قيمة ولا JSON خام.
      const readerBefore = await f.db.withTenant(f.company, (tx) =>
        businessCountry(tx, f.company, id),
      );
      expect(readerBefore).toEqual({ country: null });
      const res = await put({ country: 'KW' }, owner, f.company, id);
      expect(res.status).toBe(200);
      expect(await settingsOf(id)).toEqual({ country: 'KW' });
      const readerAfter = await f.db.withTenant(f.company, (tx) =>
        businessCountry(tx, f.company, id),
      );
      expect(readerAfter).toEqual({ country: 'KW' });
      const audits = await countryAudits(id);
      expect(audits).toEqual([{ before: { country: null }, after: { country: 'KW' } }]);
    },
  );
});

describe('the create path (B-5, OQ-2, manager disposition 2026-11-21)', () => {
  it('reserves the country key at creation: a valid code is refused like an invalid one', async () => {
    for (const attempted of ['AE', 'EG']) {
      const res = await f.h.send('POST', '/v1/businesses', {
        cookie: owner,
        company: f.company,
        key: `country-34p3-create-${attempted}`,
        body: {
          vertical_type: 'salon',
          name_en: `Create ${attempted}`,
          settings: { country: attempted },
        },
      });
      expect(res.status, attempted).toBe(400);
    }
  });

  it('keeps every other settings key on create, and the scoped PUT remains the only country setter', async () => {
    const res = await f.h.send('POST', '/v1/businesses', {
      cookie: owner,
      company: f.company,
      key: 'country-34p3-create-absent',
      body: {
        vertical_type: 'salon',
        name_en: 'No Country',
        settings: { features: ['tables'], custom_key: 7 },
      },
    });
    expect(res.status).toBe(201);
    const id = res.body['id'] as string;
    expect(await settingsOf(id)).toEqual({
      modules: expect.anything(),
      features: ['tables'],
      custom_key: 7,
    });
    const listed = await f.h.send('GET', '/v1/businesses', { cookie: owner, company: f.company });
    expect(listed.status).toBe(200);
    const items = listed.body['items'] as { id: string; settings: Record<string, unknown> }[];
    expect('country' in (items.find((item) => item.id === id)?.settings ?? {})).toBe(false);
    const set = await put({ country: 'SA' }, owner, f.company, id);
    expect(set.status).toBe(200);
    expect(await settingsOf(id)).toEqual({
      modules: expect.anything(),
      features: ['tables'],
      custom_key: 7,
      country: 'SA',
    });
    expect(await countryAudits(id, f.company)).toEqual([
      { before: { country: null }, after: { country: 'SA' } },
    ]);
  });
});
