// node --test "scripts/module-map/*.test.mjs" — the module-map gate must block each violation it exists for
// (plan v4 T12b), including the ways around a naive import scan.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { checkModules, parseModuleMap, renderYaml } from './module-map.mjs';

const ADAPTER = 'apps/api/src/modules/identity/persistence/adapter.ts';
const MAP = parseModuleMap(`## 6. Machine-readable source
\`\`\`yaml
imports:
  tenancy:  []
  identity: [tenancy]
packages_restricted:
  auth: [identity]
sync_writes:
  - identity -> tenancy.registerCompany @ ${ADAPTER}
reads: []
\`\`\``);

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    module: 'nodenext',
    moduleResolution: 'nodenext',
    allowImportingTsExtensions: true,
    noEmit: true,
    paths: { '#tenancy': ['./src/modules/tenancy/index.ts'] },
  },
});

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'module-map-'));
  roots.push(root);
  const all = {
    'apps/api/package.json': '{"name":"@pospay/api","dependencies":{}}',
    'apps/api/tsconfig.json': TSCONFIG,
    'apps/api/src/app.ts': "import { registerCompany } from './modules/tenancy/index.ts';\nvoid registerCompany;\n",
    'apps/api/src/modules/tenancy/index.ts':
      "export { registerCompany } from './persistence/register.ts';\nexport type Company = {};\n",
    'apps/api/src/modules/tenancy/persistence/register.ts': 'export const registerCompany = () => 1;\n',
    'apps/api/src/modules/identity/index.ts': 'export type Id = string;\n',
    [ADAPTER]: "import { registerCompany } from '../../tenancy/index.ts';\nexport const adapter = () => registerCompany();\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const problems = (files) => checkModules(repo(files), MAP).join('\n');

describe('the module-map gate — what passes', () => {
  it('the declared write from its one file, type-only imports, a .js specifier, and the composition root', () => {
    assert.equal(
      problems({
        'apps/api/src/modules/identity/ports/company.ts':
          "import type { Company } from '../../tenancy/index.js';\nexport type C = Company;\n",
      }),
      '',
    );
  });

  it('the write used in an erased type, and an unrelated local that shadows its name', () => {
    assert.equal(
      problems({
        [ADAPTER]: [
          "import { registerCompany } from '../../tenancy/index.ts';",
          'export type Result = ReturnType<typeof registerCompany>;',
          'export const adapter = () => registerCompany();',
          'export const unrelated = (registerCompany: number) => registerCompany + 1;',
          'export function block() { const registerCompany = 2; return registerCompany; }',
          'export function loop() { for (const registerCompany of [1]) { return registerCompany; } return 0; }',
          'export function caught() { try { return 1; } catch (registerCompany) { return registerCompany; } }',
          'export class Plain { run() { return registerCompany(); } }',
          '',
        ].join('\n'),
      }),
      '',
    );
  });
});

describe('the module-map gate — what it blocks', () => {
  const cases = {
    'a deep import into another module': [
      { 'apps/api/src/modules/identity/use-cases/x.ts': "import type { registerCompany } from '../../tenancy/persistence/register.ts';\n" },
      /deep import into tenancy/,
    ],
    'an undeclared arrow': [
      { 'apps/api/src/modules/tenancy/ports/who.ts': "import type { Id } from '../../identity/index.ts';\n" },
      /arrow tenancy -> identity is not declared/,
    ],
    'a second synchronous write from another file': [
      { 'apps/api/src/modules/identity/use-cases/again.ts': "import { registerCompany } from '../../tenancy/index.ts';\nvoid registerCompany;\n" },
      /value import tenancy.registerCompany \(import\) is neither/,
    ],
    'a value import hidden after an unrelated `export type` line': [
      { 'apps/api/src/modules/identity/use-cases/hidden.ts': "export type Marker = string;\nimport { registerCompany } from '../../tenancy/index.ts';\nvoid registerCompany;\n" },
      /value import tenancy.registerCompany/,
    ],
    'a dynamic import': [
      { 'apps/api/src/modules/identity/use-cases/dyn.ts': "export const load = () => import('../../tenancy/index.ts');\n" },
      /value import tenancy.\* \(dynamic\)/,
    ],
    'a side-effect import': [
      { 'apps/api/src/modules/identity/use-cases/side.ts': "import '../../tenancy/index.ts';\n" },
      /value import tenancy.\* \(side-effect\)/,
    ],
    'an import through a path alias': [
      { 'apps/api/src/modules/identity/use-cases/alias.ts': "import { registerCompany } from '#tenancy';\nvoid registerCompany;\n" },
      /value import tenancy.registerCompany/,
    ],
    'forwarding the write from the allowed file': [
      { [ADAPTER]: "import { registerCompany } from '../../tenancy/index.ts';\nexport { registerCompany };\n" },
      /registerCompany came from another module and may only be called here/,
    ],
    'forwarding the write through a local alias': [
      { [ADAPTER]: "import { registerCompany } from '../../tenancy/index.ts';\nconst forwarded = registerCompany;\nexport { forwarded };\n" },
      /registerCompany came from another module and may only be called here/,
    ],
    'passing the write on inside an object': [
      { [ADAPTER]: "import { registerCompany } from '../../tenancy/index.ts';\nexport const box = { registerCompany };\n" },
      /registerCompany came from another module/,
    ],
    "passing the write into a class's extends expression, which runs": [
      {
        [ADAPTER]: [
          "import { registerCompany } from '../../tenancy/index.ts';",
          'const capture = (f: unknown) => class { static f = f; };',
          'export class Bridge extends capture(registerCompany) {}',
          '',
        ].join(String.fromCharCode(10)),
      },
      /registerCompany came from another module and may only be called here/,
    ],
    'a dynamic import with a computed specifier': [
      { 'apps/api/src/modules/identity/use-cases/computed.ts': "const target = '../../tenancy/index.ts';\nexport const load = () => import(target);\n" },
      /dynamic import with a computed specifier/,
    ],
    'an empty import, which still runs the module': [
      { 'apps/api/src/modules/identity/use-cases/empty.ts': "import {} from '../../tenancy/index.ts';\n" },
      /value import tenancy\.\* \(import\)/,
    ],
    'an inline type-only import, which verbatimModuleSyntax keeps': [
      { 'apps/api/src/modules/identity/use-cases/inline.ts': "import { type Company } from '../../tenancy/index.ts';\nexport type C = Company;\n" },
      /value import tenancy\.\* \(import\)/,
    ],
    'forwarding through the composition root': [
      {
        'apps/api/src/registry.ts': "export { registerCompany } from './modules/tenancy/index.ts';\n",
        'apps/api/src/shared/registry.ts': "export { registerCompany } from '../registry.ts';\n",
        'apps/api/src/modules/identity/use-cases/root.ts': "import { registerCompany } from '../../../shared/registry.ts';\nregisterCompany();\n",
      },
      /shared\/registry\.ts: imports the composition root/,
    ],
    're-exporting another module': [
      { [ADAPTER]: "export { registerCompany } from '../../tenancy/index.ts';\n" },
      /re-exports tenancy/,
    ],
    'an app-level bridge into a module': [
      {
        'apps/api/src/shared/bridge.ts': "export { registerCompany } from '../modules/tenancy/index.ts';\n",
        'apps/api/src/modules/identity/use-cases/via-bridge.ts': "import { registerCompany } from '../../../shared/bridge.ts';\nvoid registerCompany;\n",
      },
      /only the composition root may import a module/,
    ],
    'a restricted package outside its owners': [
      { 'apps/api/src/modules/tenancy/http/x.ts': "import { createAuth } from '@pospay/auth';\nvoid createAuth;\n" },
      /@pospay\/auth may be imported only by identity/,
    ],
    'a file cycle inside one module': [
      {
        'apps/api/src/modules/tenancy/domain/a.ts': "import { b } from './b.ts';\nexport const a = () => b;\n",
        'apps/api/src/modules/tenancy/domain/b.ts': "import { a } from './a.ts';\nexport const b = () => a;\n",
      },
      /file cycle: .*domain\/a\.ts/,
    ],
    'a package cycle': [
      {
        'packages/one/package.json': '{"name":"@pospay/one","dependencies":{"@pospay/two":"workspace:*"}}',
        'packages/one/src/index.ts': 'export {};\n',
        'packages/two/package.json': '{"name":"@pospay/two","dependencies":{"@pospay/one":"workspace:*"}}',
        'packages/two/src/index.ts': 'export {};\n',
      },
      /package cycle/,
    ],
  };
  for (const [label, [files, expected]] of Object.entries(cases)) {
    it(label, () => assert.match(problems(files), expected));
  }

  it('a cycle in the declared arrows', () => {
    const cyclic = { ...MAP, imports: { tenancy: ['identity'], identity: ['tenancy'] } };
    assert.match(checkModules(repo({}), cyclic).join('\n'), /module cycle/);
  });
});

describe('the generated YAML', () => {
  it('is deterministic whatever order the markdown lists modules in', () => {
    const reordered = { ...MAP, imports: { identity: ['tenancy'], tenancy: [] } };
    assert.equal(renderYaml(reordered), renderYaml(MAP));
  });

  it('refuses a §6 line it cannot read instead of skipping it', () => {
    assert.throws(
      () => parseModuleMap('## 6. Machine-readable source\n```yaml\nimports:\n  tenancy: tenancy\n```'),
      /cannot read line/,
    );
  });
});
