import {
  alertChannel,
  alertFixedRecipient,
  alertKind,
  alertRecipientRole,
  alertRuleInput,
  alertRuleView,
  alertRules,
  resetBranchAlertRuleQuery,
  setAlertRulesInput,
  setAlertsMasterInput,
} from './alert-rules.js';

// كل سكيما في alert-rules.ts بتتسجل هنا، والمتداخلة كمان، وإلا Zod بيحطها تحت __shared بدل components.
export const alertRuleSchemas = [
  alertKind,
  alertRecipientRole,
  alertChannel,
  alertFixedRecipient,
  alertRuleView,
  alertRules,
  alertRuleInput,
  setAlertRulesInput,
  setAlertsMasterInput,
  resetBranchAlertRuleQuery,
];

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
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
const branchParameter = {
  in: 'path',
  name: 'branchId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const kindParameter = {
  in: 'path',
  name: 'kind',
  required: true,
  schema: { $ref: '#/components/schemas/AlertKind' },
};
const expectedRuleId = {
  in: 'query',
  name: 'expected_rule_id',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const expectedRevision = {
  in: 'query',
  name: 'expected_revision',
  required: true,
  schema: { type: 'integer', minimum: 1, maximum: 2147483646 },
};
const errors = { description: 'The API error envelope', content: json('ErrorEnvelope') };
const rules = () => ({
  '200': { description: 'The alert rules of the scope', content: json('AlertRules') },
  default: errors,
});

export const alertRulePaths = {
  '/v1/businesses/{businessId}/alert-rules': {
    get: {
      operationId: 'getBusinessAlertRules',
      description:
        'The alert rules of one business, one row per kind. Requires manage:alert-rules:business on that business; a caller without it, a device, another business and an unknown business are the same 403 FORBIDDEN. Every kind shows its source (DEFAULT, BUSINESS or BRANCH), the revision stored at this scope, and the master switch. Never writes.',
      parameters,
      responses: rules(),
    },
    put: {
      operationId: 'setBusinessAlertRules',
      description:
        'Replaces the business rules of the kinds in the request, each against its expected_rule_id and expected_revision (both null mean no rule is stored at this scope yet). Requires manage:alert-rules:business on that business; a caller without it, a device, another business and an unknown business are the same 403 FORBIDDEN. A value outside what the kind allows is ALERT_RULE_INVALID (422); a stale expected_rule_id or expected_revision is ALERT_RULE_REVISION_CONFLICT (409) and writes nothing. Every effective change is audited with before and after.',
      parameters,
      requestBody: { required: true, content: json('SetAlertRulesInput') },
      responses: rules(),
    },
  },
  '/v1/businesses/{businessId}/alert-rules/master': {
    put: {
      operationId: 'setBusinessAlertsMaster',
      description:
        'Turns every team alert of the business on or off at once. Requires manage:alert-rules:business on that business; a caller without it, a device, another business and an unknown business are the same 403 FORBIDDEN. The change is audited; the same value writes no audit row.',
      parameters,
      requestBody: { required: true, content: json('SetAlertsMasterInput') },
      responses: rules(),
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/alert-rules': {
    get: {
      operationId: 'getBranchAlertRules',
      description:
        'The alert rules of one branch: the branch rule where it has one, the business rule otherwise, and the kind default where neither is stored. Requires manage:alert-rules:business on that business; a caller without it, a device, another business and an unknown business are the same 403 FORBIDDEN. Every kind shows its source (DEFAULT, BUSINESS or BRANCH), the revision stored at the branch scope, and the master switch. Never writes.',
      parameters: [...parameters, branchParameter],
      responses: rules(),
    },
    put: {
      operationId: 'setBranchAlertRules',
      description:
        'Replaces the branch rules of the kinds in the request, each against its expected_rule_id and expected_revision (both null mean no branch rule is stored yet). Requires manage:alert-rules:business on that business; a caller without it, a device, another business and an unknown business are the same 403 FORBIDDEN. A value outside what the kind allows is ALERT_RULE_INVALID (422), and so is a kind that has no branch rule (DOCUMENT_EXPIRING and the two STATEMENT_* kinds); a stale expected_rule_id or expected_revision is ALERT_RULE_REVISION_CONFLICT (409) and writes nothing. Every effective change is audited with before and after.',
      parameters: [...parameters, branchParameter],
      requestBody: { required: true, content: json('SetAlertRulesInput') },
      responses: rules(),
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/alert-rules/{kind}': {
    delete: {
      operationId: 'resetBranchAlertRule',
      description:
        'Deletes the branch rule of one kind, so the branch returns to the business rule. The query carries the expected_rule_id and expected_revision the caller read; both must match the stored row. Requires manage:alert-rules:business on that business; a caller without it, a device, another business and an unknown business are the same 403 FORBIDDEN. A stale expected_rule_id or expected_revision, or a kind with no branch rule, is ALERT_RULE_REVISION_CONFLICT (409) and deletes nothing; the reset is audited with before and after.',
      parameters: [...parameters, branchParameter, kindParameter, expectedRuleId, expectedRevision],
      responses: {
        '204': { description: 'The branch rule was deleted' },
        '409': {
          description: 'The branch rule changed since it was read',
          content: json('ErrorEnvelope'),
        },
        default: errors,
      },
    },
  },
};
