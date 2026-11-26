// node --test "scripts/module-map/*.test.mjs" — #1000: the commissions jobs reach the database
// through persistence/ only, so a runtime import of @pospay/db inside jobs/ is refused while the
// types of the same module stay importable.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const cwd = (path) => fileURLToPath(new URL(path, import.meta.url));
const linter = new ESLint({ cwd: cwd('../../apps/worker') });
const JOB = 'src/modules/commissions/jobs/probe.processor.ts';

async function restricted(source) {
  const [result] = await linter.lintText(source, { filePath: JOB });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
}

describe('the runtime database import ban of the commissions jobs (#1000)', () => {
  it('refuses a runtime import of @pospay/db inside a commissions job', async () => {
    const messages = await restricted(
      "import { assertReplayBounds } from '@pospay/db';\nexport const probe = assertReplayBounds;\n",
    );

    assert.ok(messages.length > 0, JSON.stringify(messages));
  });

  it('allows the types of @pospay/db inside a commissions job', async () => {
    const messages = await restricted(
      "import type { Tx } from '@pospay/db';\nexport type Probe = Tx;\n",
    );

    assert.deepEqual(messages, []);
  });
});
