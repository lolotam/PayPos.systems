import { recordingContextSchemas } from './recording-context.js';
import { sessionServiceOptionsSchemas, sessionPerformerOptionsSchemas } from './service-session-options.js';
export const serviceSessionFormSchemas = [...recordingContextSchemas, ...sessionServiceOptionsSchemas, ...sessionPerformerOptionsSchemas];
const json = (schema: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } });
export const serviceSessionFormPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/performer-options': {
    get: {
      operationId: 'getServiceSessionPerformerOptions',
      description: 'Admin recording-form dated eligible employee names and missing-clock/approved-leave booleans only (SS-Q13). Requires record:service-sessions:branch and orders feature; business/branch ownership rechecked on every page. SS-Q15: case-insensitive name search, ascending UUID cursor; UI sorts the loaded page alphabetically. No private HR fields or wider staff permission.',
      parameters: [
        { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
        ...['businessId', 'branchId'].map((name) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } })),
        { in: 'query', name: 'occurred_at', required: true, schema: { type: 'string', format: 'date-time' } },
        { in: 'query', name: 'q', required: false, description: 'Trimmed, literal case-insensitive substring of name_ar or name_en.', schema: { type: 'string', minLength: 1, maxLength: 50 } },
        { in: 'query', name: 'cursor', required: false, schema: { type: 'string', format: 'uuid' } },
        { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: {
        '200': { description: 'Limited dated performer page; warnings never exclude eligible employees.', content: json('SessionPerformerOptionPage') },
        '400': { description: 'Invalid strict query.', content: json('ErrorEnvelope') },
        '403': { description: 'Uniform scope/permission refusal or disabled orders feature.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication/readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/service-options': {
    get: {
      operationId: 'getServiceSessionServiceOptions',
      description: 'Admin recording-form service names, list prices and revisions only (SS-Q13). Requires record:service-sessions:branch and orders feature, confirmed business/branch ownership on every page. Ascending service UUID cursor; no commission data or broader catalog permission.',
      parameters: [
        { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
        ...['businessId', 'branchId'].map((name) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } })),
        { in: 'query', name: 'cursor', required: false, schema: { type: 'string', format: 'uuid' } },
        { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: {
        '200': { description: 'Limited service page; null cursor on the last page.', content: json('SessionServiceOptionPage') },
        '400': { description: 'Invalid strict query.', content: json('ErrorEnvelope') },
        '403': { description: 'Uniform scope/permission refusal or disabled orders feature.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication/readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recording-context': {
    get: {
      operationId: 'getServiceSessionRecordingContext',
      description: 'Admin recording-form context under record:service-sessions:branch and orders feature (SS-Q13). Own active branch-covering memberships only. Sole or explicit selection resolves its fresh advisory discount limit; ambiguity returns null selection/limit. No wider read authority.',
      parameters: [
        { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
        ...['businessId', 'branchId'].map((name) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } })),
        { in: 'query', name: 'recorder_membership_id', required: false, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': { description: 'Own choices, business timezone and server instant; limit only after verified selection.', content: json('RecordingContext') },
        '400': { description: 'Invalid strict query.', content: json('ErrorEnvelope') },
        '403': { description: 'Uniform scope/selection/permission refusal or disabled orders feature.', content: json('ErrorEnvelope') },
        default: { description: 'Bilingual authentication/readiness refusal.', content: json('ErrorEnvelope') },
      },
    },
  },
};
