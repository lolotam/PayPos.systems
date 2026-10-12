const json = (schema: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } });
const parameters = [
  { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[!-~]+$' } },
  ...['businessId', 'branchId'].map((name) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } })),
];
const refusal = { description: 'Bilingual refusal; all-over-limit 422 includes rejected_lines and saves nothing. SS-20 performer count, duplicate, mixed, zero, fractional, out-of-range or non-10000-sum shares return 422 SESSION_PERFORMER_SHARES_INVALID with details.input_index; the whole request rolls back. Shape/type errors return 400 VALIDATION_FAILED.', content: json('ErrorEnvelope') };
function write(operationId: string, input: string, response: string, append: boolean) {
  return {
    operationId,
    description: append
      ? 'Adds accepted lines to the same immutable visit. Original recorder OR current record permission, with active branch membership, DENY and orders feature checks. Actor-bound idempotency; maximum 20 persisted lines. Uses appender authority and original occurred_at.'
      : 'Records a visit with record:service-sessions:branch and orders feature, admin login only. Only above-limit discounts cause PARTIAL. One transaction/event and replayable 201; actor-bound idempotency.',
    parameters: append ? [...parameters, { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } }] : parameters,
    requestBody: { required: true, content: json(input) },
    responses: { '201': { description: 'COMPLETE or PARTIAL; rejected drafts have no saved IDs.', content: json(response) },
      '400': refusal, '403': refusal, '409': refusal, '422': refusal, default: refusal },
  };
}
export const serviceSessionPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions': {
    get: {
      operationId: 'listBranchDayServiceSessions',
      description: 'Admin branch day list with read:service-sessions:branch and orders feature. Saved snapshots only, no phone. Late means header OR any saved line. Complete visits ordered by occurred_at/id descending; scoped cursor preserves microseconds.',
      parameters: [
        ...parameters.filter((p) => p.name !== 'Idempotency-Key'),
        { in: 'query', name: 'date', required: true, schema: { type: 'string', format: 'date' } },
        { in: 'query', name: 'late', required: false, schema: { type: 'string', enum: ['true'] } },
        { in: 'query', name: 'cursor', required: false, schema: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' } },
        { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: { '200': { description: 'Saved visits with nested lines and performers.', content: json('ServiceSessionDayPage') },
        '400': { description: 'Invalid query or scoped cursor.', content: json('ErrorEnvelope') },
        '403': { description: 'Uniform scope/authority refusal or disabled orders feature.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication/readiness refusal.', content: json('ErrorEnvelope') } },
    },
    post: write('recordServiceSession', 'RecordServiceSessionInput', 'RecordServiceSessionResponse', false),
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines': {
    post: write('appendServiceSessionLines', 'AppendServiceSessionLinesInput', 'AppendServiceSessionLinesResponse', true),
  },
};
