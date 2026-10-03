const json = (name: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
});
const path = (name: string) => ({
  in: 'path',
  name,
  required: true,
  schema: { type: 'string', format: 'uuid' },
});
const base = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  path('businessId'),
];
const paging = [
  { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } },
  { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];
const week = {
  in: 'query',
  name: 'week_start',
  required: true,
  schema: { type: 'string', format: 'date' },
};
const operation = (
  operationId: string,
  response: string,
  parameters: unknown[],
  body?: string,
  status = '200',
) => ({
  operationId,
  parameters,
  ...(body ? { requestBody: { required: true, content: json(body) } } : {}),
  responses: {
    [status]: { description: response, content: json(response) },
    default: { description: 'Bilingual refusal', content: json('ErrorEnvelope') },
  },
});
export const schedulesPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/schedules': {
    get: operation('branchScheduleWeek', 'ScheduleGrid', [
      ...base,
      path('branchId'),
      week,
      ...paging,
    ]),
  },
  '/v1/businesses/{businessId}/branches/{branchId}/schedules/{employeeId}': {
    get: operation('employeeScheduleWeek', 'ScheduleWeekResult', [
      ...base,
      path('branchId'),
      path('employeeId'),
      week,
    ]),
    put: operation(
      'setEmployeeScheduleWeek',
      'StaffSchedule',
      [...base, path('branchId'), path('employeeId')],
      'SetScheduleInput',
    ),
  },
  '/v1/businesses/{businessId}/shift-templates': {
    get: operation('listShiftTemplates', 'TemplatePage', [...base, ...paging]),
    post: operation('createShiftTemplate', 'ShiftTemplate', base, 'TemplateTerms', '201'),
  },
  '/v1/businesses/{businessId}/shift-templates/{templateId}': {
    patch: operation(
      'updateShiftTemplate',
      'ShiftTemplate',
      [...base, path('templateId')],
      'UpdateTemplateInput',
    ),
  },
  '/v1/businesses/{businessId}/shift-templates/{templateId}/archive': {
    post: operation(
      'archiveShiftTemplate',
      'ShiftTemplate',
      [...base, path('templateId')],
      'ArchiveTemplateInput',
    ),
  },
  '/v1/businesses/{businessId}/shift-templates/{templateId}/apply': {
    post: operation(
      'applyShiftTemplate',
      'ApplyTemplateResult',
      [...base, path('templateId')],
      'ApplyTemplateInput',
    ),
  },
};
