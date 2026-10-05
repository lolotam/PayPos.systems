const json = (name: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
});
const path = (name: string) => ({
  in: 'path',
  name,
  required: true,
  schema: { type: 'string', format: 'uuid' },
});
const company = {
  in: 'header',
  name: 'x-company-id',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const idem = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};
const staff = [
  {
    in: 'header',
    name: 'Authorization',
    required: false,
    schema: { type: 'string' },
    description: 'Required with kiosk staff cookie; forbidden with a personal staff cookie.',
  },
  {
    in: 'header',
    name: 'Origin',
    required: true,
    schema: { type: 'string' },
    description: 'Exact configured POS origin.',
  },
  {
    in: 'query',
    name: 'branch_id',
    schema: { type: 'string', format: 'uuid' },
    description: 'Required for personal sessions; kiosk sessions use their paired branch.',
  },
];
const ownSecurity = [{ PersonalStaffSession: [] }, { KioskStaffSession: [], DeviceToken: [] }];
const paging = [
  { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } },
  { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];
const operation = (operationId: string, parameters: unknown[], body?: string, status = '200') => ({
  operationId,
  parameters: [...parameters, ...(body ? [idem] : paging)],
  ...(body ? { requestBody: { required: true, content: json(body) } } : {}),
  responses: {
    [status]: {
      description: body ? 'LeaveRequest' : 'LeavePage',
      content: json(body ? 'LeaveRequest' : 'LeavePage'),
    },
    default: { description: 'Bilingual refusal', content: json('ErrorEnvelope') },
  },
});
const employee = [company, path('businessId'), path('employeeId')];
export const leavePaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests': {
    get: operation('employeeLeaveHistory', employee),
    post: operation('requestEmployeeLeave', employee, 'RequestEmployeeLeaveInput', '201'),
  },
  '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests/{leaveId}/cancel': {
    post: operation('cancelEmployeeLeave', [...employee, path('leaveId')], 'CancelLeaveInput'),
  },
  '/v1/businesses/{businessId}/leave-requests': {
    get: operation('pendingLeaveInbox', [
      company,
      path('businessId'),
      { in: 'query', name: 'branch_id', schema: { type: 'string', format: 'uuid' } },
      { in: 'query', name: 'from', schema: { type: 'string', format: 'date' } },
      { in: 'query', name: 'to', schema: { type: 'string', format: 'date' } },
    ]),
  },
  '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests/{leaveId}/decide': {
    post: operation('decideEmployeeLeave', [...employee, path('leaveId')], 'DecideLeaveInput'),
  },
  '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests/{leaveId}/revoke': {
    post: operation('revokeEmployeeLeave', [...employee, path('leaveId')], 'RevokeLeaveInput'),
  },
  '/v1/staff/me/leave-requests': {
    get: { ...operation('ownLeaveHistory', staff), security: ownSecurity },
    post: {
      ...operation('requestOwnLeave', staff, 'RequestLeaveInput', '201'),
      security: ownSecurity,
    },
  },
  '/v1/staff/me/leave-requests/{leaveId}/cancel': {
    post: {
      ...operation('cancelOwnLeave', [...staff, path('leaveId')], 'CancelLeaveInput'),
      security: ownSecurity,
    },
  },
};
