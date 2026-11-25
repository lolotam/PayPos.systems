import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACKAGE_IMPORT_HEADERS } from '@pospay/contracts';
import {
  PACKAGE_IMPORT_TEMPLATE_HEADERS,
  PACKAGE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS,
  PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES,
  packageImportTemplateCapacity,
} from '../package-import-template.ts';

describe('package import template headers', () => {
  it('matches the shared contract header list exactly, column by column', () => {
    expect(PACKAGE_IMPORT_TEMPLATE_HEADERS).toEqual([...PACKAGE_IMPORT_HEADERS]);
  });

  it('is six fixed columns followed by twenty service groups of three', () => {
    expect(PACKAGE_IMPORT_TEMPLATE_HEADERS).toHaveLength(66);
    expect(PACKAGE_IMPORT_TEMPLATE_HEADERS.slice(0, 6)).toEqual([
      'customer_phone',
      'name_en',
      'name_ar',
      'price_paid',
      'expires_on',
      'external_ref',
    ]);
    expect(PACKAGE_IMPORT_TEMPLATE_HEADERS.slice(6, 9)).toEqual([
      'service_1',
      'sessions_1',
      'remaining_1',
    ]);
    expect(PACKAGE_IMPORT_TEMPLATE_HEADERS.slice(-3)).toEqual([
      'service_20',
      'sessions_20',
      'remaining_20',
    ]);
    expect(new Set(PACKAGE_IMPORT_TEMPLATE_HEADERS).size).toBe(66);
  });
});

describe('packageImportTemplateCapacity', () => {
  it('accepts an empty business and the exact maximum', () => {
    expect(PACKAGE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS).toBe(963);
    expect(PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES).toBe(962);
    expect(packageImportTemplateCapacity(0)).toEqual({ ok: true });
    expect(packageImportTemplateCapacity(962)).toEqual({ ok: true });
  });

  it('refuses one service over the guarded reference row ceiling instead of truncating', () => {
    expect(packageImportTemplateCapacity(963)).toEqual({ ok: false, reason: 'REFERENCE_ROWS' });
    expect(packageImportTemplateCapacity(100_000)).toEqual({ ok: false, reason: 'REFERENCE_ROWS' });
  });
});

describe('package import template domain purity', () => {
  it('never reads the clock or generates ids', () => {
    const source = readFileSync(new URL('../package-import-template.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Date\.now|new Date\(|randomUUID/);
  });
});
