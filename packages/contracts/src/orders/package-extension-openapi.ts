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

export const packageExtensionPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/extensions': {
    post: {
      operationId: 'extendPackage',
      description:
        'Extends a sold or imported package forward by at most two calendar years from the acting branch-local today. Requires extend:packages:branch, the orders feature and an individual admin login. The reason is stored only in extension history.',
      parameters,
      requestBody: { required: true, content: json('ExtendPackageInput') },
      responses: {
        '201': {
          description: 'Package extended; no reason, money, slot or outbox payload is returned.',
          content: json('PackageExtensionResponse'),
        },
        '400': refusal('Invalid body, calendar date, reason or Idempotency-Key.'),
        '403': refusal('Permission, DENY, device principal or disabled orders feature.'),
        '404': refusal('PACKAGE_NOT_FOUND; unknown and foreign entitlements share the refusal.'),
        '409': refusal('PACKAGE_EXPIRY_STALE or IDEMPOTENCY_KEY_IN_PROGRESS.'),
        '422': refusal(
          'PACKAGE_EXTENSION_NOT_LATER, PACKAGE_EXTENSION_TOO_LONG or IDEMPOTENCY_KEY_REUSED.',
        ),
        default: refusal('Bilingual authentication or readiness refusal.'),
      },
    },
  },
};
