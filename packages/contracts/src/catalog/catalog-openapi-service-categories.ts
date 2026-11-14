import { categoryId, closingId, errors, json, parameters } from './catalog-openapi-common.js';

// مسارات تصنيفات خدمة النشاط: القائمة والتفاصيل والقفل والفتح ومتابعة طلب الخلفية.
export const serviceCategoryPaths = {
  '/v1/businesses/{businessId}/service-categories': {
    get: {
      operationId: 'listServiceCategories',
      description:
        'Cursor-paginated categories in normalized English-name order. status is open, closed or all (default open). Requires read:service-categories:business and the catalog feature.',
      parameters: [
        ...parameters,
        {
          in: 'query',
          name: 'status',
          schema: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
        },
        { in: 'query', name: 'cursor', schema: { type: 'string', maxLength: 2048 } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': { description: 'Service category page', content: json('ServiceCategoryPage') },
        default: errors,
      },
    },
    post: {
      operationId: 'createServiceCategory',
      description:
        'Creates a BUSINESS category with no owner branch. Both names are required. Requires manage:service-categories:business and the catalog feature. Duplicate normalized English names return SERVICE_CATEGORY_NAME_TAKEN (409).',
      parameters,
      requestBody: { required: true, content: json('CreateServiceCategoryInput') },
      responses: {
        '201': { description: 'Created category', content: json('ServiceCategory') },
        '404': errors,
        '409': errors,
        '422': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/service-categories/{categoryId}': {
    get: {
      operationId: 'getServiceCategory',
      description:
        'Returns a category with open_service_count and marked_service_count for close and reopen confirmation, and pending_closing_id when a background close or reopen of this category is running. Requires read:service-categories:business and the catalog feature. Missing, foreign and other-business ids share SERVICE_CATEGORY_NOT_FOUND (404).',
      parameters: [...parameters, categoryId],
      responses: {
        '200': { description: 'Category detail', content: json('ServiceCategoryDetail') },
        '404': errors,
        default: errors,
      },
    },
    patch: {
      operationId: 'renameServiceCategory',
      description:
        'Renames any category of the business, including a closed one, against expected_revision. visibility may only change BRANCH to BUSINESS. Requires manage:service-categories:business and the catalog feature.',
      parameters: [...parameters, categoryId],
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
  '/v1/businesses/{businessId}/service-categories/{categoryId}/close': {
    post: {
      operationId: 'closeServiceCategory',
      description:
        'Closes a category and its open services against the confirmed revision and count. Up to 300 services the answer is 200 and the category is closed; above 300 the answer is 202 and a background request carries the closing_id, leaving the category untouched until the job commits. Requires manage:service-categories:business AND read:service-categories:business and the catalog feature. Errors: SERVICE_CATEGORY_NOT_FOUND (404), SERVICE_CATEGORY_ALREADY_CLOSED, SERVICE_CATEGORY_COUNT_CHANGED, SERVICE_CATEGORY_REVISION_CONFLICT and SERVICE_CATEGORY_CLOSING_IN_PROGRESS (409, with details.closing_id).',
      parameters: [...parameters, categoryId],
      requestBody: { required: true, content: json('CloseServiceCategoryInput') },
      responses: {
        '200': { description: 'Closed category', content: json('CloseServiceCategoryResult') },
        '202': {
          description: 'Background request accepted',
          content: json('ServiceCategoryClosingPending'),
        },
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/service-categories/{categoryId}/reopen': {
    post: {
      operationId: 'reopenServiceCategory',
      description:
        'Reopens a category and exactly the services marked by its close. Up to 300 services the answer is 200 and the category is reopened; above 300 the answer is 202 and a background request carries the closing_id, leaving the category untouched until the job commits. Requires manage:service-categories:business AND read:service-categories:business and the catalog feature. Errors: SERVICE_CATEGORY_NOT_FOUND (404), SERVICE_CATEGORY_NOT_CLOSED, SERVICE_CATEGORY_COUNT_CHANGED, SERVICE_CATEGORY_REVISION_CONFLICT and SERVICE_CATEGORY_CLOSING_IN_PROGRESS (409, with details.closing_id).',
      parameters: [...parameters, categoryId],
      requestBody: { required: true, content: json('ReopenServiceCategoryInput') },
      responses: {
        '200': { description: 'Reopened category', content: json('ReopenServiceCategoryResult') },
        '202': {
          description: 'Background request accepted',
          content: json('ServiceCategoryClosingPending'),
        },
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/service-categories/{categoryId}/closings/{closingId}': {
    get: {
      operationId: 'getServiceCategoryClosing',
      description:
        "Returns the state of one close or reopen request of the category: pending, completed with services_changed, or failed with its error code. A pending request past its deadline reads as failed with SERVICE_CATEGORY_CLOSING_EXPIRED. Requires manage:service-categories:business AND read:service-categories:business and the catalog feature. An unknown id, another category's id and another tenant's id share SERVICE_CATEGORY_CLOSING_NOT_FOUND (404).",
      parameters: [...parameters, categoryId, closingId],
      responses: {
        '200': {
          description: 'Closing request state',
          content: json('ServiceCategoryClosingStatus'),
        },
        '404': errors,
        default: errors,
      },
    },
  },
};
