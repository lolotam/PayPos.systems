import { json, operation } from '../openapi-operation.js';
import { pendingDevicesQuery, pendingDevicesResponse } from './pending-devices.js';

// مسارات أجهزة الهوية كلها: التسجيل والطلب والتعريف، وقائمة أجهزة الفرع (spec 070 و071).
// openapi.ts كان عند حد الـ 400 سطر، فمسارات الأجهزة معروضة من هنا.

const errors = {
  description:
    'The bilingual error envelope; a foreign branch and a missing permission share the same 403.',
  content: json('ErrorEnvelope'),
};
const badStatus = {
  description: 'The status query is missing, or it is neither pending nor active',
  content: json('ErrorEnvelope'),
};

const companyHeader = {
  in: 'header',
  name: 'x-company-id',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const branchPath = {
  in: 'path',
  name: 'branchId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const devicePath = {
  in: 'path',
  name: 'deviceId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

/** The schemas of the pending-device screen: the query it accepts and the list it returns. */
export const pendingDevicesSchemas = [pendingDevicesQuery, pendingDevicesResponse];

/** The branch's devices — the pending ones a manager approves and the active ones a manager removes (spec 070, 071). */
export const pendingDevicesPaths = {
  '/v1/branches/{branchId}/devices': {
    get: {
      operationId: 'listPendingDevices',
      description:
        'The branch devices of one status — PENDING (newest first) or ACTIVE — one page of at most a hundred. Requires manage:devices:branch at the branch.',
      parameters: [
        companyHeader,
        branchPath,
        {
          in: 'query',
          name: 'status',
          required: true,
          schema: { type: 'string', enum: ['pending', 'active'] },
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
          description: 'The branch devices of the requested status',
          content: json('PendingDevicesResponse'),
        },
        '400': badStatus,
        '403': errors,
        default: errors,
      },
    },
  },
  '/v1/branches/{branchId}/devices/pairing-code': {
    post: {
      operationId: 'issuePairingCode',
      description:
        'A single-use pairing code for one branch, valid ten minutes. Issuing a code cancels the branch’s previous live code.',
      parameters: [companyHeader, branchPath],
      responses: {
        '201': {
          description: 'The pairing code and when it expires',
          content: json('PairingCode'),
        },
        '403': errors,
        default: errors,
      },
    },
  },
  '/v1/branches/{branchId}/devices/{deviceId}/approve': {
    post: {
      operationId: 'approveDevice',
      description: 'The manager approves a pending device of their branch.',
      parameters: [companyHeader, branchPath, devicePath],
      responses: {
        '204': { description: 'The device is active' },
        '403': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/branches/{branchId}/devices/{deviceId}/revoke': {
    post: {
      operationId: 'revokeDevice',
      description:
        'The manager refuses a pending device or removes an active one; the device loses its access at once.',
      parameters: [companyHeader, branchPath, devicePath],
      responses: {
        '204': { description: 'The device is revoked' },
        '403': errors,
        '404': errors,
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
