import { employeeAppLink } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';
import { EmployeeAppLinkController } from '../http/employee-app-link.controller.ts';
import type {
  EmployeeAppLinkBusiness,
  EmployeeAppLinkNamesFactory,
} from '../queries/employee-app-link.query.ts';

const company = '01920000-0000-7000-8000-0000000000c1';
const business = '01920000-0000-7000-8000-0000000000b1';
const user = '01920000-0000-7000-8000-0000000000a1';
const request = { principal: { companyId: company, userId: user } } as unknown as FastifyRequest;
const database = {
  withTenant: async (...args: unknown[]) => {
    const read = args[1] as (tx: never) => unknown;
    return read({} as never);
  },
} as unknown as TenantWrappers;

function controllerWith(result: EmployeeAppLinkBusiness | null) {
  const names: EmployeeAppLinkNamesFactory = () => ({ business: async () => result });
  return new EmployeeAppLinkController(database, names);
}

it('returns FORBIDDEN when the business disappears between the guard and the read', async () => {
  const reading = controllerWith(null).read(business, request);
  await expect(reading).rejects.toBeInstanceOf(ApiError);
  await expect(reading).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('returns the parsed employee-app link when the business still exists', async () => {
  const controller = controllerWith({ id: business, name_en: 'Synthetic business', name_ar: null });
  const result = await controller.read(business, request);
  expect(employeeAppLink.parse(result)).toEqual({
    company_id: company,
    business_id: business,
    business_name_en: 'Synthetic business',
    business_name_ar: null,
  });
});
