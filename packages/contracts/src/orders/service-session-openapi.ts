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
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/capabilities': {
    get: {
      operationId: 'readServiceSessionCapabilities',
      description: 'Lock-free branch capability for the manager day list. Requires read:service-sessions:branch and the orders feature. can_cancel_lines is the effective cancel:service-lines:branch, can_change_performers the effective change:service-line-performers:branch and can_record_sessions the effective record:service-sessions:branch on this branch: ALLOW, no DENY, and an active membership. A missing permission, a DENY, or another branch makes that flag 200 false. Missing read is the route 403. A disabled orders feature stays FEATURE_DISABLED. No Idempotency-Key.',
      parameters: parameters.filter((p) => p.name !== 'Idempotency-Key'),
      responses: {
        '200': { description: 'Whether the day list may offer Cancel, Change performers and the recording actions (tips) on this branch.', content: json('ServiceSessionCapabilities') },
        '403': { description: 'Uniform scope/authority refusal or disabled orders feature.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication/readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines': {
    post: write('appendServiceSessionLines', 'AppendServiceSessionLinesInput', 'AppendServiceSessionLinesResponse', true),
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}': {
    patch: {
      operationId: 'editServiceLine',
      description: 'Edits one saved line price and discount. Requires edit:service-line-prices:branch on the route branch, the orders feature, and an individual admin login. Actor-bound Idempotency-Key. Every return, including a replay, is projected by the caller effective read:service-sessions:branch: the saved line with edited true and the visit total, or only saved and edited when that read is absent. History is never returned.',
      parameters: [...parameters,
        { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'path', name: 'lineId', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: json('EditServiceLineInput') },
      responses: {
        '200': { description: 'Projected edit. With branch read: line edited true and session id plus total_net. Without it: saved true and edited true only.', content: json('EditServiceLineResponse') },
        '400': { description: 'Shape error or a missing Idempotency-Key. A missing reason is not a shape error.', content: json('ErrorEnvelope') },
        '403': { description: 'Permission, orders feature, device principal, self-edit, or a line that does not match the route.', content: json('ErrorEnvelope') },
        '409': { description: 'Stale expected_revision (SESSION_LINE_REVISION_STALE): details carry current_revision only and no money. Also an idempotent request still in progress or a transaction retry, which carry no details.', content: json('ErrorEnvelope') },
        '422': { description: 'Domain refusal, including an invalid reason, an unchanged price and discount, or the same Idempotency-Key reused with another request (IDEMPOTENCY_KEY_REUSED).', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication or readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/cancellation': {
    post: {
      operationId: 'cancelServiceLine',
      description: 'Cancels one saved service line. Requires cancel:service-lines:branch on the route branch, the orders feature, and an individual admin login. Actor-bound Idempotency-Key. Every return, including a replay, is projected by the caller effective read:service-sessions:branch: the saved line with status CANCELLED and cancelled_at plus the visit total, or only cancelled true when that read is absent. The reason is never returned.',
      parameters: [...parameters,
        { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'path', name: 'lineId', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: json('CancelServiceLineInput') },
      responses: {
        '200': { description: 'Projected cancellation. With branch read: line status CANCELLED, cancelled_at, and session id plus total_net. Without it: cancelled true only.', content: json('CancelServiceLineResponse') },
        '400': { description: 'Shape error or a missing Idempotency-Key. A missing or blank reason is not a shape error.', content: json('ErrorEnvelope') },
        '403': { description: 'Permission, orders feature, device principal, self-cancel, or a session or line that does not match the route. A foreign, unknown or out-of-scope session or line is the same body.', content: json('ErrorEnvelope') },
        '409': { description: 'Stale expected_revision (SESSION_LINE_REVISION_STALE): details carry current_revision only and no money. Also an idempotent request still in progress or a transaction retry, which carry no details.', content: json('ErrorEnvelope') },
        '422': { description: 'Domain refusal: an invalid reason, an already cancelled line, a tip that blocks the cancel, an unknown performer identity, a missing canceller membership, a line that cannot be cancelled, a session outside the window, or the same Idempotency-Key reused with another request (IDEMPOTENCY_KEY_REUSED).', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication or readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
    get: {
      operationId: 'readServiceLineCancellation',
      description: 'The one cancellation of a saved line for the manager day list. Requires read:service-sessions:branch and the orders feature. cancel:service-lines:branch does not grant this read. A line, session, branch or company mismatch, and an in-scope line with no cancellation, are the same uniform 403. The reason and the canceller label are returned only here.',
      parameters: [
        ...parameters.filter((p) => p.name !== 'Idempotency-Key'),
        { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'path', name: 'lineId', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': { description: 'The cancellation. Money is canonical three-decimal text. Labels are names first, then the role.', content: json('ServiceLineCancellation') },
        '403': { description: 'Uniform scope/authority refusal or disabled orders feature.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication/readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/performers': {
    put: {
      operationId: 'changeServiceLinePerformers',
      description: 'Replaces the performer set and the shares of one saved line. Requires change:service-line-performers:branch on the route branch, the orders feature, and an individual admin login. Actor-bound Idempotency-Key. Every return, including a replay, is projected by the caller effective read:service-sessions:branch: the saved line with the new performers and performers_changed_at plus the visit total, or only changed true when that read is absent. The reason, the previous performers and the changer are never returned; the guarded history read FR-016 returns the reason, the before and after names and the changer.',
      parameters: [...parameters,
        { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'path', name: 'lineId', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: json('ChangeLinePerformersInput') },
      responses: {
        '200': { description: 'Projected change. With branch read: line status ACTIVE with the new performers and performers_changed_at, and session id plus total_net. Without it: changed true only.', content: json('ChangeLinePerformersResponse') },
        '400': { description: 'Shape error or a missing Idempotency-Key. A missing or blank reason is not a shape error.', content: json('ErrorEnvelope') },
        '403': { description: 'Permission, orders feature, device principal, self-change, or a session or line that does not match the route. A foreign, unknown or out-of-scope session or line is the same body.', content: json('ErrorEnvelope') },
        '409': { description: 'Stale expected_revision (SESSION_LINE_REVISION_STALE): details carry current_revision only and no money. Also an idempotent request still in progress or a transaction retry, which carry no details.', content: json('ErrorEnvelope') },
        '422': { description: 'Domain refusal: an invalid reason, an unchanged set, invalid shares, a performer who is not eligible, an unknown performer identity, a missing changer membership, a line that cannot change, a session outside the window, or the same Idempotency-Key reused with another request (IDEMPOTENCY_KEY_REUSED).', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication or readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/edits': {
    get: {
      operationId: 'listServiceLineEdits',
      description: 'Newest-first price-edit history for one saved line. Requires read:service-sessions:branch and the orders feature. edit:service-line-prices:branch does not grant this read. A line, session, branch or company mismatch is a uniform 403. The reason is returned only here. The scoped cursor carries the last revision.',
      parameters: [
        ...parameters.filter((p) => p.name !== 'Idempotency-Key'),
        { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'path', name: 'lineId', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'query', name: 'cursor', required: false, schema: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' } },
        { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      ],
      responses: {
        '200': { description: 'Edit history newest first. Money is canonical three-decimal text. next_cursor is null on the last page.', content: json('ServiceLineEditsPage') },
        '400': { description: 'Invalid query or a cursor for another company, business, branch, session or line.', content: json('ErrorEnvelope') },
        '403': { description: 'Uniform scope/authority refusal or disabled orders feature.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication/readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/performer-changes': {
    get: {
      operationId: 'listServiceLinePerformerChanges',
      description: 'Newest-first performer-change history for one saved line. Requires read:service-sessions:branch and the orders feature. change:service-line-performers:branch does not grant this read. A line, session, branch or company mismatch is a uniform 403. The reason and the changer label are returned only here. The scoped cursor carries the last revision.',
      parameters: [
        ...parameters.filter((p) => p.name !== 'Idempotency-Key'),
        { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'path', name: 'lineId', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'query', name: 'cursor', required: false, schema: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' } },
        { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      ],
      responses: {
        '200': { description: 'Performer-change history newest first. Names and shares are the snapshots stored at the change. next_cursor is null on the last page.', content: json('ServiceLinePerformerChangesPage') },
        '400': { description: 'Invalid query or a cursor for another company, business, branch, session or line.', content: json('ErrorEnvelope') },
        '403': { description: 'Uniform scope/authority refusal or disabled orders feature.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication/readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/tips': {
    put: {
      operationId: 'recordSessionTips',
      description: 'Records or replaces the current tip set of one visit. Requires record:service-sessions:branch on the route branch, the orders feature, an individual admin login, and an actor-bound Idempotency-Key. One transaction writes the revision, its entries and the outbox event. A foreign, unknown or out-of-branch session is SESSION_NOT_FOUND.',
      parameters: [...parameters, { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: json('RecordSessionTipsInput') },
      responses: {
        '200': { description: 'Current revision and set. Money is canonical three-decimal text. Replay of the same key and body returns this result and writes nothing.', content: json('SessionTips') },
        '400': { description: 'Shape error, a missing Idempotency-Key, or SESSION_RECORDER_MEMBERSHIP_REQUIRED.', content: json('ErrorEnvelope') },
        '403': { description: 'Missing record permission, a device principal, or the orders feature disabled.', content: json('ErrorEnvelope') },
        '404': { description: 'SESSION_NOT_FOUND. An unknown session, another company, another business or another branch is the same body.', content: json('ErrorEnvelope') },
        '409': { description: 'TIP_REVISION_CONFLICT carries current_revision only. Also a transaction retry or an idempotent request still in progress.', content: json('ErrorEnvelope') },
        '422': { description: 'Domain refusal, including a closed window, a self tip, an unknown identity, a non-performer, a total past the column maximum, a missing replacement reason, an unchanged set, or the same Idempotency-Key reused with another body.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication or readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
    get: {
      operationId: 'readSessionTips',
      description: 'Current tip revision and set for the reception screen that records the visit. Same record:service-sessions:branch permission as recording, so a cashier can reload the revision a replacement needs. No customer, phone, reason or history.',
      parameters: [
        ...parameters.filter((parameter) => parameter.name !== 'Idempotency-Key'),
        { in: 'path', name: 'sessionId', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': { description: 'Current revision and set only. A visit with no saved tips returns revision 0, an empty set and zero totals.', content: json('SessionTips') },
        '400': { description: 'Invalid path.', content: json('ErrorEnvelope') },
        '403': { description: 'Missing record permission, a device principal, or the orders feature disabled.', content: json('ErrorEnvelope') },
        '404': { description: 'SESSION_NOT_FOUND. An unknown session, another company, another business or another branch is the same body as PUT.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication or readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
};
