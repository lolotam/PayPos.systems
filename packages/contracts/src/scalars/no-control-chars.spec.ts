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

import { noControlChars } from './no-control-chars.js';

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

describe('the shared no-control-characters rule', () => {
  it.each(nameCases)('refuses a control character in %s', (_label, schema, payload) => {
    for (const [label, value] of controlCharacters) {
      expect(
        schema.safeParse(payload(`Example${String.fromCharCode(value)}Name`)).success,
        label,
      ).toBe(false);
    }
  });

  it.each(nameCases)('accepts a valid name for %s', (_label, schema, payload) => {
    for (const [label, name] of acceptedNames) {
      expect(schema.safeParse(payload(name)).success, label).toBe(true);
    }
  });

  it('publishes a portable name pattern and no property escape', () => {
    const document = JSON.stringify(buildOpenApiDocument());
    expect(document).not.toMatch(/\\[pP]\{/);
    // محركات RE2 (زي Go و Rust) مش بتعرف تترجم lookahead، فالنمط المنشور لازم يبقى من غير واحد.
    // أنماط التاريخ والتليفون القديمة لسه فيها lookahead، فالفحص هنا على النمط المشترك بس.
    expect(noControlChars.source).not.toMatch(/\(\?<?[=!]/);
  });
});
