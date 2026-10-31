import { RATING_TOKEN_HEADER } from './customers/ratings.js';

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

// مسار الاستقبال لموديول العملاء؛ منفصل عن openapi.ts عشان كل موديول يملك مساراته.
export const customerPaths = {
  '/v1/customers/find-or-create': {
    post: {
      operationId: 'findOrCreateCustomer',
      requestBody: { required: true, content: json('FindOrCreateCustomerInput') },
      responses: {
        '200': { description: 'Customer with masked phone', content: json('Customer') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
      parameters: [
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      description:
        'Requires create:customers:company and the customers feature. Existing name and locale are preserved.',
    },
  },
  '/v1/businesses/{businessId}/customers/find-or-create': scopedCustomerPath(
    'businessId',
    'business',
  ),
  '/v1/branches/{branchId}/customers/find-or-create': scopedCustomerPath('branchId', 'branch'),
  // مسار رفض التقييم من غير جلسة: التوكن في الهيدر هو الاعتماد كله (D-B10، ADR-0011 §4).
  '/v1/ratings/opt-out': {
    post: {
      operationId: 'optOutOfRatings',
      description:
        'Stops the rating messages for the customer holding this link. No session is needed: the token in the header is the only credential, and an unknown, foreign or expired token is refused.',
      parameters: [
        {
          in: 'header',
          name: RATING_TOKEN_HEADER,
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 128 },
        },
      ],
      responses: {
        '204': { description: 'The customer stopped the rating messages' },
        '404': { description: 'The link is not available', content: json('ErrorEnvelope') },
        '429': {
          description: 'Too many requests from this address',
          content: json('ErrorEnvelope'),
        },
        '503': { description: 'The service is not ready', content: json('ErrorEnvelope') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
    },
  },
  // صفحة التقييم من غير جلسة: التوكن في الهيدر هو الاعتماد كله (D-B10، ADR-0011 §4).
  '/v1/ratings/view': {
    get: {
      operationId: 'viewRating',
      description:
        'The business name in the customer language and the state of the link. No session is needed: the token in the header is the only credential, and an unknown, foreign or expired token is refused.',
      parameters: [
        {
          in: 'header',
          name: RATING_TOKEN_HEADER,
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 128 },
        },
      ],
      responses: {
        '200': { description: 'The rating page', content: json('RatingView') },
        '404': { description: 'The link is not available', content: json('ErrorEnvelope') },
        '429': {
          description: 'Too many requests from this address',
          content: json('ErrorEnvelope'),
        },
        '503': { description: 'The service is not ready', content: json('ErrorEnvelope') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/ratings/submit': {
    post: {
      operationId: 'submitRating',
      description:
        'Stores the rating of the customer holding this link. No session is needed: the token in the header is the only credential. The link is consumed once, and an invalid body is refused before the token is looked up.',
      parameters: [
        {
          in: 'header',
          name: RATING_TOKEN_HEADER,
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 128 },
        },
      ],
      requestBody: { required: true, content: json('SubmitRatingInput') },
      responses: {
        '204': { description: 'The rating was stored' },
        '422': {
          description: 'The stars or the note are not valid',
          content: json('ErrorEnvelope'),
        },
        '404': { description: 'The link is not available', content: json('ErrorEnvelope') },
        '429': {
          description: 'Too many requests from this address',
          content: json('ErrorEnvelope'),
        },
        '503': { description: 'The service is not ready', content: json('ErrorEnvelope') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
    },
  },
};

function scopedCustomerPath(parameter: string, scope: string) {
  return {
    post: {
      operationId:
        scope === 'business' ? 'findOrCreateBusinessCustomer' : 'findOrCreateBranchCustomer',
      description: `Requires create:customers:${scope} at the verified context and the customers feature. Customer identity remains company-scoped.`,
      requestBody: { required: true, content: json('FindOrCreateCustomerInput') },
      responses: {
        '200': { description: 'Customer with masked phone', content: json('Customer') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
      parameters: [
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        { in: 'path', name: parameter, required: true, schema: { type: 'string', format: 'uuid' } },
      ],
    },
  };
}
