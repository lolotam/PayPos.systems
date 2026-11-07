import { ownTipsPaths } from './orders/own-tips-openapi.js';
import { personalBranchesPaths } from './staff/personal-branches-openapi.js';
import { ownAttendancePaths } from './staff/own-attendance-openapi.js';
import { z } from 'zod';
import { packageImportPreviewPaths } from './orders/package-import-preview-openapi.js';
import { serviceSessionFormPaths } from './orders/service-session-form-openapi.js';
import { serviceSessionPaths } from './orders/service-session-openapi.js';
import { discountApprovalPaths } from './orders/discount-approval-openapi.js';
import { serviceSessionRecoveryPaths } from './orders/service-session-recovery-openapi.js';
import { attendanceMonthlyReportPaths } from './staff/attendance-monthly-report-openapi.js';
import { employeeIbanPaths } from './staff/employee-iban-openapi.js';
import { commissionPaths } from './commissions/openapi.js';
import { unbindPasskeyPaths } from './staff/unbind-passkey-openapi.js';
import { employeeDocumentPaths } from './staff/employee-documents-openapi.js';
import { leavePaths } from './staff/leave-openapi.js';
import { attendanceExceptionPaths } from './staff/attendance-exception-openapi.js';
import { attendanceCorrectionPaths } from './staff/attendance-correction-openapi.js';
import { attendanceChangePaths } from './staff/attendance-change-request-openapi.js';
import { clockAttendancePaths } from './staff/clock-attendance-openapi.js';
import { clockByCardPaths } from './staff/clock-by-card-openapi.js';
import { employeeCardPaths } from './staff/employee-cards-openapi.js';
import { passkeyPaths } from './staff/passkeys-openapi.js';
import { settingsPaths } from './settings/settings-openapi.js';
import { alertRulePaths } from './settings/alert-rules-openapi.js';
import { staffColumnsPaths } from './settings/staff-columns-openapi.js';
import { notificationPaths } from './notifications-openapi.js';
import { filePaths } from './files-openapi.js';
import { employeeImportPaths } from './staff/employee-import-openapi.js';
import { staffPaths } from './staff/staff-openapi.js';
import { permissionPaths } from './identity/permissions-openapi.js';
import { devicePaths, pendingDevicesPaths } from './identity/devices-openapi.js';
import { staffSignInPaths } from './identity/staff-sign-in-openapi.js';
import { privateViewPaths } from './identity/private-view-openapi.js';
import { mePaths } from './identity/me-openapi.js';
import { customerPaths } from './customers-openapi.js';
import { ratingSettingsPaths } from './customers/rating-settings-openapi.js';
import { catalogPaths } from './catalog/catalog-openapi.js';
import { json, operation } from './openapi-operation.js';
import { openApiSchemas } from './openapi-schemas.js';

// المسارات اللي الـ frontends بتكلمها بالعميل المولّد، بنفس الـ status اللي الـ controller بيرجّعه.
const PATHS = {
  ...ownTipsPaths,
  ...ownAttendancePaths,
  ...personalBranchesPaths,
  ...packageImportPreviewPaths,
  ...attendanceMonthlyReportPaths,
  ...employeeIbanPaths,
  ...commissionPaths,
  ...employeeDocumentPaths,
  ...employeeImportPaths,
  ...passkeyPaths,
  ...clockAttendancePaths,
  ...clockByCardPaths,
  ...employeeCardPaths,
  ...unbindPasskeyPaths,
  ...settingsPaths,
  ...staffColumnsPaths,
  ...filePaths,
  ...staffPaths,
  ...leavePaths,
  ...attendanceExceptionPaths,
  ...attendanceCorrectionPaths,
  ...attendanceChangePaths,
  ...permissionPaths,
  ...pendingDevicesPaths,
  ...customerPaths,
  ...catalogPaths,
  ...alertRulePaths,
  ...ratingSettingsPaths,
  ...serviceSessionPaths,
  ...serviceSessionFormPaths,
  ...serviceSessionRecoveryPaths,
  ...discountApprovalPaths,
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
  ...privateViewPaths,
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
  ...mePaths,
  ...devicePaths,
};

/**
 * بيبني وثيقة OpenAPI من الـ Zod schemas. دالة pure من غير fs، عشان الاختبار يقارن الملف
 * المحفوظ بالناتج ويقع لو حد غيّر contract ونسي يعمل pnpm contracts:openapi.
 *
 * @returns وثيقة OpenAPI 3.0 كـ object
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const registry = z.registry<{ id: string }>();
  for (const schema of openApiSchemas) {
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
