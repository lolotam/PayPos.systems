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

export const businessCountryPaths = {
  '/v1/businesses/{businessId}/country': {
    put: {
      operationId: 'setBusinessCountry',
      description:
        'Sets the business country (34-pre-3) inside businesses.settings, keeping every other settings key stored. One of the six permitted GCC codes (OQ-3). Requires manage:settings:business on that business. The row is read under FOR NO KEY UPDATE and an unchanged value answers 200 without an UPDATE or an audit row; the audit records only the country before and after. An unknown or a foreign business is refused by the business-scoped guard like every business route (the same 403). No Idempotency-Key: no money or stock effect.',
      parameters,
      requestBody: { required: true, content: json('SetBusinessCountryInput') },
      responses: {
        '200': {
          description: 'The business and its stored country',
          content: json('SetBusinessCountryResult'),
        },
        '403': { description: 'The API error envelope', content: json('ErrorEnvelope') },
        '404': { description: 'The API error envelope', content: json('ErrorEnvelope') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
    },
  },
};
