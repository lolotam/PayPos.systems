import { z } from 'zod';

import { errorEnvelope } from './errors/envelope.js';
import { cashierPinVerified, verifyCashierPinInput } from './identity/cashier-pin.js';
import {
  claimDeviceInput,
  deviceRegistration,
  deviceToken,
  pairingCode,
  registerDeviceInput,
} from './identity/devices.js';
import { pageQuery } from './pagination/cursor.js';
import { currency } from './reference/currency.js';
import { timeZone } from './reference/time-zone.js';
import { business, createBusinessInput, verticalType } from './tenancy/business.js';
import { branch, createBranchInput, geo } from './tenancy/branch.js';
import { company, createCompanyInput } from './tenancy/company.js';
import { openingHours } from './tenancy/opening-hours.js';
import { plan } from './tenancy/plan.js';

const SCHEMAS = [
  errorEnvelope,
  pageQuery,
  plan,
  company,
  createCompanyInput,
  business,
  createBusinessInput,
  branch,
  createBranchInput,
  pairingCode,
  registerDeviceInput,
  deviceRegistration,
  claimDeviceInput,
  deviceToken,
  verifyCashierPinInput,
  cashierPinVerified,
  // المكوّنات المتداخلة لازم تتسجل هي كمان، وإلا Zod بيحطها تحت __shared بدل components.
  verticalType,
  currency,
  timeZone,
  geo,
  openingHours,
];

/**
 * بيبني وثيقة OpenAPI من الـ Zod schemas. دالة pure من غير fs، عشان الاختبار يقارن الملف
 * المحفوظ بالناتج ويقع لو حد غيّر contract ونسي يعمل pnpm contracts:openapi.
 * الـ paths فاضية لحد ما الـ controllers تيجي في T6b.
 *
 * @returns وثيقة OpenAPI 3.0 كـ object
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const registry = z.registry<{ id: string }>();
  for (const schema of SCHEMAS) {
    const meta = schema.meta();
    if (typeof meta?.['id'] !== 'string') throw new Error('Every published schema needs a meta id');
    registry.add(schema, { id: meta['id'] });
  }
  const { schemas } = z.toJSONSchema(registry, {
    target: 'openapi-3.0',
    io: 'input',
    uri: (schemaId) => `#/components/schemas/${schemaId}`,
  });
  // $id مش keyword صالح جوه schema object في OpenAPI 3.0؛ المرجع بيتم بالـ $ref بس.
  const components = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      const component: Record<string, unknown> = { ...schema };
      delete component['$id'];
      return [name, component];
    }),
  );
  return {
    openapi: '3.0.3',
    info: { title: 'PosPay API', version: '0.0.0' },
    paths: {},
    components: { schemas: components },
  };
}
