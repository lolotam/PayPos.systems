const json = (schema: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } });
const scope = [
  { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'header', name: 'x-recovery-key', required: true, description: 'Credential-like attempt key. Same visible-ASCII shape as Idempotency-Key. Never logged and never placed in a URL.', schema: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[!-~]+$' } },
  ...['businessId', 'branchId'].map((name) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } })),
];
const operation = { in: 'query', name: 'operation', required: true, schema: { type: 'string', enum: ['record-service-session', 'append-service-session-lines'] } };
const envelope = { content: json('ErrorEnvelope') };
export const serviceSessionRecoveryPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recovery': {
    get: {
      operationId: 'readServiceSessionRecovery',
      description: 'Own active lines for the attempt day (ADR-0042 §3, SS-Q20). Requires record:service-sessions:branch, the orders feature, the selected company and an admin session; access is re-checked inside the transaction. The proof is found by the unique index of app_user_id(), company, business, branch, operation and the sha256 of x-recovery-key. Unknown key, another recorder, branch or tenant is SESSION_RECOVERY_NOT_FOUND. Revoked or expired is SESSION_RECOVERY_CLOSED (REVOKED wins). Before last_seen_at + 24h is SESSION_RECOVERY_NOT_YET with opens_at. Otherwise visits of coalesce(linked session business_date, proof business_date) that have an ACTIVE line recorded by the caller, 50 per page, keyset cursor (occurred_at, id) bound to the proof. attempt.outcome is COMMITTED or NOT_COMMITTED, omitted for a proof issued in the first 48h after the feature started and absent on every error. Cache-Control: no-store.',
      parameters: [
        ...scope, operation,
        { in: 'query', name: 'cursor', required: false, description: 'Opaque base64url cursor from the previous page, bound to this proof and route. A mismatched cursor is 400.', schema: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' } },
      ],
      responses: {
        '200': { description: 'Own visits and the attempt. No raw phone and no recovery key.', content: json('ServiceSessionRecoveryPage'), headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } } },
        '400': { description: 'Malformed key or a cursor that does not belong to this proof.', ...envelope },
        '403': { description: 'No record access or the orders feature is off.', ...envelope },
        '404': { description: 'SESSION_RECOVERY_NOT_FOUND. One code for every mismatch.', ...envelope },
        '409': { description: 'SESSION_RECOVERY_NOT_YET (opens_at) or SESSION_RECOVERY_CLOSED (reason EXPIRED or REVOKED).', ...envelope },
        default: { description: 'Bilingual authentication or readiness refusal.', ...envelope },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recovery/confirm': {
    post: {
      operationId: 'confirmServiceSessionRecovery',
      description: 'Revokes the caller\'s own proof (ADR-0042 §3). Same guards as the read. Sets revoked_at and revoked_outcome where revoked_at is null, so the first outcome wins, and writes one audit_log row. 204 when the proof is unknown, expired or already revoked. Lost record access is 403, not 204. The raw key is not stored.',
      parameters: scope,
      requestBody: { required: true, content: json('ConfirmSessionRecoveryBody') },
      responses: {
        '204': { description: 'Revoked, or nothing to revoke. Idempotent.' },
        '400': { description: 'Malformed key or body.', ...envelope },
        '403': { description: 'No record access or the orders feature is off.', ...envelope },
        default: { description: 'Bilingual authentication or readiness refusal.', ...envelope },
      },
    },
  },
};
export { serviceSessionRecoverySchemas } from './service-session-recovery.js';
