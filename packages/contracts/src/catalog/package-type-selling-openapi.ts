const sellingJson = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const sellingParameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const sellingPackageTypeId = {
  in: 'path',
  name: 'packageTypeId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const sellingErrors = {
  description: 'Bilingual refusal',
  content: sellingJson('ErrorEnvelope'),
};
export const packageTypeSellingPaths = {
  '/v1/businesses/{businessId}/package-types/{packageTypeId}/stop-selling': {
    post: {
      operationId: 'stopPackageTypeSelling',
      description:
        'Stops new sales of a package type against expected_revision without changing sold or imported packages. Requires manage:package-types:business and the catalog feature. Unknown types return PACKAGE_TYPE_NOT_FOUND (404); stale revisions and an already-stopped type return PACKAGE_TYPE_REVISION_CONFLICT and PACKAGE_TYPE_SELLING_UNCHANGED (409).',
      parameters: [...sellingParameters, sellingPackageTypeId],
      requestBody: { required: true, content: sellingJson('PackageTypeSellingInput') },
      responses: {
        '200': { description: 'Stopped package type', content: sellingJson('PackageTypeDetail') },
        '400': sellingErrors,
        '404': sellingErrors,
        '409': sellingErrors,
        default: sellingErrors,
      },
    },
  },
  '/v1/businesses/{businessId}/package-types/{packageTypeId}/resume-selling': {
    post: {
      operationId: 'resumePackageTypeSelling',
      description:
        'Resumes new sales of a package type against expected_revision without changing sold or imported packages. Requires manage:package-types:business and the catalog feature. Unknown types return PACKAGE_TYPE_NOT_FOUND (404); stale revisions and an already-active type return PACKAGE_TYPE_REVISION_CONFLICT and PACKAGE_TYPE_SELLING_UNCHANGED (409).',
      parameters: [...sellingParameters, sellingPackageTypeId],
      requestBody: { required: true, content: sellingJson('PackageTypeSellingInput') },
      responses: {
        '200': { description: 'Active package type', content: sellingJson('PackageTypeDetail') },
        '400': sellingErrors,
        '404': sellingErrors,
        '409': sellingErrors,
        default: sellingErrors,
      },
    },
  },
};
