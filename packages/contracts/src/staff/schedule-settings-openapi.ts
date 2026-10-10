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
const refusal = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const responses = {
  '200': { description: 'Effective business schedule settings', content: json('ScheduleSettings') },
  '400': refusal,
  '403': refusal,
  '404': refusal,
  default: refusal,
};
export const scheduleSettingsPaths = {
  '/v1/businesses/{businessId}/schedule-settings': {
    get: {
      operationId: 'getScheduleSettings',
      description: 'Requires manage:schedule-settings:business and staff feature.',
      parameters,
      responses,
    },
    put: {
      operationId: 'setScheduleSettings',
      description:
        'Requires manage:schedule-settings:business and staff feature. Same value writes no audit. Existing schedules remain unchanged.',
      parameters,
      requestBody: { required: true, content: json('SetScheduleSettingsInput') },
      responses,
    },
  },
};
