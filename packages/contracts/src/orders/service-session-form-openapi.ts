const json = (schema: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } });
export const serviceSessionFormPaths = {
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
