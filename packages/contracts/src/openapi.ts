import { z } from 'zod';
import { unbindPasskeySchemas } from './staff/unbind-passkey.js';
import { unbindPasskeyPaths } from './staff/unbind-passkey-openapi.js';
import { leaveSchemas } from './staff/leave.js';
import { employeeDocumentSchemas } from './staff/employee-documents.js';
import { employeeDocumentPaths } from './staff/employee-documents-openapi.js';
import { leaveDecisionSchemas } from './staff/leave-decision.js';
import { leavePaths } from './staff/leave-openapi.js';
import { attendanceExceptionSchemas } from './staff/attendance-exception.js';
import { attendanceExceptionPaths } from './staff/attendance-exception-openapi.js';
import { attendanceCorrectionSchemas } from './staff/attendance-correction.js';
import { attendanceCorrectionPaths } from './staff/attendance-correction-openapi.js';
import { passkeySchemas } from './staff/passkeys.js';
import { clockAttendanceSchemas } from './staff/clock-attendance.js';
import { clockAttendancePaths } from './staff/clock-attendance-openapi.js';
import { clockByCardSchemas } from './staff/clock-by-card.js';
import { clockByCardPaths } from './staff/clock-by-card-openapi.js';
import { employeeCardSchemas } from './staff/employee-cards.js';
import { employeeCardPaths } from './staff/employee-cards-openapi.js';
import { passkeyPaths } from './staff/passkeys-openapi.js';
import { scheduleSchemas } from './staff/schedules.js';
import {
  setSalaryInput,
  employeeSalary,
  salaryHistoryQuery,
  salaryHistoryPage,
} from './staff/salary.js';
import { settingsPaths } from './settings/settings-openapi.js';
import { notificationPaths } from './notifications-openapi.js';
import { filePaths, fileSchemas } from './files-openapi.js';
import { employee, createEmployeeInput, employeeRoleCode, employeeDate } from './staff/employee.js';
import {
  employeeImportColumn,
  employeeImportErrorCode,
  employeeImportRowError,
  employeeImportTemplate,
  previewEmployeeImportInput,
  employeeImportPreview,
  commitEmployeeImportInput,
  employeeImportCommit,
  employeeImportCommitAccepted,
  employeeImportStatus,
} from './staff/employee-import.js';
import { employeeImportPaths } from './staff/employee-import-openapi.js';
import { staffPaths } from './staff/staff-openapi.js';
import {
  updateEmployeeInput,
  employeeDetailRecord,
  employeeListItem,
  employeePage,
  employeeListQuery,
} from './staff/update-employee.js';
import { permissionPaths, permissionSchemas } from './identity/permissions-openapi.js';
import { staffSignInPaths } from './identity/staff-sign-in-openapi.js';
import { customer, findOrCreateCustomerInput } from './customers.js';
import { customerPaths } from './customers-openapi.js';
import { catalogPaths, catalogSchemas } from './catalog/catalog-openapi.js';
import { attendanceQrToken, attendanceQrBranch, attendanceQrIssue } from './staff/attendance-qr.js';
import {
  staffOtpRequestInput,
  staffOtpVerifyInput,
  staffOtpAcknowledgement,
  staffSessionContext,
  staffPinInput,
  staffPinResetInput,
} from './identity/staff-otp.js';

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
  inAppNotification,
  inAppNotificationPage,
  inAppNotificationQuery,
  notificationUnreadCount,
  notificationReadResult,
} from './in-app-notifications.js';
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
import {
  whatsappEnvelope,
  whatsappHandshake,
  whatsappWebhookAcknowledgement,
} from './whatsapp-webhook.js';

const SCHEMAS = [
  ...employeeDocumentSchemas,
  ...clockAttendanceSchemas,
  ...clockByCardSchemas,
  ...employeeCardSchemas,
  ...leaveSchemas,
  ...leaveDecisionSchemas,
  ...attendanceExceptionSchemas,
  ...attendanceCorrectionSchemas,
  ...passkeySchemas,
  ...unbindPasskeySchemas,
  ...scheduleSchemas,
  setSalaryInput,
  employeeSalary,
  salaryHistoryQuery,
  salaryHistoryPage,
  updateEmployeeInput,
  employeeDetailRecord,
  employeeListItem,
  employeePage,
  employeeListQuery,
  ...permissionSchemas,
  ...fileSchemas,
  employee,
  createEmployeeInput,
  employeeRoleCode,
  employeeDate,
  employeeImportColumn,
  employeeImportErrorCode,
  employeeImportRowError,
  employeeImportTemplate,
  previewEmployeeImportInput,
  employeeImportPreview,
  commitEmployeeImportInput,
  employeeImportCommit,
  employeeImportCommitAccepted,
  employeeImportStatus,
  customer,
  findOrCreateCustomerInput,
  ...catalogSchemas,
  attendanceQrToken,
  attendanceQrBranch,
  attendanceQrIssue,
  staffPinInput,
  staffPinResetInput,
  staffOtpRequestInput,
  staffOtpVerifyInput,
  staffOtpAcknowledgement,
  staffSessionContext,
  whatsappWebhookAcknowledgement,
  whatsappEnvelope,
  whatsappHandshake,
  inAppNotification,
  inAppNotificationPage,
  inAppNotificationQuery,
  notificationUnreadCount,
  notificationReadResult,
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
  status: '200' | '201' | '202',
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
  ...employeeDocumentPaths,
  ...employeeImportPaths,
  ...passkeyPaths,
  ...clockAttendancePaths,
  ...clockByCardPaths,
  ...employeeCardPaths,
  ...unbindPasskeyPaths,
  ...settingsPaths,
  ...filePaths,
  ...staffPaths,
  ...leavePaths,
  ...attendanceExceptionPaths,
  ...attendanceCorrectionPaths,
  ...permissionPaths,
  ...customerPaths,
  ...catalogPaths,
  '/v1/devices/me/attendance-qr': {
    post: {
      ...operation(
        'issueAttendanceQr',
        '200',
        'Current QR for the authenticated device branch',
        'AttendanceQrIssue',
      ),
      security: [{ DeviceToken: [] }],
    },
  },
  ...staffSignInPaths,
  '/v1/webhooks/whatsapp': {
    get: {
      operationId: 'verifyWhatsappWebhook',
      security: [],
      parameters: [
        {
          in: 'query',
          name: 'hub.mode',
          required: true,
          schema: { type: 'string', enum: ['subscribe'] },
        },
        {
          in: 'query',
          name: 'hub.verify_token',
          required: true,
          schema: { type: 'string', maxLength: 512 },
        },
        {
          in: 'query',
          name: 'hub.challenge',
          required: true,
          schema: { type: 'string', maxLength: 256 },
        },
      ],
      responses: {
        '200': {
          description: 'Verified subscription challenge',
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
    },
    post: {
      ...operation(
        'receiveWhatsappWebhook',
        '200',
        'Committed and enqueued',
        'WhatsappWebhookAcknowledgement',
        'WhatsappEnvelope',
      ),
      security: [],
      parameters: [
        {
          in: 'header',
          name: 'X-Hub-Signature-256',
          required: true,
          schema: { type: 'string', pattern: '^sha256=[a-fA-F0-9]{64}$' },
        },
      ],
      description:
        'Meta HMAC over original body bytes; STOP commits before enqueue and acknowledgement.',
    },
  },
  ...notificationPaths,
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
    components: {
      schemas: components,
      securitySchemes: {
        PersonalStaffSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'pospay-personal.session_token',
          description: 'LIMITED STAFF_PERSONAL purpose; own routes only.',
        },
        KioskStaffSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'pospay-staff.session_token',
          description: 'STAFF_POS purpose; requires the paired Device credential.',
        },
        DeviceToken: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Device authentication scheme',
        },
      },
    },
  };
}
