import { describe, expect, it } from 'vitest';

import committed from '../../openapi/openapi.json' with { type: 'json' };
import { buildOpenApiDocument } from '../openapi.js';
import { expectedOpenApiSchemaNames } from './openapi-schema-names.js';

describe('openapi/openapi.json', () => {
  it('matches the contracts — run `pnpm contracts:openapi` after changing a schema', () => {
    expect(buildOpenApiDocument()).toEqual(committed);
  });

  it('publishes every schema with no $id inside a component', () => {
    const schemas = (buildOpenApiDocument()['components'] as { schemas: Record<string, object> })
      .schemas;
    expect(Object.keys(schemas).sort()).toEqual(expectedOpenApiSchemaNames);
    for (const schema of Object.values(schemas)) {
      expect(schema).not.toHaveProperty('$id');
    }
  });

  it('publishes currency and timezone as closed enums, so generated clients reject unknown values', () => {
    const schemas = (
      buildOpenApiDocument()['components'] as { schemas: Record<string, { enum?: string[] }> }
    ).schemas;
    expect(schemas['Currency']?.enum).toContain('KWD');
    expect(schemas['Currency']?.enum).not.toContain('ZZZ');
    expect(schemas['TimeZone']?.enum).toContain('Asia/Kuwait');
    expect(schemas['TimeZone']?.enum).not.toContain('Asia/Atlantis');
  });
});

it('keeps change off a recorded line and optional on a changed line', () => {
  const schemas = (
    buildOpenApiDocument()['components'] as {
      schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
    }
  ).schemas;
  const recorded = schemas['RecordedServiceLine'];
  const changed = schemas['ServiceLineChanged'];
  expect(recorded?.properties).not.toHaveProperty('change');
  expect(JSON.stringify(recorded)).not.toContain('"not"');
  expect(changed?.properties).toHaveProperty('change');
  expect(changed?.required ?? []).not.toContain('change');
});

it('publishes both change kinds of a changed line', () => {
  const document = JSON.stringify(buildOpenApiDocument());
  expect(document).toContain('PRICE_DISCOUNT_EDIT');
  expect(document).toContain('LINE_CANCELLED');
  expect(document).toContain('PERFORMERS_CHANGE');
});

// `not: {}` بتاع z.never() هو الشكل اللي الـ toolchain بتاع OpenAPI 3.0 مش بيعرفه؛ أما `not`
// اللي فيه pattern فده OpenAPI 3.0 صالح، وopenapi-typescript بيتجاهله.
it('publishes no empty "not" schema: the z.never() shape our OpenAPI 3.0 toolchain cannot represent', () => {
  expect(JSON.stringify(buildOpenApiDocument())).not.toContain('"not":{}');
});

// روتَي الكتابة الذاتية بس اللي بيرجعوا OwnLeaveWriteResult؛ روتات الإدارة لسه بترجع LeaveRequest.
it('own write operations answer OwnLeaveWriteResult while admin write operations keep LeaveRequest', () => {
  const paths = buildOpenApiDocument()['paths'] as Record<
    string,
    Record<
      string,
      { responses: Record<string, { content: Record<string, { schema: { $ref?: string } }> }> }
    >
  >;
  const ref = (path: string, status: string) =>
    paths[path]?.post?.responses[status]?.content['application/json']?.schema.$ref;
  expect(ref('/v1/staff/me/leave-requests', '201')).toBe(
    '#/components/schemas/OwnLeaveWriteResult',
  );
  expect(ref('/v1/staff/me/leave-requests/{leaveId}/cancel', '200')).toBe(
    '#/components/schemas/OwnLeaveWriteResult',
  );
  expect(ref('/v1/businesses/{businessId}/employees/{employeeId}/leave-requests', '201')).toBe(
    '#/components/schemas/LeaveRequest',
  );
  expect(
    ref(
      '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests/{leaveId}/cancel',
      '200',
    ),
  ).toBe('#/components/schemas/LeaveRequest');
});
