import { ratingSettings, ratingSettingsResponse } from './rating-settings.js';

// كل سكيما في rating-settings.ts بتتسجل هنا، وإلا Zod بيحطها تحت __shared بدل components.
export const ratingSettingsSchemas = [ratingSettings, ratingSettingsResponse];

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const errors = { description: 'The API error envelope', content: json('ErrorEnvelope') };
const settings = () => ({
  '200': {
    description: 'The rating requests switch of the business',
    content: json('RatingSettingsResponse'),
  },
  default: errors,
});

export const ratingSettingsPaths = {
  '/v1/businesses/{businessId}/rating-settings': {
    get: {
      operationId: 'getBusinessRatingSettings',
      description:
        'Whether the business sends rating requests to its customers. Requires manage:rating-requests:business on that business; a caller without it, a device, another business and an unknown business are the same 403 FORBIDDEN. A business with no stored switch reads as off. Never writes.',
      parameters,
      responses: settings(),
    },
    put: {
      operationId: 'setBusinessRatingSettings',
      description:
        'Turns the rating requests of the business on or off. Requires manage:rating-requests:business on that business; a caller without it, a device, another business and an unknown business are the same 403 FORBIDDEN. The switch is independent of the team alerts master switch. Every write is audited with before and after.',
      parameters,
      requestBody: { required: true, content: json('RatingSettings') },
      responses: settings(),
    },
  },
};
