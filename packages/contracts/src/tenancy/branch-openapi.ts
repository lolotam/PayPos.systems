import { json } from '../openapi-operation.js';

// مسارات الفرع بعد إنشائه: القراءة وتعديل مواعيد العمل (PENDING-T3). الإنشاء نفسه معروض في مكانه من openapi.ts.

const header = {
  in: 'header',
  name: 'x-company-id',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const uuidPath = (name: string) => ({
  in: 'path',
  name,
  required: true,
  schema: { type: 'string', format: 'uuid' },
});
const errors = { description: 'The API error envelope', content: json('ErrorEnvelope') };

/** The branch read and the branch opening-hours edit. */
export const branchPaths = {
  '/v1/branches/{branchId}': {
    get: {
      operationId: 'getBranch',
      description:
        'One branch with its stored opening hours and its effective time zone. Requires read:branches:branch at the branch.',
      parameters: [header, uuidPath('branchId')],
      responses: {
        '200': { description: 'The branch', content: json('Branch') },
        '403': errors,
        '404': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/opening-hours': {
    put: {
      operationId: 'setBranchOpeningHours',
      description:
        'Replaces the branch opening hours (PENDING-T3); null clears them. Requires create:branches:business on the business. The branch row is read under FOR NO KEY UPDATE and an unchanged value answers 200 without an UPDATE or an audit row; the audit records only the hours before and after. A branch of another business of the same company answers 404; an unknown or foreign business is refused by the business-scoped guard with the same 403 as every business route. No Idempotency-Key: the write is a replace and has no money or stock effect.',
      parameters: [header, uuidPath('businessId'), uuidPath('branchId')],
      requestBody: { required: true, content: json('SetBranchOpeningHoursInput') },
      responses: {
        '200': { description: 'The branch after the change', content: json('Branch') },
        '400': errors,
        '403': errors,
        '404': errors,
        default: errors,
      },
    },
  },
};
