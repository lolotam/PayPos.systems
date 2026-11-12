import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '@pospay/contracts';
import { expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const apiSource = join(repoRoot, 'apps/api/src');
const declaration = join(apiSource, 'modules/staff/events/published.ts');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return sourceFiles(path);
    }
    if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) return [];
    if (/\.(?:spec|test)\.[jt]sx?$/.test(entry.name)) return [];
    return [path];
  });
}

// 68-2c deletes this scan when the producer lands (plan E10).
it('keeps the requested event and report table out of API producers before 68-2c', () => {
  const offenders = sourceFiles(apiSource).filter((path) => {
    if (path === declaration) return false;
    const source = readFileSync(path, 'utf8');
    return source.includes('LeaveHistoryReportRequested') || source.includes('leave_history_reports');
  });
  expect(offenders.map((path) => relative(apiSource, path))).toEqual([]);
});

it('has no leave-history report route in the generated OpenAPI document', () => {
  const document = buildOpenApiDocument() as { paths?: Record<string, unknown> };
  expect(Object.keys(document.paths ?? {}).filter((path) => path.includes('/leave-history/reports'))).toEqual([]);
});
