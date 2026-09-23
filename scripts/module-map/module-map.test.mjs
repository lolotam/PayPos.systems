// node --test scripts/module-map — the module-map gate must block each violation it exists for (plan v4 T12b).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { checkModules, parseModuleMap, renderYaml } from './module-map.mjs';

const MAP = parseModuleMap(`## 6. Machine-readable source
\`\`\`yaml
imports:
  tenancy:  []
  identity: [tenancy]
packages_restricted:
  auth: [identity]
sync_writes:
  - identity -> tenancy.registerCompany @ apps/api/src/modules/identity/persistence/adapter.ts
reads: []
\`\`\``);

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'module-map-'));
  roots.push(root);
  const all = {
    'apps/api/src/modules/tenancy/index.ts': 'export const registerCompany = 1;\nexport type Company = {};\n',
    'apps/api/src/modules/tenancy/persistence/register.ts': 'export const x = 1;\n',
    'apps/api/src/modules/identity/persistence/adapter.ts':
      "import { registerCompany } from '../../tenancy/index.ts';\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('the module-map gate', () => {
  it('passes the declared shape: the one write from its one file, and type-only imports', () => {
    const root = repo({
      'apps/api/src/modules/identity/ports/company.ts':
        "import type { Company } from '../../tenancy/index.ts';\n",
    });
    assert.deepEqual(checkModules(root, MAP), []);
  });

  it('blocks a deep import into another module', () => {
    const root = repo({
      'apps/api/src/modules/identity/use-cases/x.ts':
        "import type { x } from '../../tenancy/persistence/register.ts';\n",
    });
    assert.match(checkModules(root, MAP).join('\n'), /deep import into tenancy/);
  });

  it('blocks an undeclared arrow', () => {
    const root = repo({
      'apps/api/src/modules/identity/index.ts': 'export type Id = string;\n',
      'apps/api/src/modules/tenancy/ports/who.ts': "import type { Id } from '../../identity/index.ts';\n",
    });
    assert.match(checkModules(root, MAP).join('\n'), /arrow tenancy -> identity is not declared/);
  });

  it('blocks a second synchronous write — the same symbol from another file, or another symbol', () => {
    const root = repo({
      'apps/api/src/modules/identity/use-cases/again.ts':
        "import { registerCompany } from '../../tenancy/index.ts';\n",
    });
    assert.match(checkModules(root, MAP).join('\n'), /value import tenancy.registerCompany is neither/);
  });

  it('blocks a restricted package outside its owners', () => {
    const root = repo({
      'apps/api/src/modules/tenancy/http/x.ts': "import { createAuth } from '@pospay/auth';\n",
    });
    assert.match(checkModules(root, MAP).join('\n'), /@pospay\/auth may be imported only by identity/);
  });

  it('blocks a cycle in the declared arrows', () => {
    const cyclic = { ...MAP, imports: { tenancy: ['identity'], identity: ['tenancy'] } };
    assert.match(checkModules(repo({}), cyclic).join('\n'), /import cycle/);
  });

  it('renders the YAML deterministically, whatever order the markdown lists modules in', () => {
    const reordered = { ...MAP, imports: { identity: ['tenancy'], tenancy: [] } };
    assert.equal(renderYaml(reordered), renderYaml(MAP));
  });
});
