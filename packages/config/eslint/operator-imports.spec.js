import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

import config, { allowDatabaseFacade } from './index.js';

const message = 'operator helpers are for apps/api/scripts only (PP-58.3, ADR-0003 addendum)';
const eslint = new ESLint({
  cwd: resolve(import.meta.dirname, '../../..'),
  overrideConfigFile: true,
  overrideConfig: [
    ...config,
    {
      files: ['apps/api/scripts/staging-staff-user.ts'],
      ...allowDatabaseFacade([], { operator: true }),
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
  [
    'the auth subpath',
    "import { readStagingStaffIdentity } from '@pospay/auth/operator/staging-staff';",
  ],
];

for (const [label, code] of cases) {
  it(`refuses ${label} outside the operator CLI`, async () => {
    const [result] = await eslint.lintText(code, {
      filePath: 'apps/api/src/modules/identity/probe.ts',
    });
    assert.ok(result.messages.some((entry) => entry.message.includes(message)));
  });
  it(`allows ${label} in the operator CLI`, async () => {
    const [result] = await eslint.lintText(code, {
      filePath: 'apps/api/scripts/staging-staff-user.ts',
    });
    assert.ok(!result.messages.some((entry) => entry.message.includes(message)));
  });
}
