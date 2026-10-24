import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

import config, { allowCommissionsEngineBackend, allowDatabaseFacade } from './index.js';

const message = 'operator helpers are for apps/api/scripts only (PP-58.3, ADR-0003 addendum)';
const eslint = new ESLint({
  cwd: resolve(import.meta.dirname, '../../..'),
  overrideConfigFile: true,
  overrideConfig: [
    ...config,
    // apps/api/eslint.config.js composes the commissions override after the shared config; the commissions
    // use-case probe needs the same order to see it.
    ...allowCommissionsEngineBackend(),
    {
      files: ['apps/api/scripts/staging-staff-user.ts'],
      ...allowDatabaseFacade([], { operator: true }),
    },
    // packages/auth/eslint.config.js, with its paths taken from the repository root.
    {
      files: ['packages/auth/**/*.ts'],
      ...allowDatabaseFacade(['createAuthDatabase', 'createStaffOtpDatabase'], {
        credentials: true,
      }),
    },
    {
      files: ['packages/auth/src/operator/staging-staff-identity.ts'],
      ...allowDatabaseFacade(['createAuthDatabase'], { credentials: true, operator: true }),
    },
  ],
});
const cases = [
  [
    'a named import',
    "import { ensureStaffBranchMembership } from '@pospay/db/operator/staging-staff';",
  ],
  ['a namespace import', "import * as staging from '@pospay/db/operator/staging-staff';"],
  ['a re-export', "export { ensureEmployeeUserLink } from '@pospay/db/operator/staging-staff';"],
  ['a dynamic import', "import('@pospay/db/operator/staging-staff');"],
  ['a require call', "require('@pospay/db/operator/staging-staff');"],
  ['an import type', "type T = import('@pospay/db/operator/staging-staff').StagingStaffRefusal;"],
  [
    'the auth subpath',
    "import { readStagingStaffIdentity } from '@pospay/auth/operator/staging-staff';",
  ],
];
// Every place that must refuse the operator subpaths: the plain module folder and the two use-cases/
// overrides, each of which replaces no-restricted-imports and has to compose the ban back in.
const outside = [
  ['outside the operator CLI', 'apps/api/src/modules/identity/probe.ts'],
  ['in a use-case', 'apps/api/src/modules/identity/use-cases/probe/probe.ts'],
  ['in a commissions use-case', 'apps/api/src/modules/commissions/use-cases/probe/probe.ts'],
];

for (const [label, code] of cases) {
  for (const [where, filePath] of outside) {
    it(`refuses ${label} ${where}`, async () => {
      const [result] = await eslint.lintText(code, { filePath });
      assert.ok(result.messages.some((entry) => entry.message.includes(message)));
    });
  }
  it(`allows ${label} in the operator CLI`, async () => {
    const [result] = await eslint.lintText(code, {
      filePath: 'apps/api/scripts/staging-staff-user.ts',
    });
    assert.ok(!result.messages.some((entry) => entry.message.includes(message)));
    assert.equal(result.fatalErrorCount, 0);
  });
}

it('allows the operator subpath in the one auth file that owns it', async () => {
  const [result] = await eslint.lintText(
    "import { readStagingStaffIdentityRows } from '@pospay/db/operator/staging-staff';",
    { filePath: 'packages/auth/src/operator/staging-staff-identity.ts' },
  );
  assert.ok(!result.messages.some((entry) => entry.message.includes(message)));
  assert.equal(result.fatalErrorCount, 0);
});

it('refuses the operator subpath in the rest of packages/auth', async () => {
  const [result] = await eslint.lintText(
    "import { readStagingStaffIdentityRows } from '@pospay/db/operator/staging-staff';",
    { filePath: 'packages/auth/src/config.ts' },
  );
  assert.ok(result.messages.some((entry) => entry.message.includes(message)));
});
