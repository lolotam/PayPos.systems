import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { reviewStep } from '../data-steps/coverage.ts';
import { migrationDataSteps } from '../data-steps/index.ts';

// مسح المصدر لقاعدة خطوات البيانات (ADR-0054 §5): خطوة ما تأخذ قفل فترة داخل callback، وخطوة
// تكتب جدول مصدر مغطّى بإثبات التغطية لازم تعلن INVALIDATES في السجل، والسجل هو من يبني واجهة
// الخطوة من إعلانها — جسم الخطوة لا يبني واجهته بنفسه. الاختبار بدون قاعدة بيانات.

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
const NON_STEP_BASENAMES = new Set(['index.ts', 'coverage.ts']);

const stepsDir = new URL('../data-steps/', import.meta.url);

/** كل ملفات .ts تحت data-steps/ في أي عمق، بمساراتها النسبية. */
function allStepSources(): string[] {
  return readdirSync(stepsDir, { recursive: true })
    .map((entry) => String(entry).replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.ts'));
}

/** يشيل التعليقات قبل المسح حتى لا يعلّق توثيق معرّف محظور دون أن يستعمله الكود فعلاً. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/(^|\s)--[^\n]*/g, '$1');
}

const indexSource = withoutComments(readFileSync(new URL('index.ts', stepsDir), 'utf8'));

describe('data-step coverage source scan', () => {
  it('never imports or calls lockStatementPeriods inside a data step, in any subfolder', () => {
    for (const path of allStepSources()) {
      const source = withoutComments(readFileSync(new URL(path, stepsDir), 'utf8'));
      expect(source, `${path} mentions lockStatementPeriods`).not.toContain(
        'lockStatementPeriods',
      );
    }
  });

  it('registers every step file in the reviewed allowlist and maps each key to its file', () => {
    // السجل الحقيقي: materialize يرفض ويبني بلا اتصال (الـapp يُبنى عند التشغيل فقط).
    const steps = migrationDataSteps('postgres://placeholder:x@db:1/pospay', 'placeholder');
    for (const path of allStepSources()) {
      if (NON_STEP_BASENAMES.has(path.split('/').at(-1) ?? '')) continue;
      const stem = (path.split('/').at(-1) ?? '').replace(/\.ts$/, '');
      const registered = Object.hasOwn(steps, stem) ||
        Object.keys(steps).some((key) => key.endsWith(`-${stem}`) || key.endsWith(`/${stem}`));
      expect(registered, `step file ${path} is not registered in data-steps/index.ts`).toBe(true);
    }
  });

  it('fails a step that touches a covered table without declaring coverage invalidation', () => {
    const steps = migrationDataSteps('postgres://placeholder:x@db:1/pospay', 'placeholder');
    for (const path of allStepSources()) {
      if (NON_STEP_BASENAMES.has(path.split('/').at(-1) ?? '')) continue;
      const source = withoutComments(readFileSync(new URL(path, stepsDir), 'utf8'));
      const touched = COVERED_TABLES.filter((table) => source.includes(table));
      if (touched.length === 0) continue;
      const stem = (path.split('/').at(-1) ?? '').replace(/\.ts$/, '');
      const key = Object.keys(steps).find(
        (candidate) => candidate === stem || candidate.endsWith(`-${stem}`),
      );
      const declared = key === undefined ? undefined : steps[key]?.coverage;
      expect(
        declared,
        `${path} touches covered source rows (${touched.join(', ')}) but declares ${String(declared)}`,
      ).toBe('INVALIDATES');
    }
  });

  it('keeps the registry and the mechanism free of covered-table writes', () => {
    for (const path of allStepSources()) {
      if (!NON_STEP_BASENAMES.has(path.split('/').at(-1) ?? '')) continue;
      const source = withoutComments(readFileSync(new URL(path, stepsDir), 'utf8'));
      const touched = COVERED_TABLES.filter((table) => source.includes(table));
      expect(touched, `${path} must not write covered tables itself`).toEqual([]);
    }
  });

  it('lets only the registry build the app: no createDatabase outside stepAppDatabase and no coverage literal in a body', () => {
    expect(
      (indexSource.match(/createDatabase\(/g) ?? []).length,
      'bodies must never build their own app Database',
    ).toBe(1);
    // الالتفاف الوحيد: buildStepApp يُستدعى بقيمة الإعلان المراجَعة، لا بقيمة حرفية في جسم الخطوة.
    expect(indexSource).toContain('buildStepApp(');
    expect(indexSource).toMatch(/stepAppDatabase\([^)]*coverage/);
    expect(indexSource, 'a step body must not pass its own coverage literal').not.toMatch(
      /stepAppDatabase\([^)]*'(?:NONE|INVALIDATES)'/,
    );
    expect(indexSource, 'every reviewed entry declares its coverage explicitly').not.toMatch(
      /coverage:\s*(?:undefined|null)/,
    );
  });
});

describe('reviewStep', () => {
  it('accepts a reviewed entry', () => {
    expect(() => reviewStep('step-a', { coverage: 'INVALIDATES', run: async () => undefined }))
      .not.toThrow();
    expect(() => reviewStep('step-b', { coverage: 'NONE', run: async () => undefined }))
      .not.toThrow();
  });

  it.each([
    ['null entry', null],
    ['a bare function instead of an entry', async () => undefined],
    ['a number', 7],
  ])('refuses %s before any statement', (_label, entry) => {
    expect(() => reviewStep('step-c', entry)).toThrow(
      'Migration data step step-c carries no reviewed coverage declaration; migration aborted',
    );
  });

  it('refuses an entry without a run function or with a missing or unknown coverage', () => {
    expect(() => reviewStep('step-d', { coverage: 'NONE' })).toThrow(
      'Migration data step step-d carries no reviewed coverage declaration; migration aborted',
    );
    expect(() => reviewStep('step-e', { run: async () => undefined })).toThrow(
      'Migration data step step-e carries no reviewed coverage declaration; migration aborted',
    );
    expect(() => reviewStep('step-f', { coverage: 'invalidates', run: async () => undefined }))
      .toThrow(
        'Migration data step step-f carries no reviewed coverage declaration; migration aborted',
      );
  });
});
