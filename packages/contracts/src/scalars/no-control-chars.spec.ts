import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { createPackageTypeInput } from '../catalog/package-type.js';
import {
  createServiceCategoryInput,
  serviceCategoryCursorData,
} from '../catalog/service-category.js';
import { createServiceInput } from '../catalog/service.js';
import { findOrCreateCustomerInput } from '../customers.js';
import { buildOpenApiDocument } from '../openapi.js';

import { controlChar } from './no-control-chars.js';

const uuid = '01920000-0000-7000-8000-000000000001';

// القاعدة واحدة مشتركة، فمصفوفة واحدة تختبر كل الأسماء اللي بتستخدمها بدل تكرار نفس
// الاختبار في كل ملف: كل سطر = اسم الحقل + الـ schema اللي بيفحصه + الدالة اللي بتبني الطلب.
const nameCases: [string, z.ZodType, (name: string) => unknown][] = [
  [
    'the customer name',
    findOrCreateCustomerInput,
    (name) => ({
      phone: { calling_code: '965', national_number: '2025550123' },
      name,
      locale: 'ar',
    }),
  ],
  [
    'a service category name',
    createServiceCategoryInput,
    (name) => ({ name_en: name, name_ar: 'صبغة' }),
  ],
  [
    'a service category Arabic name',
    createServiceCategoryInput,
    (name) => ({ name_en: 'Hair', name_ar: name }),
  ],
  ['the service category cursor name', serviceCategoryCursorData, (name) => [name, uuid]],
  [
    'a service name',
    createServiceInput,
    (name) => ({ name_en: name, price: '10.000', commission_rule: { kind: 'ZERO' } }),
  ],
  [
    'a service Arabic name',
    createServiceInput,
    (name) => ({
      name_en: 'Service',
      name_ar: name,
      price: '10.000',
      commission_rule: { kind: 'ZERO' },
    }),
  ],
  [
    'a package type name',
    createPackageTypeInput,
    (name) => ({
      name_en: name,
      name_ar: null,
      price: '25.000',
      validity_days: 90,
      components: [{ service_id: uuid, sessions: 10 }],
    }),
  ],
  [
    'a package type Arabic name',
    createPackageTypeInput,
    (name) => ({
      name_en: 'Package',
      name_ar: name,
      price: '25.000',
      validity_days: 90,
      components: [{ service_id: uuid, sessions: 10 }],
    }),
  ],
];

const controlCharacters: [string, number][] = [
  ['U+0000', 0x00],
  ['U+001F', 0x1f],
  ['U+007F', 0x7f],
  ['U+009F', 0x9f],
];

const acceptedNames: [string, string][] = [
  ['U+00A0', 'Example\u00a0Name'],
  ['an Arabic name', 'عميل تجريبي'],
  ['an emoji', 'Example 😀'],
];

// المنع المنشور يقول type: 'string' لأن pattern بيشتغل على النصوص بس، فبدونه الـ null بيعدّي غلط.
const publishedProhibition = { type: 'string', pattern: controlChar.source };

// مسار كل اسم في السكيما المنشورة، عشان نأكد إن المنع وصل لكل واحد فيهم.
const publishedNamePaths: [string, string[]][] = [
  ['FindOrCreateCustomerInput', ['properties', 'name']],
  ['CreateServiceCategoryInput', ['properties', 'name_en']],
  ['CreateServiceCategoryInput', ['properties', 'name_ar']],
  ['CreateServiceInput', ['properties', 'name_en']],
  ['CreateServiceInput', ['properties', 'name_ar']],
  ['CreatePackageTypeInput', ['properties', 'name_en']],
  ['CreatePackageTypeInput', ['properties', 'name_ar']],
  ['ServiceCategoryCursorData', ['items', 'anyOf', '0']],
];

const valueAt = (node: unknown, path: string[]): unknown =>
  path.reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
    return undefined;
  }, node);

const notPatternsIn = (node: unknown): unknown[] => {
  if (Array.isArray(node)) return node.flatMap(notPatternsIn);
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      key === 'not' ? [value] : notPatternsIn(value),
    );
  }
  return [];
};

describe('the shared no-control-characters rule', () => {
  it.each(nameCases)('refuses a control character in %s', (_label, schema, payload) => {
    for (const [label, value] of controlCharacters) {
      const control = String.fromCharCode(value);
      for (const [position, name] of [
        ['inside the name', `Example${control}Name`],
        ['at the end of the name', `Example${control}`],
      ] as const) {
        expect(schema.safeParse(payload(name)).success, `${label} ${position}`).toBe(false);
      }
    }
  });

  it.each(nameCases)('accepts a valid name for %s', (_label, schema, payload) => {
    for (const [label, name] of acceptedNames) {
      expect(schema.safeParse(payload(name)).success, label).toBe(true);
    }
  });

  it('publishes only portable patterns', () => {
    const built = buildOpenApiDocument();
    const document = JSON.stringify(built);
    expect(document).not.toMatch(/\\[pP]\{/);
    expect(document).not.toContain('"pattern":"^[^\\\\x00');
    for (const not of notPatternsIn(built)) expect(not).toEqual(publishedProhibition);
    const schemas = (built['components'] as { schemas: Record<string, unknown> }).schemas;
    for (const [id, path] of publishedNamePaths) {
      expect(valueAt(schemas[id], path)).toMatchObject({ not: publishedProhibition });
    }
  });

  it('publishes the prohibition so a nullable name still accepts null', () => {
    const schemas = (buildOpenApiDocument()['components'] as { schemas: Record<string, unknown> })
      .schemas;
    const nameAr = valueAt(schemas['CreateServiceInput'], ['properties', 'name_ar']);
    expect(nameAr).toMatchObject({ nullable: true, not: { type: 'string' } });
  });
});
