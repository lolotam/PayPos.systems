import { COMMISSION_BLOCKED_CORRECTION_CURSOR_MAX } from './blocked-corrections.js';

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: false,
    description:
      'Optional. The company the request targets. When the header is absent the endpoint guard falls back to the authenticated user session’s selected active company (the session company hint); when neither the header nor a valid session company hint is present, the request is refused with 403 FORBIDDEN.',
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];

const listQueryParameters = [
  {
    in: 'query',
    name: 'status',
    schema: { type: 'string', enum: ['open', 'resolved', 'all'], default: 'open' },
  },
  {
    in: 'query',
    name: 'cursor',
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: COMMISSION_BLOCKED_CORRECTION_CURSOR_MAX,
      pattern: '^[A-Za-z0-9_-]+$',
    },
  },
  {
    in: 'query',
    name: 'limit',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
];

export const commissionBlockedCorrectionPaths = {
  '/v1/businesses/{businessId}/commission-blocked-corrections': {
    get: {
      operationId: 'listCommissionBlockedCorrections',
      description:
        'The blocked-corrections list (FR-049): one open row per employee and source month whose closed-month recompute returned NO_PLAN or NO_SALARY, plus resolved history under status=resolved|all. The items carry the block identity only — employee_id, source_period, code, the held target_period, created_at and resolved_at. No amount and no employee or customer name is returned; the screen that shows names is a later UI row. Ordered created_at DESC, id DESC with a keyset cursor bound to the company, the business and the requested status; a malformed or foreign cursor is VALIDATION_FAILED. status defaults to open. Requires manage:commission-plans:business (CS-Q48) and the commissions feature; a device session is refused. Reads only.',
      parameters: [...parameters, ...listQueryParameters],
      responses: {
        '200': {
          description: 'A page of the business’s blocked corrections',
          content: json('CommissionBlockedCorrectionList'),
        },
        '400': { description: 'Invalid cursor or query', content: json('ErrorEnvelope') },
        '401': {
          description: 'UNAUTHENTICATED: no valid session',
          content: json('ErrorEnvelope'),
        },
        '403': {
          description:
            'Refused with two distinct envelope codes: FORBIDDEN when a valid session holds no manage:commission-plans:business on that business, or names a missing or foreign business, or names no company at all (no x-company-id header and no session company hint) (a device session is a valid non-user principal and answers FORBIDDEN the same way), and FEATURE_DISABLED when the commissions feature is off for the company',
          content: json('ErrorEnvelope'),
        },
        default: { description: 'Bilingual refusal', content: json('ErrorEnvelope') },
      },
    },
  },
};
