import { z } from 'zod';
import { employeeDefaultShifts, setEmployeeDefaultShiftsInput } from './employee-default-shifts.js';
const json = (schema: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } });
const hoursJson = (schema: typeof employeeDefaultShifts | typeof setEmployeeDefaultShiftsInput) => ({
  'application/json': { schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', metadata: z.registry() }) },
});
const parameters = [
  { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
  ...['businessId', 'employeeId'].map((name) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } })),
];
const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
export const employeeDefaultShiftsPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/default-shifts': {
    get: { operationId: 'employeeDefaultShifts', parameters,
      description: 'Employee detail access and staff feature. Current linked branches and stored unlinked branches; can_manage reflects live human hours permission.',
      responses: { '200': { description: 'Employee default week per branch', content: hoursJson(employeeDefaultShifts) }, '404': errors, default: errors } },
  },
  '/v1/businesses/{businessId}/employees/{employeeId}/branches/{branchId}/default-shifts': {
    put: { operationId: 'setEmployeeDefaultShifts',
      parameters: [...parameters, { in: 'path', name: 'branchId', required: true, schema: { type: 'string', format: 'uuid' } }],
      description: 'Human manage:employee-hours:business and staff feature. Replace one linked branch week; empty clears, identical values do not audit. One entry per weekday, duration includes break. No Idempotency-Key.',
      requestBody: { required: true, content: hoursJson(setEmployeeDefaultShiftsInput) },
      responses: { '200': { description: 'Employee default week per branch', content: hoursJson(employeeDefaultShifts) },
        '400': errors, '403': errors, '404': errors, '409': errors, '422': errors, default: errors } },
  },
};
