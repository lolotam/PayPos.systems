import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { reviewCoverage } from '../data-steps/coverage.ts';
import { migrationDataSteps } from '../data-steps/index.ts';

// مسح المصدر لقاعدة خطوات البيانات (ADR-0054 §5): خطوة ما تأخذ قفل فترة داخل callback، وخطوة
// تكتب جدول مصدر مغطّى بإثبات التغطية لازم تعلن INVALIDATES في السجل. الاختبار بدون قاعدة بيانات.

/** جداول المصدر المغطّاة بإثبات التغطية (تدقيق مسارات الكتابة في PR #1259): سطور الخدمة والمؤدّون،
 * البقشيش، مبيعات الباقات SOLD، والرواتب. أسماء SQL وأسماء الـdrizzle معاً، فالمسح يصطاد الاثنين. */
const COVERED_TABLES = [
  'service_lines',
  'line_performers',
  'package_entitlements',
  'employee_salaries',
  'session_tip_revisions',
  'serviceLines',
  'linePerformers',
  'packageEntitlements',
  'employeeSalaries',
  'sessionTipRevisions',
] as const;

/** ملفات السجل والآلية: لا تلمس جداول مغطاة بنفسها أبداً؛ الخطوات تعيش في ملفاتها (شكل ADR-0038). */
const NON_STEP_FILES = new Set(['index.ts', 'coverage.ts']);

const stepsDir = new URL('../data-steps/', import.meta.url);
const stepFiles = readdirSync(stepsDir).filter(
  (file) => file.endsWith('.ts') && !NON_STEP_FILES.has(file),
);

/** يشيل التعليقات قبل المسح حتى لا يعلّق توثيق معرّف محظور دون أن يستعمله الكود فعلاً. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/(^|\s)--[^\n]*/g, '$1');
}

describe('data-step coverage source scan', () => {
  it('never imports or calls lockStatementPeriods inside a data step', () => {
    for (const file of readdirSync(stepsDir).filter((file) => file.endsWith('.ts'))) {
      const source = withoutComments(readFileSync(new URL(file, stepsDir), 'utf8'));
      expect(source, `${file} mentions lockStatementPeriods`).not.toContain(
        'lockStatementPeriods',
      );
    }
  });

  it('registers every step file in the reviewed allowlist and maps each key to its file', () => {
    const steps = migrationDataSteps('postgres://placeholder:x@db:1/pospay', 'placeholder');
    for (const file of stepFiles) {
      const key = file.replace(/\.ts$/, '');
      expect(steps, `step file ${file} is not registered in data-steps/index.ts`).toHaveProperty(
        key,
      );
      expect(Object.hasOwn(steps, key)).toBe(true);
    }
  });

  it('fails a step that touches a covered table without declaring coverage invalidation', () => {
    const steps = migrationDataSteps('postgres://placeholder:x@db:1/pospay', 'placeholder');
    for (const file of stepFiles) {
      const source = withoutComments(readFileSync(new URL(file, stepsDir), 'utf8'));
      const touched = COVERED_TABLES.filter((table) => source.includes(table));
      if (touched.length === 0) continue;
      const key = file.replace(/\.ts$/, '');
      const declared = Object.hasOwn(steps, key) ? steps[key]?.coverage : undefined;
      expect(
        declared,
        `${file} writes covered source rows (${touched.join(', ')}) but declares ${String(declared)}`,
      ).toBe('INVALIDATES');
    }
  });

  it('keeps the registry and the mechanism free of covered-table writes', () => {
    for (const file of NON_STEP_FILES) {
      const source = withoutComments(readFileSync(new URL(file, stepsDir), 'utf8'));
      const touched = COVERED_TABLES.filter((table) => source.includes(table));
      expect(touched, `${file} must not write covered tables itself`).toEqual([]);
    }
  });

  it('declares a reviewed coverage value for every registered step', () => {
    const steps = migrationDataSteps('postgres://placeholder:x@db:1/pospay', 'placeholder');
    for (const [key, entry] of Object.entries(steps)) {
      expect(['INVALIDATES', 'NONE'], `step ${key} has an unknown coverage value`).toContain(
        entry.coverage,
      );
      expect(typeof entry.run).toBe('function');
    }
  });
});

describe('reviewCoverage', () => {
  it('accepts the two reviewed declarations', () => {
    expect(() => reviewCoverage('step-a', 'INVALIDATES')).not.toThrow();
    expect(() => reviewCoverage('step-b', 'NONE')).not.toThrow();
  });

  it.each([undefined, '', 'invalidates', 'SOME', 'NONE '])(
    'refuses the undeclared or unknown coverage value %s before any statement',
    (coverage) => {
      expect(() => reviewCoverage('step-c', coverage)).toThrow(
        'Migration data step step-c carries no reviewed coverage declaration; migration aborted',
      );
    },
  );
});
