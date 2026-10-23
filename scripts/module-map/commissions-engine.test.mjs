// node --test "scripts/module-map/*.test.mjs" — the ADR-0054 §1(b) import bans of packages/commissions-engine
// must actually block, each app judged by its own ESLint config: the engine belongs to the commissions module
// alone, and the admin builder may import only its browser-safe /validation entry point (issue #526).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const ROOT = '@pospay/commissions-engine';
const VALIDATION = `${ROOT}/validation`;
const DEEP = `${ROOT}/dist/period-commission.js`;
const E = 'ADR-0054';
const ALLOWED = 'allowed';

// The Arabic text is built from code points, so this file holds no Arabic letters of its own.
const ARABIC = String.fromCharCode(0x0639, 0x0645, 0x0648, 0x0644, 0x0629);
const arabicLine = `export const label = '${ARABIC}';\n`;

const staticImport = (spec) =>
  `import { probe as engine } from '${spec}';\n\nexport const probe = engine;\n`;
const dynamicImport = (spec) => `export const probe = () => import('${spec}');\n`;
const requireCall = (spec) => `export const probe = require('${spec}');\n`;
const typeImport = (spec) => `export type Probe = import('${spec}').CommissionPlan;\n`;

const M = 'src/modules';
const ORDERS_UC = `${M}/orders/use-cases/probe/probe.ts`;
const UC = `${M}/commissions/use-cases/probe/probe.ts`;
const PORT = `${M}/commissions/ports/probe.port.ts`;
const PERSIST = `${M}/commissions/persistence/probe.adapter.ts`;
const DOMAIN = `${M}/commissions/domain/probe.ts`;
const QUERY = `${M}/commissions/queries/probe.query.ts`;
const HTTP = `${M}/commissions/http/probe.controller.ts`;
const HANDLER = `${M}/commissions/events/handlers/probe.handler.ts`;
const JOB = `${M}/commissions/jobs/probe.processor.ts`;
const ROOT_FILE = `${M}/commissions/index.ts`;
const SHARED = 'src/shared/probe.ts';
const UC_SPEC = `${M}/commissions/use-cases/probe/probe.spec.ts`;
const PERSIST_SPEC = `${M}/commissions/persistence/__tests__/probe.spec.ts`;
const PERSIST_TEST = `${M}/commissions/persistence/test/probe-fixture.ts`;
const PERSIST_HELPER = `${M}/commissions/persistence/__tests__/probe-fixture.ts`;
const UC_HELPER = `${M}/commissions/use-cases/__tests__/probe-fixture.ts`;
const ADMIN_UC = 'src/modules/commissions/use-cases/probe.ts';
const IDS_UC = 'src/modules/commissions/use-cases/probe.ts';
const WORKER_UC = 'src/modules/commissions/use-cases/probe/probe.ts';

const API_PATH = '../../../../../../packages/commissions-engine/src/index.ts';
const ADMIN_PATH = '../../../../packages/commissions-engine/src/validation.ts';
const SIBLING_PATH = '../../commissions-engine/src/index.ts';

const linters = {
  api: new ESLint({ cwd: fileURLToPath(new URL('../../apps/api', import.meta.url)) }),
  admin: new ESLint({ cwd: fileURLToPath(new URL('../../apps/admin', import.meta.url)) }),
  worker: new ESLint({ cwd: fileURLToPath(new URL('../../apps/worker', import.meta.url)) }),
  ids: new ESLint({ cwd: fileURLToPath(new URL('../../packages/ids', import.meta.url)) }),
  engine: new ESLint({
    cwd: fileURLToPath(new URL('../../packages/commissions-engine', import.meta.url)),
  }),
  domain: new ESLint({ cwd: fileURLToPath(new URL('../../packages/domain', import.meta.url)) }),
};

// Only the restriction rules answer the question; every other rule of the app is out of scope here.
const RESTRICTIONS = [
  'no-restricted-imports',
  'no-restricted-syntax',
  'engine/own-files-only',
  'kernel/own-files-only',
];

async function restricted(eslint, filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => RESTRICTIONS.includes(message.ruleId));
}

// One case per row: the app, the file, the source, the expectation and what the case checks.
const CASES = [];
const add = (at, file, source, expect, what) => {
  CASES.push({ label: `${at}: ${what}`, at, file, source, expect });
};

// apps/api — the engine belongs to the commissions module alone.
for (const [file, expect, what] of [
  [ORDERS_UC, E, 'another module use case may not import the engine root'],
  [UC, ALLOWED, 'a commissions use case may import the engine root'],
  [PORT, ALLOWED, 'a commissions port may import the engine root'],
  [PERSIST, ALLOWED, 'a commissions persistence adapter may import the engine root'],
  [DOMAIN, E, 'a commissions domain file may not import the engine root'],
  [QUERY, E, 'a commissions query may not import the engine root'],
  [HTTP, E, 'a commissions controller may not import the engine root'],
  [HANDLER, E, 'a commissions event handler may not import the engine root'],
  [JOB, E, 'a commissions job may not import the engine root'],
  [ROOT_FILE, E, 'the commissions module index may not import the engine root'],
  [SHARED, E, 'app-level shared code may not import the engine root'],
]) {
  add('api', file, staticImport(ROOT), expect, what);
}

// apps/api — the same question through import() and require(), which no-restricted-imports does not see.
for (const [file, expect, what] of [
  [ORDERS_UC, E, 'another module use case may not import the engine root dynamically'],
  [UC, ALLOWED, 'a commissions use case may import the engine root dynamically'],
  [PORT, ALLOWED, 'a commissions port may import the engine root dynamically'],
  [PERSIST, ALLOWED, 'a commissions persistence adapter may import the engine root dynamically'],
  [DOMAIN, E, 'a commissions domain file may not import the engine root dynamically'],
  [QUERY, E, 'a commissions query may not import the engine root dynamically'],
  [HTTP, E, 'a commissions controller may not import the engine root dynamically'],
  [HANDLER, E, 'a commissions event handler may not import the engine root dynamically'],
  [JOB, E, 'a commissions job may not import the engine root dynamically'],
]) {
  add('api', file, dynamicImport(ROOT), expect, what);
}
for (const [file, expect, what] of [
  [ORDERS_UC, E, 'another module use case may not require the engine root'],
  [UC, ALLOWED, 'a commissions use case may require the engine root'],
  [PORT, ALLOWED, 'a commissions port may require the engine root'],
  [PERSIST, ALLOWED, 'a commissions persistence adapter may require the engine root'],
  [DOMAIN, E, 'a commissions domain file may not require the engine root'],
  [QUERY, E, 'a commissions query may not require the engine root'],
  [HTTP, E, 'a commissions controller may not require the engine root'],
  [HANDLER, E, 'a commissions event handler may not require the engine root'],
  [JOB, E, 'a commissions job may not require the engine root'],
]) {
  add('api', file, requireCall(ROOT), expect, what);
}

// apps/api — an import type is a dependency too, and no rule of the import bans may miss it.
for (const [file, expect, what] of [
  [ORDERS_UC, E, 'another module use case may not import the engine root as an import type'],
  [UC, ALLOWED, 'a commissions use case may import the engine root as an import type'],
  [DOMAIN, E, 'a commissions domain file may not import the engine root as an import type'],
]) {
  add('api', file, typeImport(ROOT), expect, what);
}
add(
  'api',
  UC,
  typeImport(VALIDATION),
  E,
  'a commissions use case may not import the engine /validation as an import type',
);
add(
  'api',
  ORDERS_UC,
  typeImport(API_PATH),
  E,
  'another module use case may not reach the engine by a relative path as an import type',
);

// apps/api — no subpath of the engine is importable, not even /validation.
for (const [file, expect, what] of [
  [UC, E, 'a commissions use case may not import the engine /validation'],
  [PORT, E, 'a commissions port may not import the engine /validation'],
  [PERSIST, E, 'a commissions persistence adapter may not import the engine /validation'],
]) {
  add('api', file, staticImport(VALIDATION), expect, what);
}
for (const [file, expect, what] of [
  [UC, E, 'a commissions use case may not import the engine /validation dynamically'],
  [PORT, E, 'a commissions port may not import the engine /validation dynamically'],
  [
    PERSIST,
    E,
    'a commissions persistence adapter may not import the engine /validation dynamically',
  ],
]) {
  add('api', file, dynamicImport(VALIDATION), expect, what);
}
add(
  'api',
  UC,
  staticImport(DEEP),
  E,
  'a commissions use case may not import a deep path of the engine',
);

// apps/api — a relative path into the package skips the exports map, so it is refused everywhere.
for (const [file, expect, what] of [
  [ORDERS_UC, E, 'another module use case may not reach the engine by a relative path'],
  [UC, E, 'a commissions use case may not reach the engine by a relative path'],
  [PORT, E, 'a commissions port may not reach the engine by a relative path'],
  [PERSIST, E, 'a commissions persistence adapter may not reach the engine by a relative path'],
  [DOMAIN, E, 'a commissions domain file may not reach the engine by a relative path'],
  [QUERY, E, 'a commissions query may not reach the engine by a relative path'],
  [HTTP, E, 'a commissions controller may not reach the engine by a relative path'],
]) {
  add('api', file, staticImport(API_PATH), expect, what);
}
for (const [file, expect, what] of [
  [ORDERS_UC, E, 'another module use case may not reach the engine by a relative path dynamically'],
  [UC, E, 'a commissions use case may not reach the engine by a relative path dynamically'],
  [PORT, E, 'a commissions port may not reach the engine by a relative path dynamically'],
  [
    PERSIST,
    E,
    'a commissions persistence adapter may not reach the engine by a relative path dynamically',
  ],
  [DOMAIN, E, 'a commissions domain file may not reach the engine by a relative path dynamically'],
  [QUERY, E, 'a commissions query may not reach the engine by a relative path dynamically'],
  [HTTP, E, 'a commissions controller may not reach the engine by a relative path dynamically'],
]) {
  add('api', file, dynamicImport(API_PATH), expect, what);
}

// apps/api — the engine exception never widens the use-cases/ infrastructure ban.
add(
  'api',
  UC,
  staticImport('@pospay/db'),
  'CLAUDE.md §4.2',
  'a commissions use case may not import @pospay/db',
);
add(
  'api',
  UC,
  staticImport('node:fs'),
  'CLAUDE.md §4.2',
  'a commissions use case may not import node:fs',
);

// apps/api — a test of a commissions layer keeps the engine and the Arabic-text exemption.
add(
  'api',
  UC_SPEC,
  staticImport(ROOT) + arabicLine,
  ALLOWED,
  'a commissions use-case test may import the engine root and hold Arabic',
);
add(
  'api',
  PERSIST_SPEC,
  staticImport(ROOT) + arabicLine,
  ALLOWED,
  'a commissions persistence test may import the engine root and hold Arabic',
);
add(
  'api',
  PERSIST_TEST,
  staticImport(ROOT) + arabicLine,
  ALLOWED,
  'a commissions persistence fixture under a test folder may import the engine root and hold Arabic',
);
add(
  'api',
  PERSIST_HELPER,
  staticImport(ROOT) + arabicLine,
  ALLOWED,
  'a commissions persistence helper in __tests__ may import the engine root and hold Arabic',
);
add(
  'api',
  UC_HELPER,
  staticImport(ROOT) + arabicLine,
  ALLOWED,
  'a commissions use-case helper in __tests__ may import the engine root and hold Arabic',
);
add(
  'api',
  UC,
  arabicLine,
  'packages/i18n',
  'a commissions use case may not hold Arabic text of its own',
);

// apps/api — the facade override of the composition root keeps the ban.
add(
  'api',
  'src/main.ts',
  staticImport(ROOT),
  E,
  'the composition root may not import the engine root',
);

// apps/worker — the file-less facade override keeps the ban; the exception comes only with 50-1.
for (const [file, expect, what] of [
  [
    `${M}/orders/use-cases/probe/probe.ts`,
    E,
    'another module use case may not import the engine root',
  ],
  [WORKER_UC, E, 'a commissions use case may not import the engine root yet'],
]) {
  add('worker', file, staticImport(ROOT), expect, what);
}

// apps/admin — the builder area may import the browser-safe /validation entry point and nothing else.
add(
  'admin',
  'src/commissions/probe.ts',
  staticImport(ROOT),
  E,
  'the commissions area may not import the engine root',
);
add(
  'admin',
  'src/commissions/probe.ts',
  dynamicImport(ROOT),
  E,
  'the commissions area may not import the engine root dynamically',
);
for (const [file, expect, what] of [
  ['src/commissions/probe.ts', ALLOWED, 'the commissions area may import the engine /validation'],
  ['src/commissions/probe.tsx', ALLOWED, 'a commissions screen may import the engine /validation'],
  ['src/orders/probe.ts', E, 'src/orders may not import /validation'],
]) {
  add('admin', file, staticImport(VALIDATION), expect, what);
}
add(
  'admin',
  'src/commissions/probe.ts',
  dynamicImport(VALIDATION),
  ALLOWED,
  'the commissions area may import the engine /validation dynamically',
);
add(
  'admin',
  'src/commissions/probe.ts',
  staticImport(DEEP),
  E,
  'the commissions area may not import a deep path of the engine',
);
add(
  'admin',
  'src/commissions/probe.ts',
  staticImport(`${ROOT}/validation/extra`),
  E,
  'the commissions area may not import a subpath below /validation',
);
add(
  'admin',
  'src/commissions/probe.ts',
  dynamicImport(`${ROOT}/period`),
  E,
  'the commissions area may not import another engine subpath dynamically',
);
add(
  'admin',
  'src/commissions/probe.ts',
  staticImport(ADMIN_PATH),
  E,
  'the commissions area may not reach the engine by a relative path',
);
add(
  'admin',
  'src/commissions/probe.ts',
  dynamicImport(ADMIN_PATH),
  E,
  'the commissions area may not reach the engine by a relative path dynamically',
);
add(
  'admin',
  'src/commissions/probe.spec.ts',
  staticImport(VALIDATION) + arabicLine,
  ALLOWED,
  'a commissions test may import /validation and hold Arabic',
);
add(
  'admin',
  ADMIN_UC,
  staticImport(ROOT),
  E,
  'a commissions use case may not import the engine root',
);
add(
  'admin',
  'src/commissions/probe.ts',
  typeImport(ROOT),
  E,
  'the commissions area may not import the engine root as an import type',
);
add(
  'admin',
  'src/commissions/probe.ts',
  typeImport(VALIDATION),
  ALLOWED,
  'the commissions area may import the engine /validation as an import type',
);

// packages/ids — a sibling package reaches the engine only through its exports.
add(
  'ids',
  'src/probe.ts',
  staticImport(SIBLING_PATH),
  E,
  'a sibling package may not reach the engine by a relative path',
);
add(
  'ids',
  'src/probe.ts',
  dynamicImport(SIBLING_PATH),
  E,
  'a sibling package may not reach the engine by a relative path dynamically',
);
add(
  'ids',
  'src/probe.ts',
  staticImport(ROOT),
  E,
  'a sibling package may not import the engine root',
);
add('ids', IDS_UC, staticImport(ROOT), E, 'a commissions use case may not import the engine root');

// packages/commissions-engine — the engine itself is pure: @pospay/domain and its own files only.
add('engine', 'src/probe.ts', staticImport('node:fs'), E, 'the package may not import node:fs');
add(
  'engine',
  'src/probe.ts',
  dynamicImport('node:fs'),
  E,
  'the package may not import node:fs dynamically',
);
add('engine', 'src/probe.ts', requireCall('node:fs'), E, 'the package may not require node:fs');
add(
  'engine',
  'src/probe.ts',
  staticImport('@pospay/domain'),
  ALLOWED,
  'the package may import @pospay/domain',
);
add(
  'engine',
  'src/probe.ts',
  staticImport('../../db/src/index.ts'),
  E,
  'the package may not leave its own folder by a relative path',
);
add(
  'engine',
  'src/probe.ts',
  staticImport('./plan-types.ts'),
  ALLOWED,
  'the package may import its own files',
);
add(
  'engine',
  'src/probe.ts',
  typeImport('node:fs'),
  E,
  'the package may not import node:fs as an import type',
);
add(
  'engine',
  'src/probe.ts',
  typeImport('../../db/src/index.ts'),
  E,
  'the package may not leave its own folder by a relative path as an import type',
);
add(
  'engine',
  'src/probe.ts',
  typeImport('@pospay/domain'),
  ALLOWED,
  'the package may import @pospay/domain as an import type',
);

// packages/domain — the kernel has zero dependencies, its own files only.
add(
  'domain',
  'src/probe.ts',
  staticImport('@pospay/ids'),
  'zero dependencies',
  'the kernel may not import a package',
);
add(
  'domain',
  'src/probe.ts',
  staticImport('./money.ts'),
  ALLOWED,
  'the kernel may import its own files',
);
add(
  'domain',
  'src/probe.ts',
  typeImport('@pospay/ids'),
  'zero dependencies',
  'the kernel may not import a package as an import type',
);

describe('the commissions engine import bans (ADR-0054 §1)', () => {
  for (const c of CASES) {
    it(c.label, async () => {
      const messages = await restricted(linters[c.at], c.file, c.source);
      if (c.expect === ALLOWED) {
        assert.equal(messages.length, 0, `${c.file}: ${JSON.stringify(messages)}`);
        return;
      }
      assert.ok(
        messages.some((message) => message.message.includes(c.expect)),
        `${c.file}: expected a message containing "${c.expect}", got ${JSON.stringify(messages)}`,
      );
    });
  }
});
