const json = (name: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
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
const response = (name: string) => ({
  '200': { description: 'Business settings result', content: json(name) },
  default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
});
export const settingsPaths = {
  '/v1/businesses/{businessId}/settings': {
    get: {
      operationId: 'getBusinessSettings',
      parameters,
      responses: response('BusinessSettings'),
    },
    patch: {
      operationId: 'updateBusinessSettings',
      parameters,
      responses: response('BusinessSettings'),
      requestBody: { required: true, content: json('UpdateBusinessSettingsInput') },
    },
  },
  '/v1/businesses/{businessId}/settings/discount-limit': {
    post: {
      operationId: 'setBusinessDiscountDefault',
      parameters,
      responses: response('DiscountLimit'),
      requestBody: { required: true, content: json('DiscountLimitInput') },
    },
  },
};
