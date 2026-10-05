import { workspaceCompany } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { workspaceScopeNames } from './scope-names';

const company = workspaceCompany.parse({
  id: '01920000-0000-7000-8000-000000000001',
  name_en: 'Synthetic Company',
  name_ar: 'شركة تجريبية',
  role_code: 'owner',
  scope: 'COMPANY',
  businesses: [
    {
      id: '01920000-0000-7000-8000-000000000002',
      name_en: 'Synthetic Business',
      name_ar: null,
      branches: [
        {
          id: '01920000-0000-7000-8000-000000000003',
          name_en: 'Synthetic Branch',
          name_ar: 'فرع تجريبي',
          effective_timezone: 'Asia/Kuwait',
          is_active: true,
        },
      ],
    },
  ],
});

it('resolves all loaded scope levels with the existing Arabic name fallback', () => {
  const business = company.businesses[0];
  const branch = business?.branches[0];
  if (!business || !branch) throw new Error('Synthetic workspace fixtures are missing');
  const ar = workspaceScopeNames(company, 'ar');
  expect(ar[`COMPANY:${company.id}`]).toBe(company.name_ar);
  expect(ar[`BUSINESS:${business.id}`]).toBe(business.name_en);
  expect(ar[`BRANCH:${branch.id}`]).toBe(branch.name_ar);
  const en = workspaceScopeNames(company, 'en');
  expect(en[`COMPANY:${company.id}`]).toBe(company.name_en);
  expect(en[`BRANCH:${branch.id}`]).toBe(branch.name_en);
  expect(en['COMPANY:unknown']).toBeUndefined();
});
