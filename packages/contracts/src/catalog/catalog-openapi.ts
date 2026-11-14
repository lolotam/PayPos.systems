import { packageTypeSchemas } from './package-type.js';
import { packageServiceOptionSchemas } from './package-service-option.js';
import { serviceCategorySchemas } from './service-category.js';
import { serviceCategoryClosingSchemas } from './service-category-closing.js';
import { serviceSchemas } from './service.js';
import {
  branchId,
  categoryId,
  errors,
  json,
  packageTypeId,
  parameters,
  serviceId,
} from './catalog-openapi-common.js';
import { serviceCategoryPaths } from './catalog-openapi-service-categories.js';

export const catalogSchemas = [
  ...serviceSchemas,
  ...serviceCategorySchemas,
  ...serviceCategoryClosingSchemas,
  ...packageTypeSchemas,
  ...packageServiceOptionSchemas,
];

export const catalogPaths = {
  ...serviceCategoryPaths,
  '/v1/businesses/{businessId}/branches/{branchId}/service-categories': {
    get: {
      operationId: 'listBranchServiceCategories',
      description:
        'Cursor-paginated branch category view in normalized English-name order. in_use lists open categories used by the branch; available lists other open categories it may enable. Each item carries the branch setting state and revision. Requires read:service-categories:branch and the catalog feature.',
      parameters: [
        ...parameters,
        branchId,
        {
          in: 'query',
          name: 'view',
          required: true,
          schema: { type: 'string', enum: ['in_use', 'available'] },
        },
        { in: 'query', name: 'cursor', schema: { type: 'string', maxLength: 2048 } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': {
          description: 'Branch service category page',
          content: json('ServiceCategoryBranchPage'),
        },
        '404': errors,
        default: errors,
      },
    },
    post: {
      operationId: 'createBranchServiceCategory',
      description:
        'Creates a category owned by the route branch, shared BUSINESS or private BRANCH. The guard and persistence resolve the branch business from the database, never from the client. Requires manage:service-categories:branch and the catalog feature.',
      parameters: [...parameters, branchId],
      requestBody: { required: true, content: json('CreateBranchServiceCategoryInput') },
      responses: {
        '201': { description: 'Created branch-owned category', content: json('ServiceCategory') },
        '404': errors,
        '409': errors,
        '422': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-categories/{categoryId}/state': {
    put: {
      operationId: 'setServiceCategoryBranchState',
      description:
        'Enables or hides a category in one branch against the branch setting revision. A first write requires null and stores revision 1; later writes require the current revision. A hidden row wins over ownership and never changes services. Requires manage:service-categories:branch and the catalog feature.',
      parameters: [...parameters, branchId, categoryId],
      requestBody: { required: true, content: json('SetServiceCategoryBranchStateInput') },
      responses: {
        '200': {
          description: 'Category with its saved branch setting',
          content: json('ServiceCategoryBranchStateResult'),
        },
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-categories/{categoryId}': {
    patch: {
      operationId: 'renameBranchServiceCategory',
      description:
        'Renames only a private category owned by the route branch, or shares it by changing visibility to BUSINESS. A shared category or any other visibility change returns SERVICE_CATEGORY_VISIBILITY_FIXED (409). Requires manage:service-categories:branch and the catalog feature.',
      parameters: [...parameters, branchId, categoryId],
      requestBody: { required: true, content: json('RenameServiceCategoryInput') },
      responses: {
        '200': { description: 'Renamed or shared category', content: json('ServiceCategory') },
        '404': errors,
        '409': errors,
        '422': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services': {
    get: {
      operationId: 'listServices',
      description:
        'Cursor-paginated services of one business. An optional category_id narrows the list to that category. Missing, foreign and other-business ids answer like unknown. Requires read:services:business and the catalog feature.',
      parameters: [
        ...parameters,
        { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } },
        { in: 'query', name: 'category_id', schema: { type: 'string', format: 'uuid' } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': { description: 'Service page', content: json('ServicePage') },
        default: errors,
      },
    },
    post: {
      operationId: 'createService',
      description:
        'Creates a business service with a KWD price and a commission rule. Requires manage:services:business and the catalog feature. Duplicate names are allowed; a zero price is allowed; a malformed rule or price returns a named 400. The write and its audit row commit in one transaction.',
      parameters,
      requestBody: { required: true, content: json('CreateServiceInput') },
      responses: {
        '201': { description: 'Created service', content: json('Service') },
        '400': errors,
        '404': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services/{serviceId}': {
    get: {
      operationId: 'getService',
      description:
        'One service of the business. Missing, foreign and other-business ids share SERVICE_NOT_FOUND (404). Requires read:services:business and the catalog feature.',
      parameters: [...parameters, serviceId],
      responses: {
        '200': { description: 'Persisted service', content: json('Service') },
        '404': errors,
        default: errors,
      },
    },
    patch: {
      operationId: 'updateService',
      description:
        'Full replacement of the editable fields against expected_revision. Requires manage:services:business and the catalog feature. A price or rule change is audited; a stale revision returns SERVICE_REVISION_CONFLICT (409).',
      parameters: [...parameters, serviceId],
      requestBody: { required: true, content: json('UpdateServiceInput') },
      responses: {
        '200': { description: 'Updated service', content: json('Service') },
        '400': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services/{serviceId}/close': {
    post: {
      operationId: 'closeService',
      description:
        'Closes one service against expected_revision. Requires close:services:business AND read:services:business and the catalog feature. Errors: SERVICE_NOT_FOUND (404), SERVICE_ALREADY_CLOSED and SERVICE_REVISION_CONFLICT (409).',
      parameters: [...parameters, serviceId],
      requestBody: { required: true, content: json('CloseServiceInput') },
      responses: {
        '200': { description: 'Closed service', content: json('Service') },
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services/{serviceId}/reopen': {
    post: {
      operationId: 'reopenService',
      description:
        'Reopens one service against expected_revision. Requires close:services:business AND read:services:business and the catalog feature. Errors: SERVICE_NOT_FOUND (404), SERVICE_NOT_CLOSED, SERVICE_CATEGORY_CLOSED and SERVICE_REVISION_CONFLICT (409).',
      parameters: [...parameters, serviceId],
      requestBody: { required: true, content: json('ReopenServiceInput') },
      responses: {
        '200': { description: 'Reopened service', content: json('Service') },
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/package-types': {
    get: {
      operationId: 'listPackageTypes',
      description:
        'Cursor-paginated package-types of one business. Missing, foreign and other-business ids answer like unknown. Requires read:package-types:business and the catalog feature.',
      parameters: [
        ...parameters,
        { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': { description: 'Package type page', content: json('PackageTypePage') },
        default: errors,
      },
    },
    post: {
      operationId: 'createPackageType',
      description:
        'Creates a package type with a KWD price, validity and ordered service components. Requires manage:package-types:business and the catalog feature. Names are unique within the business ignoring case and surrounding spaces; duplicates return PACKAGE_TYPE_NAME_TAKEN (409). A zero price and zero-price services are allowed. The write and its audit row commit in one transaction.',
      parameters,
      requestBody: { required: true, content: json('CreatePackageTypeInput') },
      responses: {
        '201': { description: 'Created package type', content: json('PackageTypeDetail') },
        '400': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/package-types/service-options': {
    get: {
      operationId: 'listPackageServiceOptions',
      description:
        'Cursor-paginated service options for package components: id, names, KWD price and active only. Requires read:package-types:business and the catalog feature, independently of service permissions. A role that manages package types also needs read:package-types:business, as the list screen does. Services cannot currently be retired, so active is true. A missing, foreign or unauthorized business returns the same FORBIDDEN response. Never writes.',
      parameters: [
        ...parameters,
        { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': {
          description: 'Package service options page',
          content: json('PackageServiceOptionPage'),
        },
        '403': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/package-types/{packageTypeId}': {
    get: {
      operationId: 'getPackageType',
      description:
        'One package type with ordered components and current service names and prices. Missing, foreign and other-business ids share PACKAGE_TYPE_NOT_FOUND (404). Requires read:package-types:business and the catalog feature.',
      parameters: [...parameters, packageTypeId],
      responses: {
        '200': { description: 'Persisted package type', content: json('PackageTypeDetail') },
        '404': errors,
        default: errors,
      },
    },
    patch: {
      operationId: 'updatePackageType',
      description:
        'Full replacement of names, price, validity and ordered components against expected_revision. Requires manage:package-types:business and the catalog feature. Effective changes are audited; a no-op preserves the revision and writes no audit entry. A stale revision returns PACKAGE_TYPE_REVISION_CONFLICT (409); duplicate names return PACKAGE_TYPE_NAME_TAKEN (409). Existing sold entitlements are unaffected.',
      parameters: [...parameters, packageTypeId],
      requestBody: { required: true, content: json('UpdatePackageTypeInput') },
      responses: {
        '200': { description: 'Updated package type', content: json('PackageTypeDetail') },
        '400': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
};
