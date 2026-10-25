import { json, operation } from '../openapi-operation.js';
import { pendingDevicesQuery, pendingDevicesResponse } from './pending-devices.js';

// مسارات أجهزة الهوية كلها: التسجيل والطلب والتعريف، وقائمة الأجهزة المستنية في الفرع (spec 070).
// openapi.ts كان عند حد الـ 400 سطر، فمسارات الأجهزة معروضة من هنا.

const errors = {
  description:
    'The bilingual error envelope; a foreign branch and a missing permission share the same 403.',
  content: json('ErrorEnvelope'),
};
const badStatus = {
  description: 'The status query is missing or not pending',
  content: json('ErrorEnvelope'),
};

/** The schemas of the pending-device screen: the query it accepts and the list it returns. */
export const pendingDevicesSchemas = [pendingDevicesQuery, pendingDevicesResponse];

/** The branch's devices waiting for approval — the ids a manager approves (spec 070). */
export const pendingDevicesPaths = {
  '/v1/branches/{branchId}/devices': {
    get: {
      operationId: 'listPendingDevices',
      description:
        'The branch devices whose status is PENDING, newest first, one page of at most a hundred. Requires manage:devices:branch at the branch.',
      parameters: [
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'path',
          name: 'branchId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'query',
          name: 'status',
          required: true,
          schema: { type: 'string', enum: ['pending'] },
        },
        {
          in: 'query',
          name: 'cursor',
          required: false,
          schema: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' },
        },
        {
          in: 'query',
          name: 'limit',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': {
          description: 'The branch devices waiting for approval',
          content: json('PendingDevicesResponse'),
        },
        '400': badStatus,
        '403': errors,
        default: errors,
      },
    },
  },
};

/** The device routes of the identity module: the registration, the one-time claim and the device's identity. */
export const devicePaths = {
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
