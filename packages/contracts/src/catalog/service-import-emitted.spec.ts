import { describe, expect, it } from 'vitest';

import committedDocument from '../../openapi/openapi.json' with { type: 'json' };
import { serviceImportRow, serviceImportStatus } from './service-import.js';

// أي evidence على الوثيقة المولّدة نفسها: سلوك الـ runtime والسلوك المنشور معاً، ملف واحد قابل للمراجعة.

const baseRow = {
  row: 2,
  name_en: 'Hair Cut',
  name_ar: null,
  price: '12.500',
  duration_minutes: null,
  category_id: null,
  category_name_en: null,
  commission_rule: { kind: 'FOLLOW_PLAN' },
  commission_value: null,
  commission_rule_defaulted: true,
  counts_toward_threshold: true,
} as const;

describe('emitted cursor schema', () => {
  it('uses the same cursor schema for the preview cursor and the rows-page cursor', () => {
    const schemas = committedDocument.components.schemas;
    const preview = schemas.ServiceImportPreview.properties.next_cursor;
    const page = schemas.ServiceImportRowsPage.properties.next_cursor;
    const query = schemas.ServiceImportRowsQuery.properties.cursor;
    expect(page).toEqual({ ...schemas.ServiceImportRowsCursor, nullable: true });
    expect(query).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/ServiceImportRowsCursor' }],
    });
    // نفس السكيما للمعاينة وصفوف الصفحة: مرجع واحد مش نسختين.
    expect(preview).toEqual(page);
  });

  it.each([
    ['1', false],
    ['2', true],
    ['1048576', true],
    ['1048577', false],
  ])('checks the row boundary for %s in the published query and response', (value, accepted) => {
    const schemas = committedDocument.components.schemas;
    expect(new RegExp(schemas.ServiceImportRowsCursor.pattern).test(value)).toBe(accepted);
    expect(new RegExp(schemas.ServiceImportRowsPage.properties.next_cursor.pattern).test(value)).toBe(
      accepted,
    );
  });
});

describe('emitted nullable import fields', () => {
  it('declares nullable duration and status errors where OpenAPI 3.0 permits null', () => {
    const schemas = committedDocument.components.schemas;
    expect(schemas.ServiceImportRow.properties.duration_minutes).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 600,
      nullable: true,
    });
    expect(schemas.ServiceImportStatus.properties.error_code).toMatchObject({
      type: 'string',
      nullable: true,
      enum: expect.arrayContaining([null, 'IMPORT_COMMIT_FAILED']),
    });
    expect(serviceImportRow.safeParse(baseRow).success).toBe(true);
    expect(
      serviceImportStatus.safeParse({
        preview_id: '01920000-0000-7000-8000-000000000001',
        status: 'ready',
        created_count: 0,
        error_code: null,
      }).success,
    ).toBe(true);
  });

  it('emits nullability on the union member, not on a nullable anyOf ref', () => {
    const committed = committedDocument as {
      components: {
        schemas: {
          ServiceImportRow: { properties: { commission_value: { anyOf: unknown } } };
        };
      };
    };
    const emitted = committed.components.schemas.ServiceImportRow.properties.commission_value;
    // التوليفة المكسورة كانت nullable فوق anyOf فيه $ref معرّى، وهي اللي كانت بتسقط عميل openapi-typescript.
    expect(emitted.anyOf).toEqual([
      { type: 'integer', minimum: 0, maximum: 10_000, nullable: true },
      { type: 'string', pattern: '^(0|[1-9]\\d{0,10})\\.\\d{3}$' },
    ]);
  });
});

describe('runtime parity of the commission string with ServicePrice', () => {
  it('accepts and refuses the same values ServicePrice accepts and refuses', () => {
    expect(serviceImportRow.safeParse({ ...baseRow, commission_value: null }).success).toBe(true);
    expect(serviceImportRow.safeParse({ ...baseRow, commission_value: '12.500' }).success).toBe(
      false,
    );
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'FIXED', value: '12.500' },
        commission_value: '12.500',
        commission_rule_defaulted: false,
      }).success,
    ).toBe(true);
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'FIXED', value: '12.5000' },
        commission_value: '12.5000',
      }).success,
    ).toBe(false);
  });
});

describe('emitted create settings reservation', () => {
  it('emits the reserved country key as a not-required constraint', () => {
    const committed = committedDocument as {
      components: {
        schemas: {
          CreateBusinessInput: { properties: { settings: Record<string, unknown> } };
        };
      };
    };
    const settings = committed.components.schemas.CreateBusinessInput.properties.settings;
    expect(settings).toMatchObject({ not: { required: ['country'] } });
    // بقية الإعدادات مسموحة: المخطط إعدادات مفتوحة، والمنع على المفتاح الواحد فقط.
    expect(settings).toMatchObject({ type: 'object', additionalProperties: {} });
  });
});
