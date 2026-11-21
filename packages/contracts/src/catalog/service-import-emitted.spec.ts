import { describe, expect, it } from 'vitest';

import committedDocument from '../../openapi/openapi.json' with { type: 'json' };
import { serviceImportRow } from './service-import.js';

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
    const committed = committedDocument as {
      components: {
        schemas: {
          ServiceImportPreview: { properties: { next_cursor: object } };
          ServiceImportRowsPage: { properties: { next_cursor: object } };
          ServiceImportRowsQuery: { properties: { cursor: object } };
        };
      };
    };
    const preview = committed.components.schemas.ServiceImportPreview.properties.next_cursor;
    const page = committed.components.schemas.ServiceImportRowsPage.properties.next_cursor;
    const query = committed.components.schemas.ServiceImportRowsQuery.properties.cursor;
    // النمط المعتمد لمرجع مُسمّى قابل للإلغاء: nullable مع allOf، نفس سابق Service.category في العميل.
    expect(page).toEqual({
      nullable: true,
      allOf: [{ $ref: '#/components/schemas/ServiceImportRowsCursor' }],
    });
    expect(query).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/ServiceImportRowsCursor' }],
    });
    // نفس السكيما للمعاينة وصفوف الصفحة: مرجع واحد مش نسختين.
    expect(preview).toEqual(page);
  });
});

describe('emitted commission_value schema', () => {
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

describe('runtime parity of the inline commission string (no drift from ServicePrice)', () => {
  it('accepts and refuses the same values ServicePrice accepts and refuses', () => {
    expect(serviceImportRow.safeParse({ ...baseRow, commission_value: null }).success).toBe(true);
    expect(serviceImportRow.safeParse({ ...baseRow, commission_value: '12.500' }).success).toBe(false);
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
