import { expect, it } from 'vitest';

import { serviceCommissionRule } from '../../catalog/service.js';
import { buildOpenApiDocument } from '../../openapi.js';
import {
  commissionServiceOverride,
  commissionServiceOverrideList,
  commissionServiceOverrideListItem,
  commissionServiceOverrideListQuery,
  createCommissionServiceOverrideInput,
} from '../service-overrides.js';

const serviceId = '01920000-0000-7000-8000-000000000201';
const employeeId = '01920000-0000-7000-8000-000000000202';
const overrideId = '01920000-0000-7000-8000-000000000203';
const actorId = '01920000-0000-7000-8000-000000000204';

const body = {
  service_id: serviceId,
  rule: { kind: 'PCT', value: 1500 },
  effective_from: '2026-11-01',
};

const stored = {
  id: overrideId,
  employee_id: employeeId,
  service_id: serviceId,
  rule: { kind: 'PCT', value: 1500 },
  effective_from: '2026-11-01',
  created_at: '2026-11-01T09:00:00Z',
  created_by: actorId,
};

// التجاوز يستخدم أنواع الكتالوج الأربعة نفسها من غير نوع إضافي.
const overrideRules: { kind: string; value?: number | string }[] = [
  { kind: 'FOLLOW_PLAN' },
  { kind: 'ZERO' },
  { kind: 'PCT', value: 0 },
  { kind: 'PCT', value: 10_000 },
  { kind: 'FIXED', value: '0.000' },
  { kind: 'FIXED', value: '12.500' },
];

it.each(overrideRules)('accepts the override rule %j', (rule) => {
  const body_ = { ...body, rule };
  expect(createCommissionServiceOverrideInput.parse(body_)).toEqual(body_);
});

it.each([
  { label: 'a negative PCT value', rule: { kind: 'PCT', value: -1 } },
  { label: 'a PCT value above 10000 bps', rule: { kind: 'PCT', value: 10_001 } },
  { label: 'a fractional PCT value', rule: { kind: 'PCT', value: 1.5 } },
  { label: 'a PCT value sent as a string', rule: { kind: 'PCT', value: '1500' } },
  { label: 'FOLLOW_SERVICE', rule: { kind: 'FOLLOW_SERVICE' } },
  { label: 'a kind the contracts do not know', rule: { kind: 'UNKNOWN', value: 0 } },
])('refuses $label', ({ rule }) => {
  const body_ = { ...body, rule };
  expect(createCommissionServiceOverrideInput.safeParse(body_).success).toBe(false);
});

it.each(['1.5', '-1.000', '1.0000', '1', '00.000'])('refuses the FIXED amount %s', (value) => {
  const body_ = { ...body, rule: { kind: 'FIXED', value } };
  expect(createCommissionServiceOverrideInput.safeParse(body_).success).toBe(false);
});

it('keeps a FIXED amount lossless up to numeric(14,3)', () => {
  const rule = { kind: 'FIXED', value: '99999999999.999' };
  const parsed = createCommissionServiceOverrideInput.parse({ ...body, rule });
  expect(parsed.rule).toEqual(rule);
});

it('refuses a FIXED amount wider than numeric(14,3)', () => {
  const body_ = { ...body, rule: { kind: 'FIXED', value: '100000000000.000' } };
  expect(createCommissionServiceOverrideInput.safeParse(body_).success).toBe(false);
});

it('refuses FOLLOW_SERVICE in stored and list responses', () => {
  const record = { ...stored, rule: { kind: 'FOLLOW_SERVICE' } };
  expect(commissionServiceOverride.safeParse(record).success).toBe(false);
  expect(
    commissionServiceOverrideListItem.safeParse({ ...record, is_current: false }).success,
  ).toBe(false);
});

it('keeps FOLLOW_SERVICE out of the ordinary catalog rule', () => {
  expect(serviceCommissionRule.safeParse({ kind: 'FOLLOW_SERVICE' }).success).toBe(false);
});

it.each([
  { label: 'whole_period', body: { ...body, whole_period: false } },
  { label: 'an unknown key', body: { ...body, unexpected: true } },
  { label: 'a missing service', body: { rule: body.rule, effective_from: body.effective_from } },
])('refuses a body carrying $label', ({ body: body_ }) => {
  expect(createCommissionServiceOverrideInput.safeParse(body_).success).toBe(false);
});

it('refuses an effective date in year zero', () => {
  const body_ = { ...body, effective_from: '0000-01-01' };
  expect(createCommissionServiceOverrideInput.safeParse(body_).success).toBe(false);
});

it('accepts a valid leap day', () => {
  const body_ = { ...body, effective_from: '2028-02-29' };
  expect(createCommissionServiceOverrideInput.safeParse(body_).success).toBe(true);
});

it('defaults the list query limit to 20', () => {
  expect(commissionServiceOverrideListQuery.parse({})).toEqual({ limit: 20 });
});

it('coerces a query-string limit', () => {
  expect(commissionServiceOverrideListQuery.parse({ limit: '50' })).toEqual({ limit: 50 });
});

it.each(['0', '101', 'abc', '20.5'])('refuses the limit %s', (limit) => {
  expect(commissionServiceOverrideListQuery.safeParse({ limit }).success).toBe(false);
});

it('accepts an optional service filter', () => {
  const query = { service_id: serviceId };
  expect(commissionServiceOverrideListQuery.parse(query)).toEqual({
    limit: 20,
    service_id: serviceId,
  });
});

it('refuses an unknown query key', () => {
  const query = { employee_id: employeeId };
  expect(commissionServiceOverrideListQuery.safeParse(query).success).toBe(false);
});

it('accepts a base64url cursor', () => {
  const cursor = 'YWJjZGVmZ2hpamtsbW5vcA';
  expect(commissionServiceOverrideListQuery.parse({ cursor })).toEqual({ limit: 20, cursor });
});

it.each(['', 'abc+def', 'abc/def', 'abc=def'])('refuses the cursor %s', (cursor) => {
  expect(commissionServiceOverrideListQuery.safeParse({ cursor }).success).toBe(false);
});

it('accepts a cursor of 512 characters and refuses 513', () => {
  const cursor = 'a'.repeat(512);
  expect(commissionServiceOverrideListQuery.safeParse({ cursor }).success).toBe(true);
  const longer = 'a'.repeat(513);
  expect(commissionServiceOverrideListQuery.safeParse({ cursor: longer }).success).toBe(false);
});

it('parses the stored override with its audit time and actor', () => {
  expect(commissionServiceOverride.parse(stored)).toEqual(stored);
});

it('refuses a stored override without the actor', () => {
  const record = { ...stored, created_by: undefined };
  expect(commissionServiceOverride.safeParse(record).success).toBe(false);
});

it('keeps the stored response open to unknown fields, as every other response is', () => {
  const record = { ...stored, unexpected: 'x' };
  expect(commissionServiceOverride.parse(record)).toEqual(stored);
});

it('marks the current override in the list', () => {
  const item = { ...stored, is_current: true };
  expect(commissionServiceOverrideListItem.parse(item)).toEqual(item);
});

it('refuses a list item without is_current', () => {
  expect(commissionServiceOverrideListItem.safeParse(stored).success).toBe(false);
});

it('bounds the page at a hundred items', () => {
  const items = Array.from({ length: 100 }, () => ({ ...stored, is_current: true }));
  const page = { items, next_cursor: null };
  expect(commissionServiceOverrideList.safeParse(page).success).toBe(true);
  const longer = { items: [...items, items[0]], next_cursor: null };
  expect(commissionServiceOverrideList.safeParse(longer).success).toBe(false);
});

it('keeps the next cursor nullable and bounded like the query cursor', () => {
  expect(commissionServiceOverrideList.parse({ items: [], next_cursor: null })).toEqual({
    items: [],
    next_cursor: null,
  });
  const tooLong = { items: [], next_cursor: 'a'.repeat(513) };
  expect(commissionServiceOverrideList.safeParse(tooLong).success).toBe(false);
  const badAlphabet = { items: [], next_cursor: 'abc+def' };
  expect(commissionServiceOverrideList.safeParse(badAlphabet).success).toBe(false);
});

type Parameter = { name: string; in: string; required?: boolean; schema?: Record<string, unknown> };
type Operation = {
  operationId?: string;
  parameters?: Parameter[];
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
};
type RuleBranch = { properties?: { kind?: { enum?: string[] } } };
type Schema = {
  properties?: Record<string, { enum?: string[]; $ref?: string }>;
  additionalProperties?: boolean;
  oneOf?: RuleBranch[];
};

const path = '/v1/businesses/{businessId}/employees/{employeeId}/commission-overrides';
const document = buildOpenApiDocument();
const paths = document['paths'] as Record<string, Record<string, Operation>>;
const schemas = (document['components'] as { schemas: Record<string, Schema> }).schemas;
const ruleKinds = (schema: Schema | undefined) =>
  (schema?.oneOf ?? []).map((branch) => branch.properties?.kind?.enum?.[0]);

it('publishes the write and the list under the settled operation ids', () => {
  expect(paths[path]?.['post']?.operationId).toBe('createCommissionServiceOverride');
  expect(paths[path]?.['get']?.operationId).toBe('listCommissionServiceOverrides');
});

it('requires the company header, both path ids and the idempotency key on the write', () => {
  const parameters = paths[path]?.['post']?.parameters ?? [];
  const company = parameters.find((parameter) => parameter.name === 'x-company-id');
  const business = parameters.find((parameter) => parameter.name === 'businessId');
  const employee = parameters.find((parameter) => parameter.name === 'employeeId');
  const idempotency = parameters.find((parameter) => parameter.name === 'Idempotency-Key');
  expect(company).toMatchObject({ in: 'header', required: true });
  expect(business).toMatchObject({ in: 'path', required: true });
  expect(employee).toMatchObject({ in: 'path', required: true });
  expect(idempotency).toMatchObject({ in: 'header', required: true });
});

it('publishes the stored response and the list response', () => {
  const write = paths[path]?.['post']?.responses?.['201']?.content?.['application/json']?.schema;
  const read = paths[path]?.['get']?.responses?.['200']?.content?.['application/json']?.schema;
  expect(write).toEqual({ $ref: '#/components/schemas/CommissionServiceOverride' });
  expect(read).toEqual({ $ref: '#/components/schemas/CommissionServiceOverrideList' });
});

it('publishes the two 422 refusals with their exact codes', () => {
  const refusal = paths[path]?.['post']?.responses?.['422']?.content?.['application/json']?.schema;
  expect(refusal).toEqual({
    oneOf: [
      { $ref: '#/components/schemas/CommissionEffectiveFromPastError' },
      { $ref: '#/components/schemas/CommissionPlanIdempotencyKeyReusedError' },
    ],
  });
  const past = schemas['CommissionEffectiveFromPastError']?.properties?.['code']?.enum;
  const reused = schemas['CommissionPlanIdempotencyKeyReusedError']?.properties?.['code']?.enum;
  expect(past).toEqual(['COMMISSION_EFFECTIVE_FROM_PAST']);
  expect(reused).toEqual(['IDEMPOTENCY_KEY_REUSED']);
});

it('documents the 403, 404 and 409 refusals of the write', () => {
  const responses = paths[path]?.['post']?.responses ?? {};
  expect(responses['403']?.description).toBeTruthy();
  expect(responses['404']?.description).toContain('SERVICE_NOT_FOUND');
  expect(responses['409']?.description).toContain('COMMISSION_PERIOD_CLOSED');
});

it('publishes the bounded list query parameters', () => {
  const parameters = paths[path]?.['get']?.parameters ?? [];
  const service = parameters.find((parameter) => parameter.name === 'service_id');
  const cursor = parameters.find((parameter) => parameter.name === 'cursor');
  const limit = parameters.find((parameter) => parameter.name === 'limit');
  expect(service).toMatchObject({ in: 'query' });
  expect(cursor?.schema).toMatchObject({ type: 'string', minLength: 1, maxLength: 512 });
  expect(limit?.schema).toMatchObject({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 20,
  });
});

it('publishes the new schemas as components', () => {
  expect(Object.keys(schemas)).toEqual(
    expect.arrayContaining([
      'CreateCommissionServiceOverrideInput',
      'CommissionServiceOverride',
      'CommissionServiceOverrideListQuery',
      'CommissionServiceOverrideListItem',
      'CommissionServiceOverrideList',
    ]),
  );
});

it('reuses the four-kind catalog rule without an override-rule component', () => {
  expect(schemas['CreateCommissionServiceOverrideInput']?.properties?.['rule']?.$ref).toBe(
    '#/components/schemas/ServiceCommissionRule',
  );
  expect(ruleKinds(schemas['ServiceCommissionRule'])).toEqual([
    'FOLLOW_PLAN',
    'ZERO',
    'PCT',
    'FIXED',
  ]);
  expect(schemas['CommissionServiceOverrideRule']).toBeUndefined();
});

it('publishes a strict body and an open response, like every other contract here', () => {
  expect(schemas['CreateCommissionServiceOverrideInput']?.additionalProperties).toBe(false);
  expect(schemas['CommissionServiceOverride']?.additionalProperties).toBeUndefined();
});
