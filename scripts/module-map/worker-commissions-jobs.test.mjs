// node --test "scripts/module-map/*.test.mjs" — #1000 and #1334: the commissions jobs reach the database
// through persistence/ only, so a runtime import of @pospay/db inside jobs/ is refused in every form —
// the static import, import(), require() and `import x = require()` — while the types of the same module
// stay importable.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const cwd = (path) => fileURLToPath(new URL(path, import.meta.url));
const linter = new ESLint({ cwd: cwd('../../apps/worker') });
const JOB = 'src/modules/commissions/jobs/probe.processor.ts';

async function messages(source) {
  const [result] = await linter.lintText(source, { filePath: JOB });
  return result.messages;
}

async function restricted(source, ruleId) {
  return (await messages(source)).filter((message) => message.ruleId === ruleId);
}

describe('the runtime database import ban of the commissions jobs (#1000)', () => {
  it('refuses a runtime import of @pospay/db inside a commissions job', async () => {
    const found = await restricted(
      "import { assertReplayBounds } from '@pospay/db';\nexport const probe = assertReplayBounds;\n",
      'no-restricted-imports',
    );

    assert.ok(found.length > 0, JSON.stringify(found));
  });

  it('allows the types of @pospay/db inside a commissions job', async () => {
    const found = await restricted(
      "import type { Tx } from '@pospay/db';\nexport type Probe = Tx;\n",
      'no-restricted-imports',
    );

    assert.deepEqual(found, []);
  });
});

// #1334 — the static import was the only refused form; the dynamic ones slipped through the import rule.
describe('the runtime database import ban of the commissions jobs: the dynamic forms (#1334)', () => {
  const refused = [
    ['a dynamic import of the module', "export const probe = await import('@pospay/db');\n"],
    ['a dynamic import of a subpath', "export const probe = await import('@pospay/db/schema');\n"],
    ['a require call of the module', "const probe = require('@pospay/db');\nexport { probe };\n"],
    [
      'a require call of a subpath',
      "const probe = require('@pospay/db/schema');\nexport { probe };\n",
    ],
    [
      'an import equals of the module',
      "import probe = require('@pospay/db');\nexport { probe };\n",
    ],
  ];

  for (const [label, source] of refused) {
    it(`refuses ${label} inside a commissions job`, async () => {
      const found = await restricted(source, 'no-restricted-syntax');

      assert.ok(found.length > 0, JSON.stringify(await messages(source)));
    });
  }

  const allowed = [
    [
      'the import type of the module',
      "import type { Tx } from '@pospay/db';\nexport type Probe = Tx;\n",
    ],
    ['a type reference of the module', "export type Probe = import('@pospay/db').Tx;\n"],
  ];

  for (const [label, source] of allowed) {
    it(`allows ${label} inside a commissions job`, async () => {
      const found = await restricted(source, 'no-restricted-syntax');

      assert.deepEqual(found, []);
    });
  }
});
