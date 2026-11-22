// node --test "scripts/module-map/*.test.mjs" — the ADR-0054 §1 addendum import bans of packages/commissions-posting
// must actually block, each app judged by its own ESLint config: the correction step belongs to the commissions
// module's use-cases/, ports/ and persistence/ (plus its wiring file and module tests) alone, and the package itself
// is the one package besides those layers that may import the engine's root entry.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const POSTING = '@pospay/commissions-posting';
const ENGINE = '@pospay/commissions-engine';
const E = 'ADR-0054';
const ALLOWED = 'allowed';

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
  'engine/own-files-only',
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
      add(
        app,
        file,
        form(POSTING),
        ALLOWED,
        `a commissions ${layer} may ${formName} the posting root`,
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
  for (const layer of [
    'use-cases/probe/probe.ts',
    'ports/probe.port.ts',
    'persistence/probe.adapter.ts',
  ]) {
    add(
      'posting',
      `${P}/${layer}`,
      form(ENGINE),
      ALLOWED,
      `${layer.split('/')[0]} may ${formName} the engine root`,
    );
  }
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
add(
  'posting',
  `${P}/persistence/probe.adapter.ts`,
  staticImport('@pospay/ids'),
  ALLOWED,
  'persistence may import @pospay/ids',
);
add(
  'posting',
  `${P}/ports/probe.port.ts`,
  staticImport('@pospay/ids'),
  ALLOWED,
  'a port may import @pospay/ids',
);
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
