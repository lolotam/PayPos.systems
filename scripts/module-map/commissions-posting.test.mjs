// node --test "scripts/module-map/*.test.mjs" — the ADR-0054 §1 addendum import bans of packages/commissions-posting
// must actually block, each app judged by its own ESLint config: the correction step belongs to the commissions
// module's use-cases/, ports/ and persistence/ (plus its wiring file and module tests) alone, and the package itself
// is the one package besides those layers that may import the engine's root entry.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const POSTING = '@pospay/commissions-posting';
const ENGINE = '@pospay/commissions-engine';
const E = 'ADR-0054';
const ALLOWED = 'allowed';
const FACTORY = 'correction scope factory';

const staticImport = (spec) =>
  `import { probe as dep } from '${spec}';\n\nexport const probe = dep;\n`;
const dynamicImport = (spec) => `export const probe = () => import('${spec}');\n`;
const requireCall = (spec) => `export const probe = require('${spec}');\n`;
const typeImport = (spec) => `export type Probe = import('${spec}').Probe;\n`;
const FORMS = [
  ['import', staticImport],
  ['dynamic import', dynamicImport],
  ['require', requireCall],
  ['import type', typeImport],
];

const M = 'src/modules/commissions';
const ALLOWED_LAYERS = [
  [`${M}/use-cases/probe/probe.ts`, 'use case'],
  [`${M}/ports/probe.port.ts`, 'port'],
  [`${M}/persistence/probe.adapter.ts`, 'persistence adapter'],
  [`${M}/commissions.module.ts`, 'wiring file'],
  [`${M}/__tests__/probe.spec.ts`, 'module-level test'],
];
const REFUSED_LAYERS = [
  [`${M}/domain/probe.ts`, 'domain file'],
  [`${M}/queries/probe.query.ts`, 'query'],
  [`${M}/http/probe.controller.ts`, 'controller'],
  [`${M}/events/handlers/probe.handler.ts`, 'event handler'],
  [`${M}/jobs/probe.processor.ts`, 'job'],
  [`${M}/index.ts`, 'module index'],
  ['src/modules/orders/use-cases/probe/probe.ts', 'use case of another module'],
  ['src/shared/probe.ts', 'app-level shared file'],
];
const ENGINE_LIFTED_LAYERS = ALLOWED_LAYERS.slice(0, 3);
const ENGINE_REFUSED_LAYERS = [...REFUSED_LAYERS, ...ALLOWED_LAYERS.slice(3)];

const cwd = (path) => fileURLToPath(new URL(path, import.meta.url));
const linters = {
  api: new ESLint({ cwd: cwd('../../apps/api') }),
  worker: new ESLint({ cwd: cwd('../../apps/worker') }),
  admin: new ESLint({ cwd: cwd('../../apps/admin') }),
  ids: new ESLint({ cwd: cwd('../../packages/ids') }),
  posting: new ESLint({ cwd: cwd('../../packages/commissions-posting') }),
};

const RESTRICTIONS = [
  'no-restricted-imports',
  'no-restricted-syntax',
  'posting/own-files-only',
  'posting-domain/own-files-only',
  'posting-use-cases/own-files-only',
  'posting-ports/own-files-only',
  'posting-persistence/own-files-only',
  'engine/own-files-only',
  'no-restricted-globals',
];

async function restricted(eslint, filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => RESTRICTIONS.includes(message.ruleId));
}

const CASES = [];
const add = (at, file, source, expect, what) => {
  CASES.push({ label: `${at}: ${what}`, at, file, source, expect });
};

// The correction step's root: the commissions layers of both backend apps, in every import form.
for (const app of ['api', 'worker']) {
  for (const [formName, form] of FORMS) {
    for (const [file, layer] of ALLOWED_LAYERS) {
      // A use case may not load the root dynamically or by require(): that could take the scope factory (#1217).
      const useCaseLoadsAtRuntime =
        layer === 'use case' && ['dynamic import', 'require'].includes(formName);
      add(
        app,
        file,
        form(POSTING),
        useCaseLoadsAtRuntime ? FACTORY : ALLOWED,
        `a commissions ${layer} may${useCaseLoadsAtRuntime ? ' not' : ''} ${formName} the posting root`,
      );
    }
    for (const [file, layer] of REFUSED_LAYERS) {
      add(app, file, form(POSTING), E, `a ${layer} may not ${formName} the posting root`);
    }
  }
  // The posting root lifts nothing else: no subpath, no relative path, from any layer.
  for (const [file, layer] of ALLOWED_LAYERS) {
    for (const [formName, form] of FORMS) {
      add(
        app,
        file,
        form(`${POSTING}/dist/index.js`),
        E,
        `a ${layer} may not ${formName} a posting subpath`,
      );
      add(
        app,
        file,
        form('../../../../../../packages/commissions-posting/src/index.ts'),
        E,
        `a ${layer} may not ${formName} the posting package by a relative path`,
      );
    }
  }
}

// The wiring file and the module-level tests lift the posting root only: the engine root stays refused there.
for (const app of ['api', 'worker']) {
  for (const [formName, form] of FORMS) {
    for (const [file, layer] of ENGINE_LIFTED_LAYERS) {
      add(
        app,
        file,
        form(ENGINE),
        ALLOWED,
        `a commissions ${layer} may still ${formName} the engine root`,
      );
    }
    for (const [file, layer] of ENGINE_REFUSED_LAYERS) {
      add(app, file, form(ENGINE), E, `a ${layer} may not ${formName} the engine root`);
    }
  }
}

// Only the wiring file named in the ADR lifts the posting root: any other *.module.ts of a commissions module is refused.
for (const app of ['api', 'worker']) {
  for (const [formName, form] of FORMS) {
    add(
      app,
      `${M}/other.module.ts`,
      form(POSTING),
      E,
      `another module file may not ${formName} the posting root`,
    );
  }
}

// Nobody outside the backend commissions module imports the posting package.
for (const [formName, form] of FORMS) {
  add(
    'admin',
    'src/commissions/probe.ts',
    form(POSTING),
    E,
    `apps/admin may not ${formName} the posting root`,
  );
  add(
    'ids',
    'src/probe.ts',
    form(POSTING),
    E,
    `a sibling package may not ${formName} the posting root`,
  );
}
add(
  'ids',
  'src/probe.ts',
  staticImport('../../commissions-posting/src/index.ts'),
  E,
  'a sibling package may not reach the posting package by a relative path',
);
add(
  'ids',
  'src/probe.ts',
  dynamicImport('../../commissions-posting/src/index.ts'),
  E,
  'a sibling package may not reach the posting package by a relative path dynamically',
);
add(
  'ids',
  'src/probe.ts',
  staticImport(ENGINE),
  E,
  'a sibling package still may not import the engine root',
);

// The posting package itself: the one package that may import the engine root, from its use-cases/, ports/ and persistence/.
const P = 'src';
for (const [formName, form] of FORMS) {
  for (const layer of ['use-cases/probe/probe.ts', 'persistence/probe.adapter.ts']) {
    add(
      'posting',
      `${P}/${layer}`,
      form(ENGINE),
      ALLOWED,
      `${layer.split('/')[0]} may ${formName} the engine root`,
    );
  }
  // A port declares interfaces: the engine root is allowed as a type, never as a runtime value.
  add(
    'posting',
    `${P}/ports/probe.port.ts`,
    form(ENGINE),
    formName === 'import type' ? ALLOWED : 'ports/ may import only',
    `a port may ${formName === 'import type' ? '' : 'not '}${formName} the engine root`,
  );
  for (const layer of ['domain/probe.ts', 'index.ts']) {
    add(
      'posting',
      `${P}/${layer}`,
      form(ENGINE),
      E,
      `${layer.split('/')[0]} may not ${formName} the engine root`,
    );
  }
  add(
    'posting',
    `${P}/use-cases/probe/probe.ts`,
    form(`${ENGINE}/validation`),
    E,
    `a use case may not ${formName} an engine subpath`,
  );
  add(
    'posting',
    `${P}/persistence/probe.adapter.ts`,
    form(`${ENGINE}/validation`),
    E,
    `persistence may not ${formName} an engine subpath`,
  );
  add(
    'posting',
    `${P}/use-cases/probe/probe.ts`,
    form('../../../commissions-engine/src/index.ts'),
    E,
    `a use case may not ${formName} the engine by a relative path`,
  );
  add(
    'posting',
    `${P}/use-cases/probe/probe.ts`,
    form(POSTING),
    E,
    `the package may not ${formName} its own root`,
  );
}
// The package's domain/ is as bound as any module's: @pospay/domain and files inside domain/ only.
const DOMAIN_ONLY = 'domain/ may import only';
for (const [formName, form] of FORMS) {
  for (const [spec, what] of [
    ['@pospay/db', '@pospay/db'],
    ['drizzle-orm', 'drizzle-orm'],
    ['../persistence/commission-correction.scope.ts', 'persistence'],
    ['../ports/commission-correction.port.ts', 'a port'],
  ]) {
    add(
      'posting',
      `${P}/domain/probe.ts`,
      form(spec),
      DOMAIN_ONLY,
      `domain may not ${formName} ${what}`,
    );
  }
  for (const [spec, what] of [
    ['@pospay/domain', '@pospay/domain'],
    ['./commission-correction-step.ts', 'its own files'],
  ]) {
    add('posting', `${P}/domain/probe.ts`, form(spec), ALLOWED, `domain may ${formName} ${what}`);
  }
}
// A use case reaches its own domain/ and ports/, @pospay/domain and the engine: never persistence/, the database or the network.
const USE_CASE_ONLY = 'use-cases/ may import only';
const USE_CASE = `${P}/use-cases/probe/probe.ts`;
for (const [formName, form] of FORMS) {
  for (const [spec, what] of [
    ['../../persistence/commission-correction.scope.ts', 'persistence'],
    ['@pospay/db', '@pospay/db'],
    ['drizzle-orm', 'drizzle-orm'],
    ['@pospay/ids', '@pospay/ids'],
  ]) {
    add('posting', USE_CASE, form(spec), USE_CASE_ONLY, `a use case may not ${formName} ${what}`);
  }
  for (const [spec, what] of [
    ['../../domain/commission-correction-step.ts', 'its domain/'],
    ['../../ports/commission-correction.port.ts', 'its ports/'],
    ['./sibling.ts', 'a sibling file'],
    ['@pospay/domain', '@pospay/domain'],
  ]) {
    add('posting', USE_CASE, form(spec), ALLOWED, `a use case may ${formName} ${what}`);
  }
}
const NETWORK = 'reach the network only through a port';
const callFetch = (callee) => `export const probe = () => ${callee}('https://example.invalid');\n`;
add('posting', USE_CASE, callFetch('fetch'), NETWORK, 'a use case may not call the global fetch');
add(
  'posting',
  USE_CASE,
  callFetch('globalThis.fetch'),
  NETWORK,
  'a use case may not call globalThis.fetch',
);
add(
  'posting',
  `${P}/persistence/probe.adapter.ts`,
  callFetch('fetch'),
  ALLOWED,
  'the global fetch rule belongs to use-cases/ only',
);

// A port is an interface and types over its own domain/, @pospay/domain, @pospay/ids and the engine's types.
const PORT_ONLY = 'ports/ may import only';
const PORT = `${P}/ports/probe.port.ts`;
for (const [formName, form] of FORMS) {
  for (const [spec, what] of [
    ['@pospay/db', '@pospay/db'],
    ['drizzle-orm', 'drizzle-orm'],
    ['../persistence/commission-correction.scope.ts', 'persistence'],
    ['../use-cases/commission-month-recompute.ts', 'a use case'],
  ]) {
    add('posting', PORT, form(spec), PORT_ONLY, `a port may not ${formName} ${what}`);
  }
  // A port's own domain/ and sibling ports are types only, like the packages it names (#1217).
  for (const [spec, what] of [
    ['../domain/commission-correction-step.ts', 'its domain/'],
    ['./commission-correction.port.ts', 'a sibling port'],
  ]) {
    add(
      'posting',
      PORT,
      form(spec),
      formName === 'import type' ? ALLOWED : PORT_ONLY,
      `a port may ${formName === 'import type' ? '' : 'not '}${formName} ${what}`,
    );
  }
  // The three packages a port may name are types only: a value import (or a dynamic import, or require) is refused.
  for (const [spec, what] of [
    ['@pospay/domain', '@pospay/domain'],
    ['@pospay/ids', '@pospay/ids'],
    [ENGINE, 'the engine root'],
  ]) {
    add(
      'posting',
      PORT,
      form(spec),
      formName === 'import type' ? ALLOWED : PORT_ONLY,
      `a port may ${formName === 'import type' ? '' : 'not '}${formName} ${what}`,
    );
  }
}
for (const spec of ['@pospay/domain', '@pospay/ids', ENGINE]) {
  add(
    'posting',
    PORT,
    `import type { Probe } from '${spec}';
export type Again = Probe;
`,
    ALLOWED,
    `a port may use import type of ${spec}`,
  );
  add(
    'posting',
    PORT,
    `export type { Probe } from '${spec}';
`,
    ALLOWED,
    `a port may use export type from ${spec}`,
  );
  add(
    'posting',
    PORT,
    `import { value } from '${spec}';
export const probe = value;
`,
    PORT_ONLY,
    `a port may not import a value from ${spec}`,
  );
  add(
    'posting',
    PORT,
    `import { type Probe } from '${spec}';
export type Again = Probe;
`,
    PORT_ONLY,
    `a port may not use an inline type-only import from ${spec} (it still emits an import)`,
  );
  add(
    'posting',
    PORT,
    `export { value } from '${spec}';
`,
    PORT_ONLY,
    `a port may not re-export a value from ${spec}`,
  );
  add(
    'posting',
    PORT,
    `export * from '${spec}';
`,
    PORT_ONLY,
    `a port may not export * from ${spec}`,
  );
  add(
    'posting',
    PORT,
    `import '${spec}';
`,
    PORT_ONLY,
    `a port may not import ${spec} for its side effect`,
  );
}
// persistence/ implements the ports over the database: its own domain/ and ports/, the database, Drizzle and the kernel; never a use case.
const PERSISTENCE_ONLY = 'persistence/ may import only';
const PERSISTENCE = `${P}/persistence/probe.adapter.ts`;
for (const [formName, form] of FORMS) {
  for (const [spec, what] of [
    ['../use-cases/commission-month-recompute.ts', 'a use case'],
    [
      '../use-cases/post-commission-corrections/post-commission-corrections.ts',
      'a nested use case',
    ],
    ['@pospay/auth', 'another package'],
  ]) {
    add(
      'posting',
      PERSISTENCE,
      form(spec),
      PERSISTENCE_ONLY,
      `persistence may not ${formName} ${what}`,
    );
  }
  for (const [spec, what] of [
    ['../domain/commission-correction-step.ts', 'its domain/'],
    ['../ports/commission-correction.port.ts', 'its ports/'],
    ['./commission-correction.scope.ts', 'a sibling adapter'],
    ['@pospay/db', '@pospay/db'],
    ['drizzle-orm', 'drizzle-orm'],
    ['@pospay/domain', '@pospay/domain'],
    ['@pospay/ids', '@pospay/ids'],
  ]) {
    add('posting', PERSISTENCE, form(spec), ALLOWED, `persistence may ${formName} ${what}`);
  }
}
add(
  'posting',
  `${P}/persistence/probe.adapter.ts`,
  staticImport('drizzle-orm'),
  ALLOWED,
  'persistence may import drizzle-orm',
);
add(
  'posting',
  `${P}/persistence/probe.adapter.ts`,
  staticImport('@pospay/db'),
  ALLOWED,
  'persistence may import @pospay/db',
);
add(
  'posting',
  `${P}/domain/probe.ts`,
  staticImport('@pospay/domain'),
  ALLOWED,
  'domain may import @pospay/domain',
);
add(
  'posting',
  `${P}/use-cases/probe/probe.ts`,
  staticImport('drizzle-orm'),
  'use-cases/',
  'a use case may not import drizzle-orm',
);
add(
  'posting',
  `${P}/use-cases/probe/probe.ts`,
  staticImport('@pospay/db'),
  'use-cases/',
  'a use case may not import @pospay/db',
);
add(
  'posting',
  `${P}/use-cases/probe/probe.ts`,
  staticImport('node:fs'),
  'use-cases/',
  'a use case may not import node:fs',
);
add(
  'posting',
  `${P}/ports/probe.port.ts`,
  staticImport('@pospay/auth'),
  'packages/commissions-posting may import only',
  'the package may not import another package',
);
add(
  'posting',
  `${P}/persistence/probe.adapter.ts`,
  dynamicImport('@pospay/auth'),
  'packages/commissions-posting may import only',
  'the package may not import another package dynamically',
);
add(
  'posting',
  `${P}/persistence/probe.adapter.ts`,
  staticImport('../../../db/src/index.ts'),
  'packages/commissions-posting may import only',
  'the package may not leave its folder by a relative path',
);
add(
  'posting',
  `${P}/persistence/probe.adapter.ts`,
  staticImport('./commission-correction.scope.ts'),
  ALLOWED,
  'the package may import its own files',
);

// The scope factory belongs to the module wiring and persistence/: an app's use case may not import it (#1217).
const FACTORY_NAME = 'createCommissionCorrectionScope';
const FACTORY_FORMS = [
  [
    'import',
    `import { ${FACTORY_NAME} } from '${POSTING}';
export const probe = ${FACTORY_NAME};
`,
  ],
  [
    'aliased import',
    `import { ${FACTORY_NAME} as make } from '${POSTING}';
export const probe = make;
`,
  ],
  [
    'namespace import',
    `import * as posting from '${POSTING}';
export const probe = posting;
`,
  ],
  [
    'import type',
    `import type { ${FACTORY_NAME} } from '${POSTING}';
export type Probe = typeof ${FACTORY_NAME};
`,
  ],
  [
    're-export',
    `export { ${FACTORY_NAME} } from '${POSTING}';
`,
  ],
  ['dynamic import', dynamicImport(POSTING)],
  ['require', requireCall(POSTING)],
  [
    'import-equals',
    `import posting = require('${POSTING}');
export const probe = posting;
`,
  ],
];
for (const app of ['api', 'worker']) {
  const useCase = `${M}/use-cases/probe/probe.ts`;
  for (const [formName, source] of FACTORY_FORMS) {
    add(app, useCase, source, FACTORY, `a use case may not take the scope factory by ${formName}`);
    add(
      app,
      `${M}/use-cases/__tests__/probe.spec.ts`,
      source,
      FACTORY,
      `a use-case test may not take the scope factory by ${formName}`,
    );
  }
  // The same root stays importable by name for the step: only the factory is refused.
  add(
    app,
    useCase,
    `import { postCommissionCorrections } from '${POSTING}';
export const probe = postCommissionCorrections;
`,
    ALLOWED,
    'a use case may import the step by name',
  );
  add(
    app,
    useCase,
    `import type { CommissionCorrectionScope } from '${POSTING}';
export type Probe = CommissionCorrectionScope;
`,
    ALLOWED,
    'a use case may import the scope type by name',
  );
  // The wiring file, persistence adapters and the module's tests construct the scope.
  for (const [file, layer] of [
    [`${M}/commissions.module.ts`, 'the module wiring'],
    [`${M}/persistence/probe.adapter.ts`, 'a persistence adapter'],
    [`${M}/__tests__/probe.spec.ts`, 'a module-level test'],
  ]) {
    add(app, file, FACTORY_FORMS[0][1], ALLOWED, `${layer} may import the scope factory`);
  }
}

// `import x = require()` is its own node: every layer allowlist of the package refuses it (#1217).
for (const [layer, file] of [
  ['the package at large', `${P}/probe.ts`],
  ['domain', `${P}/domain/probe.ts`],
  ['ports', `${P}/ports/probe.port.ts`],
  ['use-cases', `${P}/use-cases/probe/probe.ts`],
  ['persistence', `${P}/persistence/probe.adapter.ts`],
]) {
  add(
    'posting',
    file,
    "import dep = require('@pospay/auth');\nexport const probe = dep;\n",
    'may import only',
    `${layer} may not import another package by import-equals`,
  );
}
add(
  'posting',
  `${P}/domain/probe.ts`,
  "import dep = require('./commission-correction-step.ts');\nexport const probe = dep;\n",
  ALLOWED,
  'domain may import its own file by import-equals',
);
add(
  'posting',
  `${P}/ports/probe.port.ts`,
  "import dep = require('../domain/commission-correction-step.ts');\nexport const probe = dep;\n",
  'ports/ may import only',
  'a port may not import its own domain by import-equals (a runtime import)',
);

// Files the lint config does not reach cannot carry a layer rule: the package holds .ts files only.
it('keeps every source file of the posting package a .ts file the layer rules reach', () => {
  const root = fileURLToPath(new URL('../../packages/commissions-posting/src', import.meta.url));
  const stray = readdirSync(root, { recursive: true }).filter(
    (name) =>
      /\.(mts|cts|mjs|cjs|js|jsx|tsx)$/.test(String(name)) &&
      !String(name).includes('node_modules'),
  );
  assert.deepEqual(stray, []);
});

describe('the commissions posting package import bans (ADR-0054 §1 addendum)', () => {
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
