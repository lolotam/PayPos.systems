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
  ...['businessId', 'branchId'].map((name) => ({
    in: 'path',
    name,
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })),
];
const readParameters = parameters.filter((parameter) => parameter.name !== 'Idempotency-Key');
const refusal = (description: string) => ({
  description,
  content: json('ErrorEnvelope'),
});
const readResponses = (schema: string) => ({
  '200': { description: 'Package-sale read result.', content: json(schema) },
  '403': refusal('Permission, DENY, invalid place, device principal or disabled orders feature.'),
  default: refusal('Bilingual authentication or readiness refusal.'),
});
const statusParameters = [
  ...readParameters,
  {
    in: 'path',
    name: 'saleRequestId',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
];
const sellerParameters = [
  ...readParameters,
  ...['lang', 'occurred_at'].map((name) => ({
    in: 'query',
    name,
    required: true,
    schema:
      name === 'lang'
        ? { type: 'string', enum: ['ar', 'en'] }
        : { type: 'string', format: 'date-time' },
  })),
  ...['cursor', 'q', 'limit'].map((name) => ({
    in: 'query',
    name,
    required: false,
    schema: name === 'limit' ? { type: 'integer', minimum: 1, maximum: 100 } : { type: 'string' },
  })),
];

export const packageSalePaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/package-sales/context': {
    get: {
      operationId: 'getPackageSaleContext',
      description:
        "Returns the current server sale anchor, effective branch timezone and only the caller's sale-eligible recorder memberships. Requires sell:packages:branch and the orders feature; no session-recording permission.",
      parameters: readParameters,
      responses: readResponses('PackageSaleContext'),
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/package-sales/seller-options': {
    get: {
      operationId: 'listPackageSaleSellers',
      description:
        'Cursor-paginated sale-eligible seller ids, names and employee numbers. The first page uses the current server clock and returns that sale_anchor for subsequent cursors. Requires sell:packages:branch and the orders feature; no session-recording or performer-change permission. No attendance or private HR fields.',
      parameters: sellerParameters,
      responses: {
        '400': refusal('Invalid query or cursor.'),
        ...readResponses('PackageSaleSellerOptionPage'),
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/package-sales': {
    post: {
      operationId: 'sellPackage',
      description:
        'Accepts a package sale for the background worker. Requires sell:packages:branch, the orders feature and an individual admin login. No customer, type, seller or price checks run at acceptance.',
      parameters,
      requestBody: { required: true, content: json('SellPackageInput') },
      responses: {
        '202': {
          description: 'Sale accepted; poll the status read.',
          content: json('AcceptedPackageSale'),
        },
        '400': refusal(
          'Invalid body (including paid_method other than CASH or CARD) or Idempotency-Key.',
        ),
        '403': refusal('Permission, DENY, device principal or disabled orders feature.'),
        '409': refusal('IDEMPOTENCY_KEY_IN_PROGRESS.'),
        '422': refusal('IDEMPOTENCY_KEY_REUSED.'),
        default: refusal('Bilingual authentication or readiness refusal.'),
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/package-sales/{saleRequestId}': {
    get: {
      operationId: 'getPackageSaleStatus',
      description:
        'Returns the creator-scoped status of an accepted package sale. Requires sell:packages:branch, the orders feature and an individual admin login. Any other caller, branch or id receives 404 PACKAGE_SALE_REQUEST_NOT_FOUND.',
      parameters: statusParameters,
      responses: {
        '200': {
          description: 'Pending, completed or failed package sale.',
          content: json('PackageSaleStatus'),
        },
        '403': refusal('Permission, DENY, device principal or disabled orders feature.'),
        '404': refusal('PACKAGE_SALE_REQUEST_NOT_FOUND.'),
        default: refusal('Bilingual authentication or readiness refusal.'),
      },
    },
  },
};
