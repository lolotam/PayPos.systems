import { z } from 'zod';

import { errorEnvelope } from './errors/envelope.js';
import { cashierPinVerified, verifyCashierPinInput } from './identity/cashier-pin.js';
import {
  myWorkspacesResponse,
  workspaceBranch,
  workspaceBusiness,
  workspaceCompany,
} from './identity/workspaces.js';
import {
  claimDeviceInput,
  deviceIdentity,
  deviceRegistration,
  deviceToken,
  pairingCode,
  registerDeviceInput,
} from './identity/devices.js';
import { pageQuery } from './pagination/cursor.js';
import { deliveryLogItem, deliveryLogPage, deliveryLogQuery } from './notifications.js';
import {
  businessSettings,
  calendar,
  language,
  taxRule,
  updateBusinessSettingsInput,
} from './settings/business-settings.js';
import { currency } from './reference/currency.js';
import { timeZone } from './reference/time-zone.js';
import { business, createBusinessInput, verticalType } from './tenancy/business.js';
import { branch, createBranchInput, geo } from './tenancy/branch.js';
import { company, createCompanyInput } from './tenancy/company.js';
import { openingHours } from './tenancy/opening-hours.js';
import { plan } from './tenancy/plan.js';

const SCHEMAS = [
  deliveryLogItem,
  deliveryLogPage,
  deliveryLogQuery,
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
  deviceIdentity,
  verifyCashierPinInput,
  cashierPinVerified,
  myWorkspacesResponse,
  workspaceBranch,
  workspaceBusiness,
  workspaceCompany,
  businessSettings,
  updateBusinessSettingsInput,
  // المكوّنات المتداخلة لازم تتسجل هي كمان، وإلا Zod بيحطها تحت __shared بدل components.
  verticalType,
  currency,
  timeZone,
  geo,
  openingHours,
  language,
  calendar,
  taxRule,
];

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

function operation(
  operationId: string,
  status: '200' | '201',
  description: string,
  response: string,
  body?: string,
) {
  return {
    operationId,
    ...(body === undefined ? {} : { requestBody: { required: true, content: json(body) } }),
    responses: {
      [status]: { description, content: json(response) },
      default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
    },
  };
}

// المسارات اللي الـ frontends بتكلمها بالعميل المولّد، بنفس الـ status اللي الـ controller بيرجّعه.
const PATHS = {
  '/v1/notifications/delivery-log': {
    get: logOperation('listCompanyNotificationDeliveries'),
  },
  '/v1/businesses/{businessId}/notifications/delivery-log': {
    get: logOperation('listBusinessNotificationDeliveries', 'businessId'),
  },
  '/v1/branches/{branchId}/notifications/delivery-log': {
    get: logOperation('listBranchNotificationDeliveries', 'branchId'),
  },
  '/v1/me/workspaces': {
    get: operation(
      'listMyWorkspaces',
      '200',
      'The companies, businesses and branches this session can open',
      'MyWorkspacesResponse',
    ),
  },
  '/v1/devices/register': {
    post: operation(
      'registerDevice',
      '201',
      'The device is registered and waits for approval',
      'DeviceRegistration',
      'RegisterDeviceInput',
    ),
  },
  '/v1/devices/claim': {
    post: operation(
      'claimDeviceToken',
      '200',
      'The approved device receives its token',
      'DeviceToken',
      'ClaimDeviceInput',
    ),
  },
  '/v1/devices/me': {
    get: operation('getDeviceIdentity', '200', 'The calling device', 'DeviceIdentity'),
  },
};

function logOperation(operationId: string, scope?: string) {
  return {
    ...operation(
      operationId,
      '200',
      'Provider submission log for the guarded scope',
      'DeliveryLogPage',
    ),
    parameters: [
      {
        in: 'header',
        name: 'x-company-id',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      { in: 'query', name: 'cursor', required: false, schema: { type: 'string' } },
      {
        in: 'query',
        name: 'limit',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      ...(scope === undefined
        ? []
        : [
            { in: 'path', name: scope, required: true, schema: { type: 'string', format: 'uuid' } },
          ]),
    ],
  };
}

/**
 * بيبني وثيقة OpenAPI من الـ Zod schemas. دالة pure من غير fs، عشان الاختبار يقارن الملف
 * المحفوظ بالناتج ويقع لو حد غيّر contract ونسي يعمل pnpm contracts:openapi.
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
    paths: PATHS,
    components: { schemas: components },
  };
}
