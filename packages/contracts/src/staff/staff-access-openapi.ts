import { z } from 'zod';
import { grantStaffAccessInput, staffAccessState } from './staff-access.js';

const errors = {
  description: 'Bilingual refusal',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
};
const companyHeader = {
  in: 'header',
  name: 'x-company-id',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const businessParam = {
  in: 'path',
  name: 'businessId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const employeeParam = {
  in: 'path',
  name: 'employeeId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const stateResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: z.toJSONSchema(staffAccessState, {
        target: 'openapi-3.0',
        io: 'input',
        metadata: z.registry(),
      }),
    },
  },
});

/** مسارات دخول الموظفة (spec 076 F1)؛ كلها خلف بوابة التفعيل وبإجابة 503 حتى تُشغَّل القدرة. */
export const staffAccessPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/staff-access': {
    post: {
      operationId: 'grantEmployeeStaffAccess',
      description:
        'Requires manage:staff-access:branch on the employee primary branch, read inside the write transaction. The role and scope come from the server, never from the body.',
      parameters: [companyHeader, businessParam, employeeParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: z.toJSONSchema(grantStaffAccessInput, {
              target: 'openapi-3.0',
              io: 'input',
              metadata: z.registry(),
            }),
          },
        },
      },
      responses: {
        '200': stateResponse('The access state after the grant (idempotent repeat reads the same state)'),
        '400': errors,
        '401': errors,
        '403': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
    get: {
      operationId: 'readEmployeeStaffAccess',
      description: 'The access state of the employee, with phone ending in three digits only.',
      parameters: [companyHeader, businessParam, employeeParam],
      responses: {
        '200': stateResponse('The access state for the employee panel'),
        '400': errors,
        '401': errors,
        '404': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employees/{employeeId}/staff-access/pending': {
    delete: {
      operationId: 'cancelPendingEmployeeStaffAccess',
      description:
        'Cancels a pending access record older than 24 hours and deletes its staff user. Requires manage:staff-access:branch on the employee primary branch.',
      parameters: [companyHeader, businessParam, employeeParam],
      responses: {
        '200': stateResponse('The access state after the cancel'),
        '400': errors,
        '401': errors,
        '403': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
};
