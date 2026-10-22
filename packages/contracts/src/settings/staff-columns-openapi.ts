import {
  replaceStaffColumnsInput,
  staffColumnCode,
  staffColumnsSettings,
} from './staff-columns.js';

// تتسجل كـ components عشان الـ clients المولّدة تلاقي StaffColumnCode باسمه.
export const staffColumnsSchemas = [
  staffColumnsSettings,
  replaceStaffColumnsInput,
  staffColumnCode,
];

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
const idem = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};
const responses = {
  '200': {
    description: 'The effective staff-app columns and months back',
    content: json('StaffColumnsSettings'),
  },
  default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
};

export const staffColumnsPaths = {
  '/v1/businesses/{businessId}/settings/staff-columns': {
    get: {
      operationId: 'getStaffColumns',
      parameters,
      description:
        'Staff-app columns screen. The effective columns (the saved set, or the default when nothing is saved) and months back (1 when nothing is saved). rating_average is never returned while the rating track is postponed. Requires read:settings:business or manage:staff-app-columns:business on that business (MY-Q10, MY-Q5). No Idempotency-Key.',
      responses,
    },
    put: {
      operationId: 'replaceStaffColumns',
      parameters: [...parameters, idem],
      description:
        'Replaces the staff-app columns and months back of the business; null returns a value to its default. An unknown, duplicate or not-offered code is 422 STAFF_COLUMNS_INVALID with details.codes; months back outside 1–24 is 422 STAFF_MONTHS_BACK_INVALID. Requires manage:staff-app-columns:business on that business. Each changed value is audited.',
      requestBody: { required: true, content: json('ReplaceStaffColumnsInput') },
      responses,
    },
  },
};
