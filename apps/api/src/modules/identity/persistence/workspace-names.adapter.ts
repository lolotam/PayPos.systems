import type { Tx } from '@pospay/db';

import { describeWorkspaces } from '../../tenancy/index.ts';

// The only file that calls tenancy.describeWorkspaces (module-map.md §6 reads).
export function createWorkspaceNames() {
  return {
    describe: (tx: Tx, scopes: Parameters<typeof describeWorkspaces>[1]) =>
      describeWorkspaces(tx, scopes),
  };
}
