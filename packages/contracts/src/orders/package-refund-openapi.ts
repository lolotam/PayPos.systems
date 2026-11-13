import { json } from '../openapi-operation.js';

const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  {
    in: 'header',
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[!-~]+$' },
  },
  ...['businessId', 'branchId', 'entitlementId'].map((name) => ({
    in: 'path',
    name,
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })),
];
const refusal = (description: string) => ({
  description,
  content: json('ErrorEnvelope'),
});

export const packageRefundPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/refunds': {
    post: {
      operationId: 'refundPackage',
      description:
        'Refunds unused sessions of one package component back to the highest free ordinals, exactly or not at all. Requires refund:packages:branch, the orders feature and an individual admin login. The reason is stored only in the refund history.',
      parameters,
      requestBody: { required: true, content: json('RefundPackageInput') },
      responses: {
        '201': {
          description: 'Sessions refunded; no reason is returned.',
          content: json('PackageRefundResponse'),
        },
        '400': refusal('Invalid body, sessions, method, reason or Idempotency-Key.'),
        '403': refusal('Permission, DENY, device principal or disabled orders feature.'),
        '404': refusal('PACKAGE_NOT_FOUND; unknown and foreign entitlements share the refusal.'),
        '422': refusal(
          'PACKAGE_COMPONENT_NOT_FOUND, INSUFFICIENT_SLOTS, PACKAGE_EXPIRED, PACKAGE_REFUND_REASON_INVALID, IMPORTED_REFUND_DISABLED or IDEMPOTENCY_KEY_REUSED.',
        ),
        default: refusal('Bilingual authentication or readiness refusal.'),
      },
    },
  },
};
