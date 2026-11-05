const json = (schema: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } });
const parameters = [
  { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[!-~]+$' } },
  ...['businessId', 'branchId'].map((name) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } })),
];
const refusal = {
  description:
    'Bilingual refusal; every refusal rolls the whole transaction back and writes nothing. Shape or type errors return 400 VALIDATION_FAILED.',
  content: json('ErrorEnvelope'),
};
export const packageSalePaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/package-sales': {
    post: {
      operationId: 'sellPackage',
      description:
        'Sells one package type to one customer at the selling branch. Requires sell:packages:branch on the route branch, the orders feature and an individual admin login. The request quotes the type revision and every service revision; a changed quote is refused with 409 PACKAGE_SALE_QUOTE_STALE. The seller must be active at the branch on the sale date and may not be the recorder. Money is canonical three-decimal text and the discount is capped by the recorder limit. One transaction writes the entitlement, its components and their sessions, the audit row and the PackageSaleChanged event; the stored 201 is replayed for the same Idempotency-Key and body.',
      parameters,
      requestBody: { required: true, content: json('SellPackageInput') },
      responses: {
        '201': {
          description:
            'The saved entitlement with its components. Money is canonical three-decimal text; refunded_amount is 0.000 and revision is 1.',
          content: json('SellPackageResponse'),
        },
        '400': refusal,
        '403': refusal,
        '404': {
          description:
            'PACKAGE_TYPE_NOT_FOUND. A type of another business or an unknown type is the same body.',
          content: json('ErrorEnvelope'),
        },
        '409': {
          description:
            'PACKAGE_SALE_QUOTE_STALE (details carry the current service revisions) or PACKAGE_TYPE_REVISION_CONFLICT (details carry current_revision). Also a transaction retry or an idempotent request still in progress.',
          content: json('ErrorEnvelope'),
        },
        '422': refusal,
        default: { description: 'Bilingual authentication or readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
};
