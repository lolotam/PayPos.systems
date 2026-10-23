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

// The Arabic text is built from code points, so this file holds no Arabic letters of its own.
const ARABIC = String.fromCharCode(0x0639, 0x0645, 0x0648, 0x0644, 0x0629);
const arabicLine = `export const label = '${ARABIC}';\n`;

const staticImport = (spec) =>
  `import { probe as engine } from '${spec}';\n\nexport const probe = engine;\n`;
const dynamicImport = (spec) => `export const probe = () => import('${spec}');\n`;
const requireCall = (spec) => `export const probe = require('${spec}');\n`;

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
};

// Only the two restriction rules answer the question; every other rule of the app is out of scope here.
async function restricted(eslint, filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(
    (message) =>
      message.ruleId === 'no-restricted-imports' || message.ruleId === 'no-restricted-syntax',
  );
}

const CASES = [
  // apps/api — the engine belongs to the commissions module alone.
  {
    label: 'api: another module use case may not import the engine root',
    at: 'api',
    file: ORDERS_UC,
    source: staticImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions use case may import the engine root',
    at: 'api',
    file: UC,
    source: staticImport(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions port may import the engine root',
    at: 'api',
    file: PORT,
    source: staticImport(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions persistence adapter may import the engine root',
    at: 'api',
    file: PERSIST,
    source: staticImport(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions domain file may not import the engine root',
    at: 'api',
    file: DOMAIN,
    source: staticImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions query may not import the engine root',
    at: 'api',
    file: QUERY,
    source: staticImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions controller may not import the engine root',
    at: 'api',
    file: HTTP,
    source: staticImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions event handler may not import the engine root',
    at: 'api',
    file: HANDLER,
    source: staticImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions job may not import the engine root',
    at: 'api',
    file: JOB,
    source: staticImport(ROOT),
    expect: E,
  },
  {
    label: 'api: the commissions module index may not import the engine root',
    at: 'api',
    file: ROOT_FILE,
    source: staticImport(ROOT),
    expect: E,
  },
  {
    label: 'api: app-level shared code may not import the engine root',
    at: 'api',
    file: SHARED,
    source: staticImport(ROOT),
    expect: E,
  },

  // apps/api — the same question through import() and require(), which no-restricted-imports does not see.
  {
    label: 'api: another module use case may not import the engine root dynamically',
    at: 'api',
    file: ORDERS_UC,
    source: dynamicImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions use case may import the engine root dynamically',
    at: 'api',
    file: UC,
    source: dynamicImport(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions port may import the engine root dynamically',
    at: 'api',
    file: PORT,
    source: dynamicImport(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions persistence adapter may import the engine root dynamically',
    at: 'api',
    file: PERSIST,
    source: dynamicImport(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions domain file may not import the engine root dynamically',
    at: 'api',
    file: DOMAIN,
    source: dynamicImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions query may not import the engine root dynamically',
    at: 'api',
    file: QUERY,
    source: dynamicImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions controller may not import the engine root dynamically',
    at: 'api',
    file: HTTP,
    source: dynamicImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions event handler may not import the engine root dynamically',
    at: 'api',
    file: HANDLER,
    source: dynamicImport(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions job may not import the engine root dynamically',
    at: 'api',
    file: JOB,
    source: dynamicImport(ROOT),
    expect: E,
  },
  {
    label: 'api: another module use case may not require the engine root',
    at: 'api',
    file: ORDERS_UC,
    source: requireCall(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions use case may require the engine root',
    at: 'api',
    file: UC,
    source: requireCall(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions port may require the engine root',
    at: 'api',
    file: PORT,
    source: requireCall(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions persistence adapter may require the engine root',
    at: 'api',
    file: PERSIST,
    source: requireCall(ROOT),
    expect: 'allowed',
  },
  {
    label: 'api: a commissions domain file may not require the engine root',
    at: 'api',
    file: DOMAIN,
    source: requireCall(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions query may not require the engine root',
    at: 'api',
    file: QUERY,
    source: requireCall(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions controller may not require the engine root',
    at: 'api',
    file: HTTP,
    source: requireCall(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions event handler may not require the engine root',
    at: 'api',
    file: HANDLER,
    source: requireCall(ROOT),
    expect: E,
  },
  {
    label: 'api: a commissions job may not require the engine root',
    at: 'api',
    file: JOB,
    source: requireCall(ROOT),
    expect: E,
  },

  // apps/api — no subpath of the engine is importable, not even /validation.
  {
    label: 'api: a commissions use case may not import the engine /validation',
    at: 'api',
    file: UC,
    source: staticImport(VALIDATION),
    expect: E,
  },
  {
    label: 'api: a commissions use case may not import the engine /validation dynamically',
    at: 'api',
    file: UC,
    source: dynamicImport(VALIDATION),
    expect: E,
  },
  {
    label: 'api: a commissions port may not import the engine /validation',
    at: 'api',
    file: PORT,
    source: staticImport(VALIDATION),
    expect: E,
  },
  {
    label: 'api: a commissions port may not import the engine /validation dynamically',
    at: 'api',
    file: PORT,
    source: dynamicImport(VALIDATION),
    expect: E,
  },
  {
    label: 'api: a commissions persistence adapter may not import the engine /validation',
    at: 'api',
    file: PERSIST,
    source: staticImport(VALIDATION),
    expect: E,
  },
  {
    label:
      'api: a commissions persistence adapter may not import the engine /validation dynamically',
    at: 'api',
    file: PERSIST,
    source: dynamicImport(VALIDATION),
    expect: E,
  },
  {
    label: 'api: a commissions use case may not import a deep path of the engine',
    at: 'api',
    file: UC,
    source: staticImport(DEEP),
    expect: E,
  },

  // apps/api — a relative path into the package skips the exports map, so it is refused everywhere.
  {
    label: 'api: another module use case may not reach the engine by a relative path',
    at: 'api',
    file: ORDERS_UC,
    source: staticImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: another module use case may not reach the engine by a relative path dynamically',
    at: 'api',
    file: ORDERS_UC,
    source: dynamicImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions use case may not reach the engine by a relative path',
    at: 'api',
    file: UC,
    source: staticImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions use case may not reach the engine by a relative path dynamically',
    at: 'api',
    file: UC,
    source: dynamicImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions port may not reach the engine by a relative path',
    at: 'api',
    file: PORT,
    source: staticImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions port may not reach the engine by a relative path dynamically',
    at: 'api',
    file: PORT,
    source: dynamicImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions persistence adapter may not reach the engine by a relative path',
    at: 'api',
    file: PERSIST,
    source: staticImport(API_PATH),
    expect: E,
  },
  {
    label:
      'api: a commissions persistence adapter may not reach the engine by a relative path dynamically',
    at: 'api',
    file: PERSIST,
    source: dynamicImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions domain file may not reach the engine by a relative path',
    at: 'api',
    file: DOMAIN,
    source: staticImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions domain file may not reach the engine by a relative path dynamically',
    at: 'api',
    file: DOMAIN,
    source: dynamicImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions query may not reach the engine by a relative path',
    at: 'api',
    file: QUERY,
    source: staticImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions query may not reach the engine by a relative path dynamically',
    at: 'api',
    file: QUERY,
    source: dynamicImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions controller may not reach the engine by a relative path',
    at: 'api',
    file: HTTP,
    source: staticImport(API_PATH),
    expect: E,
  },
  {
    label: 'api: a commissions controller may not reach the engine by a relative path dynamically',
    at: 'api',
    file: HTTP,
    source: dynamicImport(API_PATH),
    expect: E,
  },

  // apps/api — the engine exception never widens the use-cases/ infrastructure ban.
  {
    label: 'api: a commissions use case may not import @pospay/db',
    at: 'api',
    file: UC,
    source: staticImport('@pospay/db'),
    expect: 'CLAUDE.md §4.2',
  },
  {
    label: 'api: a commissions use case may not import node:fs',
    at: 'api',
    file: UC,
    source: staticImport('node:fs'),
    expect: 'CLAUDE.md §4.2',
  },

  // apps/api — a test of a commissions layer keeps the engine and the Arabic-text exemption.
  {
    label: 'api: a commissions use-case test may import the engine root and hold Arabic',
    at: 'api',
    file: `${M}/commissions/use-cases/probe/probe.spec.ts`,
    source: staticImport(ROOT) + arabicLine,
    expect: 'allowed',
  },
  {
    label: 'api: a commissions persistence test may import the engine root and hold Arabic',
    at: 'api',
    file: `${M}/commissions/persistence/__tests__/probe.spec.ts`,
    source: staticImport(ROOT) + arabicLine,
    expect: 'allowed',
  },
  {
    label: 'api: a commissions use case may not hold Arabic text of its own',
    at: 'api',
    file: UC,
    source: arabicLine,
    expect: 'packages/i18n',
  },

  // apps/api — the facade override of the composition root keeps the ban.
  {
    label: 'api: the composition root may not import the engine root',
    at: 'api',
    file: 'src/main.ts',
    source: staticImport(ROOT),
    expect: E,
  },

  // apps/worker — its facade override has no files, so the ban covers the whole app.
  {
    label: 'worker: another module use case may not import the engine root',
    at: 'worker',
    file: `${M}/orders/use-cases/probe/probe.ts`,
    source: staticImport(ROOT),
    expect: E,
  },

  // apps/admin — the builder area may import the browser-safe /validation entry point and nothing else.
  {
    label: 'admin: the commissions area may not import the engine root',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: staticImport(ROOT),
    expect: E,
  },
  {
    label: 'admin: the commissions area may not import the engine root dynamically',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: dynamicImport(ROOT),
    expect: E,
  },
  {
    label: 'admin: the commissions area may import the engine /validation',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: staticImport(VALIDATION),
    expect: 'allowed',
  },
  {
    label: 'admin: the commissions area may import the engine /validation dynamically',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: dynamicImport(VALIDATION),
    expect: 'allowed',
  },
  {
    label: 'admin: the commissions area may not import a deep path of the engine',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: staticImport(DEEP),
    expect: E,
  },
  {
    label: 'admin: the commissions area may not import a subpath below /validation',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: staticImport(`${ROOT}/validation/extra`),
    expect: E,
  },
  {
    label: 'admin: the commissions area may not import another engine subpath dynamically',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: dynamicImport(`${ROOT}/period`),
    expect: E,
  },
  {
    label: 'admin: the commissions area may not reach the engine by a relative path',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: staticImport(ADMIN_PATH),
    expect: E,
  },
  {
    label: 'admin: the commissions area may not reach the engine by a relative path dynamically',
    at: 'admin',
    file: 'src/commissions/probe.ts',
    source: dynamicImport(ADMIN_PATH),
    expect: E,
  },
  {
    label: 'admin: a commissions screen may import the engine /validation',
    at: 'admin',
    file: 'src/commissions/probe.tsx',
    source: staticImport(VALIDATION),
    expect: 'allowed',
  },
  {
    label: 'admin: src/orders may not import /validation',
    at: 'admin',
    file: 'src/orders/probe.ts',
    source: staticImport(VALIDATION),
    expect: E,
  },
  {
    label: 'admin: a commissions test may import /validation and hold Arabic',
    at: 'admin',
    file: 'src/commissions/probe.spec.ts',
    source: staticImport(VALIDATION) + arabicLine,
    expect: 'allowed',
  },

  // packages/ids — a sibling package reaches the engine only through its exports.
  {
    label: 'ids: a sibling package may not reach the engine by a relative path',
    at: 'ids',
    file: 'src/probe.ts',
    source: staticImport(SIBLING_PATH),
    expect: E,
  },
  {
    label: 'ids: a sibling package may not reach the engine by a relative path dynamically',
    at: 'ids',
    file: 'src/probe.ts',
    source: dynamicImport(SIBLING_PATH),
    expect: E,
  },
  {
    label: 'ids: a sibling package may not import the engine root',
    at: 'ids',
    file: 'src/probe.ts',
    source: staticImport(ROOT),
    expect: E,
  },

  // packages/commissions-engine — the engine itself is pure: @pospay/domain and its own files only.
  {
    label: 'engine: the package may not import node:fs',
    at: 'engine',
    file: 'src/probe.ts',
    source: staticImport('node:fs'),
    expect: E,
  },
  {
    label: 'engine: the package may import @pospay/domain',
    at: 'engine',
    file: 'src/probe.ts',
    source: staticImport('@pospay/domain'),
    expect: 'allowed',
  },
];

describe('the commissions engine import bans (ADR-0054 §1)', () => {
  for (const c of CASES) {
    it(c.label, async () => {
      const messages = await restricted(linters[c.at], c.file, c.source);
      if (c.expect === 'allowed') {
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
