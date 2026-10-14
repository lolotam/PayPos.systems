import { PROVISIONAL_PLAN_ID } from '@pospay/db';

import { idOf, postJson, type SeedTarget } from './seed-e2e-http.ts';

export interface CatalogService {
  readonly id: string;
  readonly name: string;
  readonly price: string;
}

export interface CatalogEmployee {
  readonly id: string;
  readonly name: string;
}

export interface SeedTenant {
  readonly companyId: string;
  readonly companyName: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly timeZone: string;
  readonly services: readonly CatalogService[];
  readonly employees: readonly CatalogEmployee[];
}

function timeZoneOf(body: Record<string, unknown>): string {
  const zone = body['effective_timezone'];
  if (typeof zone !== 'string' || zone === '') throw new Error('e2e:seed branch timezone missing');
  return zone;
}

async function createServices(
  target: SeedTarget,
  cookie: string,
  companyId: string,
  businessId: string,
  label: string,
): Promise<CatalogService[]> {
  const priced = [
    ['Standard', '25.000'],
    ['Odd', '7.125'],
  ] as const;
  const services: CatalogService[] = [];
  for (const [kind, price] of priced) {
    const name = `E2E ${label} ${kind}`;
    const body = await postJson(target, `/v1/businesses/${businessId}/services`, cookie, companyId, {
      name_en: name,
      price,
      commission_rule: { kind: 'FOLLOW_PLAN' },
    });
    services.push({ id: idOf(body, '/v1/services'), name, price });
  }
  return services;
}

async function createEmployees(
  target: SeedTarget,
  cookie: string,
  companyId: string,
  businessId: string,
  branchId: string,
  label: string,
): Promise<CatalogEmployee[]> {
  const employees: CatalogEmployee[] = [];
  for (const person of ['Ada', 'Bea', 'Cleo', 'Dina']) {
    const name = `E2E ${label} ${person}`;
    const body = await postJson(target, `/v1/businesses/${businessId}/employees`, cookie, companyId, {
      primary_branch_id: branchId,
      name_en: name,
      role_code: 'staff',
      hire_date: '2026-01-01',
    });
    employees.push({ id: idOf(body, '/v1/employees'), name });
  }
  return employees;
}

export async function createTenant(
  target: SeedTarget,
  cookie: string,
  label: string,
  catalog: boolean,
): Promise<SeedTenant> {
  const companyName = `E2E ${label}`;
  const company = await postJson(target, '/v1/companies', cookie, undefined, {
    name_en: companyName,
    plan_id: PROVISIONAL_PLAN_ID,
  });
  const companyId = idOf(company, '/v1/companies');
  const business = await postJson(target, '/v1/businesses', cookie, companyId, {
    vertical_type: 'salon',
    name_en: `${companyName} Salon`,
  });
  const businessId = idOf(business, '/v1/businesses');
  const branchName = `${companyName} Branch`;
  const branch = await postJson(target, `/v1/businesses/${businessId}/branches`, cookie, companyId, {
    name_en: branchName,
  });
  const branchId = idOf(branch, '/v1/branches');
  const services = catalog ? await createServices(target, cookie, companyId, businessId, label) : [];
  const employees = catalog
    ? await createEmployees(target, cookie, companyId, businessId, branchId, label)
    : [];
  return {
    companyId,
    companyName,
    businessId,
    branchId,
    branchName,
    timeZone: timeZoneOf(branch),
    services,
    employees,
  };
}
