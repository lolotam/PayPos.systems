const json = (schema: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } });
const uuidPath = (name: string) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } });
const company = { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } };
const idempotency = { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[!-~]+$' } };
const branchPath = [company, uuidPath('businessId'), uuidPath('branchId')];
const errors = (codes: string) => ({
  '400': { description: 'Shape error, or a missing Idempotency-Key on an admin write.', content: json('ErrorEnvelope') },
  '403': { description: `Uniform refusal: permission, DENY, orders feature, scope, device principal or branch. ${codes}`, content: json('ErrorEnvelope') },
  '409': { description: 'DISCOUNT_PROPOSAL_NOT_PENDING, DISCOUNT_PROPOSAL_CHANGED, or an idempotent request still in progress.', content: json('ErrorEnvelope') },
  '422': { description: 'Domain refusal with bilingual messages and details.', content: json('ErrorEnvelope') },
  default: { description: 'Bilingual authentication or readiness refusal.', content: json('ErrorEnvelope') },
});
const decided = { description: 'The decided proposals with their status and expiry. Never a PIN or a phone.', content: json('DecideDiscountProposalsResponse') };
const adminDecision = (operationId: string, input: string, reject: boolean) => ({
  operationId,
  description: `${reject ? 'Rejects' : 'Approves'} 1–20 proposals of the route branch, all or nothing, as an admin user with approve:discounts:branch and the orders feature. terms_hashes must equal the stored hashes in the same order. ${reject ? 'A rejection checks the approve permission only (DA-Q9); the optional reason is up to 500 characters.' : 'The approver membership limit must cover each proposal; the requester and any performer may not approve.'} Actor-bound Idempotency-Key.`,
  parameters: [...branchPath, idempotency],
  requestBody: { required: true, content: json(input) },
  responses: { '200': decided, ...errors('DISCOUNT_APPROVER_LIMIT_TOO_LOW, DISCOUNT_APPROVER_IS_REQUESTER, DISCOUNT_APPROVER_IS_PERFORMER.') },
});
const deviceDecision = (operationId: string, input: string, reject: boolean) => ({
  operationId,
  description: `${reject ? 'Rejects' : 'Approves'} 1–20 proposals of the device branch on a paired device by the approver phone and PIN. The PIN identifies the approver for this one action, opens no session, and is never stored, logged or returned. A device-wide cap and the per-holder lockout apply. No Idempotency-Key: a retry of a decided proposal answers 409.`,
  security: [{ DeviceToken: [] }],
  requestBody: { required: true, content: json(input) },
  responses: {
    '200': decided,
    '401': { description: 'PIN_INVALID, with the same timing for an unknown phone.', content: json('ErrorEnvelope') },
    '423': { description: 'PIN_LOCKED for the holder or for the device.', content: json('ErrorEnvelope') },
    '429': { description: 'TOO_MANY_REQUESTS while comparisons are in flight.', content: json('ErrorEnvelope') },
    ...errors('DISCOUNT_APPROVER_LIMIT_TOO_LOW, DISCOUNT_APPROVER_IS_REQUESTER, DISCOUNT_APPROVER_IS_PERFORMER.'),
  },
});

/** مسارات spec 057؛ الصلاحية في الوصف نص فقط حتى يبقى تغيير DA-Q1 نصيًا. */
export const discountApprovalPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/discount-proposals': {
    get: {
      operationId: 'listMyDiscountProposals',
      description: 'The caller own proposals of one request (record:service-sessions:branch and the orders feature). Another recorder request id returns an empty list. EXPIRED is derived from expires_at.',
      parameters: [...branchPath, { in: 'query', name: 'request_id', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'The request proposals ordered by input_index.', content: json('RequesterDiscountProposalList') }, ...errors('') },
    },
    post: {
      operationId: 'requestDiscountApproval',
      description: 'Asks approval for 1–20 draft lines above the recorder limit (record:service-sessions:branch, orders feature, admin login). Each line becomes one PENDING proposal with its terms hash, valid 15 minutes. A line within the recorder limit refuses the whole request with DISCOUNT_APPROVAL_NOT_NEEDED. occurred_at with session_id is a shape error. Actor-bound Idempotency-Key; replayable 201.',
      parameters: [...branchPath, idempotency],
      requestBody: { required: true, content: json('RequestDiscountApprovalInput') },
      responses: { '201': { description: 'The stored proposals and the normalized occurred_at.', content: json('RequestDiscountApprovalResponse') }, ...errors('') },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/discount-proposals/pending': {
    get: {
      operationId: 'listPendingDiscountProposals',
      description: 'The branch live PENDING proposals for an approver (approve:discounts:branch and the orders feature), newest first with an opaque (requested_at, id) cursor. Customer first name only; never a phone.',
      parameters: [...branchPath,
        { in: 'query', name: 'cursor', required: false, schema: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' } },
        { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }],
      responses: { '200': { description: 'One page of pending proposals.', content: json('PendingDiscountProposalPage') }, ...errors('') },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/discount-proposals/approve': {
    post: adminDecision('approveDiscountProposals', 'ApproveDiscountProposalsInput', false),
  },
  '/v1/businesses/{businessId}/branches/{branchId}/discount-proposals/reject': {
    post: adminDecision('rejectDiscountProposals', 'RejectDiscountProposalsInput', true),
  },
  '/v1/devices/me/discount-proposals': {
    get: {
      operationId: 'listDeviceDiscountProposals',
      description: 'The paired device branch live PENDING proposals shown before a PIN: service, amounts, percent, requester and customer first names, time left. Never a phone, never another branch.',
      security: [{ DeviceToken: [] }],
      responses: { '200': { description: 'Pending proposals of the device branch.', content: json('DeviceDiscountProposalList') }, ...errors('') },
    },
  },
  '/v1/devices/me/discount-proposals/approve': {
    post: deviceDecision('approveDeviceDiscountProposals', 'DeviceApproveDiscountProposalsInput', false),
  },
  '/v1/devices/me/discount-proposals/reject': {
    post: deviceDecision('rejectDeviceDiscountProposals', 'DeviceRejectDiscountProposalsInput', true),
  },
};
