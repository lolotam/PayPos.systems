// node --test "scripts/module-map/*.test.mjs" — #765 (T-6): compare the imports of the 14 ADR-0054 §4.1 files
// against the exhaustive allowlist without modifying general lint rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ADR_PATH = join(
  ROOT,
  'docs/adr/0054-commissions-engine-package-recovery-flags-and-read-path.md',
);
const MODULE_PREFIX = 'apps/api/src/modules/commissions/';

const BASE_PACKAGE_RULES = {
  ports: new Map([
    ['@pospay/domain', { typeOnly: false }],
    ['@pospay/commissions-engine', { typeOnly: false }],
  ]),
  'use-cases': new Map([
    ['@pospay/domain', { typeOnly: false }],
    ['@pospay/commissions-engine', { typeOnly: false }],
    ['@pospay/contracts', { typeOnly: true }],
  ]),
  queries: new Map([
    ['@pospay/db', { typeOnly: false }],
    ['@pospay/contracts', { typeOnly: false }],
  ]),
  persistence: new Map([
    ['@pospay/db', { typeOnly: false }],
    ['@pospay/commissions-engine', { typeOnly: false }],
    ['drizzle-orm', { typeOnly: false }],
  ]),
  http: new Map([
    ['@pospay/contracts', { typeOnly: false }],
    ['@nestjs/common', { typeOnly: false }],
    ['fastify', { typeOnly: true }],
  ]),
};

function parseAdrScopedTable(markdown) {
  const section = /### 4\.1[\s\S]*?\| File \| Additional permitted import \|[\r\n]+\| --- \| --- \|([\s\S]*?)\r?\n\r?\n/.exec(
    markdown,
  );
  assert.ok(section, 'ADR-0054 §4.1 table not found');
  const rows = [];
  for (const line of section[1].trim().split(/\r?\n/)) {
    const match = /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|$/.exec(line.trim());
    assert.ok(match, `Unparseable ADR-0054 §4.1 row: ${line}`);
    const [, file, spec] = match;
    const fromMatch = /^(.*?\bfrom\s+`([^`]+)`)([\s\S]*)$/.exec(spec);
    assert.ok(fromMatch, `Missing "from \`pkg\`" in ADR-0054 §4.1 row for ${file}: ${spec}`);
    const [, beforeFrom, pkg, afterFrom] = fromMatch;
    const names = [...beforeFrom.slice(0, beforeFrom.lastIndexOf(' from ')).matchAll(/`([^`]+)`/g)].map(
      (m) => m[1],
    );
    assert.ok(names.length > 0, `No permitted symbols listed in ADR-0054 §4.1 row for ${file}`);
    rows.push({
      file,
      pkg,
      names: new Set(names),
      typeOnly: /\btype-only\b/.test(afterFrom),
    });
  }
  return rows;
}

function layerOf(file) {
  const layer = file.split('/')[0];
  assert.ok(layer in BASE_PACKAGE_RULES, `Unexpected layer in ${file}`);
  return layer;
}

function collectPackageImports(filePath, sourceText) {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const refs = [];
  const push = (specifier, name, isTypeOnly, isDynamic = false) => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      refs.push({ specifier, name, isTypeOnly, isDynamic });
    }
  };
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (!clause) push(spec, '*side-effect*', false);
      else {
        const clauseType = Boolean(clause.isTypeOnly);
        if (clause.name) push(spec, 'default', clauseType);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) push(spec, '*', clauseType);
        else if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            push(spec, (el.propertyName ?? el.name).text, clauseType || el.isTypeOnly);
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) push(spec, '*', node.isTypeOnly);
      else {
        for (const el of node.exportClause.elements) {
          push(spec, (el.propertyName ?? el.name).text, node.isTypeOnly || el.isTypeOnly);
        }
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      push(ts.isStringLiteral(expr) ? expr.text : '*computed*', '*', Boolean(node.isTypeOnly), true);
    } else if (ts.isImportTypeNode(node)) {
      const lit = ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) ? node.argument.literal.text : '*computed*';
      const name = node.qualifier && ts.isIdentifier(node.qualifier) ? node.qualifier.text : '*';
      push(lit, name, true);
    } else if (ts.isCallExpression(node)) {
      const isDynImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isReq = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynImport || isReq) {
        const arg = node.arguments[0];
        push(arg && ts.isStringLiteral(arg) ? arg.text : '*computed*', '*', false, true);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return refs;
}

export function validateAdrScopedImports(file, sourceText, rule) {
  const errors = [];
  const layer = layerOf(file);
  const baseRules = BASE_PACKAGE_RULES[layer];
  const refs = collectPackageImports(file, sourceText);
  const seenScopedNames = new Set();

  for (const ref of refs) {
    const scopedMatch = ref.specifier === rule.pkg;
    if (scopedMatch) {
      if (ref.isDynamic || ref.name === '*' || ref.name === 'default' || ref.name === '*side-effect*') {
        errors.push(`${file}: scoped import ${ref.specifier} (${ref.name}) must use explicit named imports`);
        continue;
      }
      if (rule.names.has(ref.name)) {
        seenScopedNames.add(ref.name);
        if (rule.typeOnly && !ref.isTypeOnly) {
          errors.push(`${file}: ${ref.name} from ${rule.pkg} must be type-only per ADR-0054 §4.1`);
        }
        continue;
      }
    }
    const basePkg = baseRules.get(ref.specifier);
    if (basePkg !== undefined) {
      if (basePkg.typeOnly && !ref.isTypeOnly) {
        errors.push(`${file}: base import ${ref.name} from ${ref.specifier} in ${layer}/ must be type-only`);
      }
      continue;
    }
    errors.push(`${file}: unlisted import ${ref.name} from ${ref.specifier} outside ADR-0054 §4.1 (${[...rule.names].join(', ')} from ${rule.pkg})`);
  }

  for (const expectedName of rule.names) {
    if (!seenScopedNames.has(expectedName)) {
      errors.push(`${file}: missing documented ADR-0054 §4.1 import ${expectedName} from ${rule.pkg}`);
    }
  }
  return errors;
}

describe('ADR-0054 §4.1 exact scoped-import inventory (#765)', () => {
  const rows = parseAdrScopedTable(readFileSync(ADR_PATH, 'utf8'));

  it('lists all 14 documented ADR-0054 §4.1 files and matches their exact imports', () => {
    assert.equal(rows.length, 14);
    for (const row of rows) {
      const sourceText = readFileSync(join(ROOT, MODULE_PREFIX, row.file), 'utf8');
      assert.deepEqual(validateAdrScopedImports(row.file, sourceText, row), []);
    }
  });

  it('rejects value imports when ADR-0054 §4.1 requires type-only', () => {
    const portRow = rows.find((r) => r.file === 'ports/business-calendar.port.ts');
    const httpRow = rows.find((r) => r.file === 'http/commission-plan-versions.controller.ts');
    const dtoRow = rows.find((r) => r.file === 'ports/commission-plan-version-transactions.port.ts');
    assert.match(validateAdrScopedImports(portRow.file, "import { Tx } from '@pospay/db';\n", portRow).join('\n'), /must be type-only/);
    assert.match(validateAdrScopedImports(httpRow.file, "import { TenantWrappers } from '@pospay/db';\n", httpRow).join('\n'), /must be type-only/);
    assert.match(
      validateAdrScopedImports(
        dtoRow.file,
        "import { CommissionPlanVersion, type CreateCommissionPlanVersionInput } from '@pospay/contracts';\n",
        dtoRow,
      ).join('\n'),
      /must be type-only/,
    );
  });

  it('rejects unlisted symbols, unlisted packages, and dynamic/namespace forms', () => {
    const i18nRow = rows.find((r) => r.file === 'use-cases/lock-through-decision.ts');
    const zodRow = rows.find((r) => r.file === 'queries/commission-service-override-cursor.ts');
    const writerRow = rows.find((r) => r.file === 'persistence/commission-plan-version-writer.ts');
    const portRow = rows.find((r) => r.file === 'ports/employee-row-lock.port.ts');
    assert.match(validateAdrScopedImports(i18nRow.file, "import { localDate, formatMoney } from '@pospay/i18n';\n", i18nRow).join('\n'), /unlisted import formatMoney/);
    assert.match(validateAdrScopedImports(zodRow.file, "import { z, ZodError } from 'zod';\n", zodRow).join('\n'), /unlisted import ZodError/);
    assert.match(validateAdrScopedImports(writerRow.file, "import { commissionPlanVersion, commissionServiceOverride, type CommissionPlanVersion } from '@pospay/contracts';\n", writerRow).join('\n'), /unlisted import commissionServiceOverride/);
    assert.match(validateAdrScopedImports(portRow.file, "import type { Tx } from '@pospay/db';\nimport 'node:fs';\n", portRow).join('\n'), /unlisted import \*side-effect\* from node:fs/);
    assert.match(validateAdrScopedImports(i18nRow.file, "import { localDate } from '@pospay/i18n';\nexport const d = () => import('@pospay/db');\n", i18nRow).join('\n'), /unlisted import/);
    assert.match(validateAdrScopedImports(zodRow.file, "const zMod = require('zod');\nexport { zMod };\n", zodRow).join('\n'), /explicit named imports/);
  });
});
