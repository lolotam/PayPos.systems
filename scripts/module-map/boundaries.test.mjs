// node --test scripts/module-map — the layer rules (eslint-plugin-boundaries) must actually block, with the API's own
// ESLint config. They were once silently inert (globs rooted at apps/ matched nothing); this keeps them honest.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('../../apps/api', import.meta.url));

function lint(filename, source) {
  const result = spawnSync('pnpm', ['exec', 'eslint', '--stdin', '--stdin-filename', filename], {
    cwd: api,
    input: source,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('the boundaries gate', () => {
  it('blocks http/ importing domain/ directly', () => {
    const result = lint(
      'src/modules/identity/http/probe.ts',
      "import { evaluateAccess } from '../domain/access.ts';\n\nexport const probe = evaluateAccess;\n",
    );
    assert.notEqual(result.status, 0);
    assert.match(result.output, /boundaries\/dependencies/);
  });

  it('blocks a deep import of another module', () => {
    const result = lint(
      'src/modules/tenancy/http/probe.ts',
      "import { createAccessReader } from '../../identity/persistence/access-reader.ts';\n\nexport const probe = createAccessReader;\n",
    );
    assert.notEqual(result.status, 0);
    assert.match(result.output, /boundaries\//);
  });

  it('lets http/ import its own use-cases/', () => {
    const result = lint(
      'src/modules/identity/http/probe.ts',
      "import { CheckFeature } from '../use-cases/check-feature/check-feature.ts';\n\nexport const probe = CheckFeature;\n",
    );
    assert.equal(result.status, 0, result.output);
  });
});
