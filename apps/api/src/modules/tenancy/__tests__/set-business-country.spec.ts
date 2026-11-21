import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { createTenancyTransactions } from '../persistence/tenancy-transactions.ts';
import { SetBusinessCountry } from '../use-cases/set-business-country/set-business-country.ts';
import type { TenancyTransactions } from '../ports/tenancy-transactions.port.ts';

// 34-pre-3 عبر الـ API على Postgres حقيقي: تغيير واحد مُدوَّن، والقيمة المتساوية بلا كتابة ولا تدقيق،
// والرفض نفسه للنشاط الغائب والأجنبي، والصلاحية على النشاط، وإنشاء نشاط بدولة صالحة أو غير صالحة أو بلا دولة.
let f: PermissionFixture;
let owner: string;
let business: string;
let otherBusiness: string;
let foreignBusiness: string;

const deviceRole = SYSTEM_ROLES.find((role) => role.code === 'device')?.id ?? '';

/** صف تدقيق دولة النشاط كما يرجعه الاستعلام، بقيمة ما قبل وما بعد. */
interface CountryAuditRow {
  readonly before: { readonly country: string | null };
  readonly after: { readonly country: string };
}

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

describe('the country change route (B-6/B-7)', () => {
  it('sets a country on a business with template and custom keys, keeping them and auditing once', async () => {
    const created = await f.h.send('POST', '/v1/businesses', {
      cookie: owner,
      company: f.company,
      key: 'country-34p3-business',
      body: { vertical_type: 'salon', name_en: 'Country Salon', settings: { features: ['tables'], custom_key: 7 } },
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
    const audits = await countryAudits(id);
    expect(audits).toEqual([{ before: { country: null }, after: { country: 'KW' } }]);
  });

  it('sets the first value on the fixture business and audits unset before it', async () => {
    const res = await put({ country: 'KW' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ business_id: business, country: 'KW' });
    expect(await settingsOf()).toMatchObject({ country: 'KW' });
    expect(await countryAudits()).toEqual([{ before: { country: null }, after: { country: 'KW' } }]);
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
    expect(
      newStatements.filter((statement) => /UPDATE\s+businesses/i.test(statement.sql)),
    ).toEqual([]);
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

  it('answers unknown and foreign businesses with the same refusal and writes nothing', async () => {
    const foreignBefore = await settingsOf(foreignBusiness, f.otherCompany);
    const unknown = await put({ country: 'KW' }, owner, f.company, '01920000-0000-7000-8000-00000000ffff');
    const foreign = await put({ country: 'KW' }, owner, f.company, foreignBusiness);
    expect(unknown.status).toBe(foreign.status);
    // الصف الأجنبي بيتحقق تحت شركته هو، مش تحت شركة الفاعل، فالتطابق مش اجتياز على صف مش شايفه.
    expect(await settingsOf(foreignBusiness, f.otherCompany)).toEqual(foreignBefore);
    expect(await countryAudits(foreignBusiness, f.otherCompany)).toEqual([]);
  });

  it('refuses a member without manage:settings:business, a device principal, and grants an override holder', async () => {
    const denied = await put({ country: 'QA' }, f.managerCookie);
    expect(denied.status).toBe(403);
    // الجهاز مرفوض حتى لو معه ALLOW، زي سابق قواعد التنبيه AL-Q1؛ فنغيّر الدور ونجرب ثم نرجّع الدور.
    await f.h.owner`UPDATE memberships SET role_id=${deviceRole}, role_owner_key='global'
      WHERE company_id=${f.company} AND id=${f.managerMember}`;
    const device = await put({ country: 'QA' }, f.managerCookie);
    expect(device.status).toBe(403);
    await f.h.owner`UPDATE memberships SET role_id=(SELECT id FROM roles WHERE company_id=${f.company} AND code='synthetic_editor'),
      role_owner_key=${f.company} WHERE company_id=${f.company} AND id=${f.managerMember}`;
    const granted = await seedOverride(f, f.managerMember, {
      permission_code: 'manage:settings:business',
      scope_type: 'BUSINESS',
      scope_id: business,
    });
    const allowed = await put({ country: 'BH' }, f.managerCookie);
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${granted}`;
    expect(allowed.status).toBe(200);
    expect(await settingsOf()).toMatchObject({ country: 'BH' });
  });

  it('orders two concurrent changes so the later audit continues from the earlier audit value', async () => {
    const before = await settingsOf();
    const [first, second] = await Promise.all([
      put({ country: 'KW' }),
      put({ country: 'QA' }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const stored = (await settingsOf())['country'];
    expect(['KW', 'QA']).toContain(stored);
    const audits = await countryAudits();
    // زوج التغييرات المتزامنة: سجلّا تدقيق جديدين اثنين بالظبط، والأخير بيكمل من قيمة الأول، وآخرها = المخزّن.
    expect(audits.length).toBeGreaterThanOrEqual(4);
    const penultimate = audits[audits.length - 2] as CountryAuditRow;
    const last = audits[audits.length - 1] as CountryAuditRow;
    expect(penultimate.before.country).not.toBeNull();
    expect(last.before.country).toBe(penultimate.after.country);
    expect(last.after.country).toBe(stored);
    expect(before['country']).not.toBe(stored);
  });
});

describe('audit-failure rollback (BD-05 pattern)', () => {
  it('rolls the country write back and records no audit row when the audit fails', async () => {
    const before = await settingsOf();
    const auditCount = (await countryAudits()).length;
    const real = createTenancyTransactions(f.db, f.ids);
    const transactions: TenancyTransactions = {
      run: (context, idempotency, work) => real.run(context, idempotency, work),
      runBusinessCountryChange: (context, work) =>
        real.runBusinessCountryChange(context, (scope) =>
          work({
            ...scope,
            audit: {
              record: async () => {
                throw new Error('Synthetic audit failure');
              },
            },
          }),
        ),
    };
    const useCase = new SetBusinessCountry(transactions);
    await expect(
      useCase.execute({ companyId: f.company, userId: f.userId, businessId: business, country: 'KW' }),
    ).rejects.toThrow('Synthetic audit failure');
    expect(await settingsOf()).toEqual(before);
    expect(await countryAudits()).toHaveLength(auditCount);
  });
});

describe('the create path (B-5, OQ-2, manager disposition 2026-11-21)', () => {
  it('reserves the country key at creation: a valid code is refused like an invalid one', async () => {
    for (const attempted of ['AE', 'EG']) {
      const res = await f.h.send('POST', '/v1/businesses', {
        cookie: owner,
        company: f.company,
        key: `country-34p3-create-${attempted}`,
        body: { vertical_type: 'salon', name_en: `Create ${attempted}`, settings: { country: attempted } },
      });
      expect(res.status, attempted).toBe(400);
    }
  });

  it('keeps every other settings key on create, and the scoped PUT remains the only country setter', async () => {
    const res = await f.h.send('POST', '/v1/businesses', {
      cookie: owner,
      company: f.company,
      key: 'country-34p3-create-absent',
      body: { vertical_type: 'salon', name_en: 'No Country', settings: { features: ['tables'], custom_key: 7 } },
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
