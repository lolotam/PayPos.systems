import { expect, it, describe } from 'vitest';

import {
  SERVICE_IMPORT_MAX_BYTES,
  SERVICE_IMPORT_MAX_COLUMNS,
  SERVICE_IMPORT_MAX_DATA_ROWS,
  serviceImportExpectedHeaders,
} from '../service-import.ts';
import { XLSX_EXPANSION_BUDGET } from '@pospay/import-workbooks';

const REQUIRED = [
  'name_en',
  'name_ar',
  'price',
  'commission_rule',
  'commission_value',
  'counts_toward_threshold',
];

describe('header pre-selection (FR-001, SI-Q8)', () => {
  it('keeps the six required headers when neither optional header is present', () => {
    expect(serviceImportExpectedHeaders(REQUIRED)).toEqual([...REQUIRED]);
  });

  it('adds duration_minutes when its header is present', () => {
    expect(serviceImportExpectedHeaders(['price', ...REQUIRED, 'duration_minutes'])).toEqual([
      ...REQUIRED,
      'duration_minutes',
    ]);
  });

  it('adds category when its header is present', () => {
    expect(serviceImportExpectedHeaders([...REQUIRED, 'category'])).toEqual([
      ...REQUIRED,
      'category',
    ]);
  });

  it('adds both optional headers in the canonical order when both are present', () => {
    expect(
      serviceImportExpectedHeaders(['category', ...REQUIRED.slice(0, 3), 'duration_minutes', ...REQUIRED.slice(3)]),
    ).toEqual([...REQUIRED, 'duration_minutes', 'category']);
  });

  it('trims header text exactly like readSheet before deciding presence', () => {
    expect(
      serviceImportExpectedHeaders([...REQUIRED, '  duration_minutes ', '\tcategory\n']),
    ).toEqual([...REQUIRED, 'duration_minutes', 'category']);
    expect(serviceImportExpectedHeaders([...REQUIRED, 'duration minutes'])).toEqual([...REQUIRED]);
  });

  it('ignores null header cells and unknown headers instead of treating them as optional', () => {
    expect(serviceImportExpectedHeaders([null, ...REQUIRED, 'country_code'])).toEqual([...REQUIRED]);
  });
});

describe('workbook bounds (ADR-0034 addendum §3)', () => {
  it('carries the services bounds as constants', () => {
    expect(SERVICE_IMPORT_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(SERVICE_IMPORT_MAX_DATA_ROWS).toBe(500);
    expect(SERVICE_IMPORT_MAX_COLUMNS).toBe(10);
  });

  it('keeps six times the services grid inside the expansion budget', () => {
    // ورقة واحدة: 500 صفاً بيانات + صف العناوين + هامش صف واحد = 502، بعشرة أعمدة، على ست أوراق (A-13).
    const rowsPerSheet = SERVICE_IMPORT_MAX_DATA_ROWS + 2;
    const grid = 6 * rowsPerSheet * SERVICE_IMPORT_MAX_COLUMNS;
    expect(grid).toBe(30_120);
    expect(grid).toBeLessThanOrEqual(XLSX_EXPANSION_BUDGET);
    // باقي الميزانية هو هامش أوراق القالب المرجعية، وشرطه على 32b-2 مش على هذا التسليم (A-13/P-3).
    expect(XLSX_EXPANSION_BUDGET - grid).toBe(35_416);
    expect(Math.floor(XLSX_EXPANSION_BUDGET / SERVICE_IMPORT_MAX_COLUMNS)).toBe(6_553);
  });
});
