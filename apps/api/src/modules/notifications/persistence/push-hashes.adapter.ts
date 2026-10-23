import { endpointHash, installationHash } from '@pospay/notifications';

import type { PushHashes } from '../ports/push-hashes.port.ts';

/**
 * @returns adapter الهاشات، والدالة البحتة نفسها في packages/notifications
 */
export function createPushHashes(): PushHashes {
  return {
    installationHash: (companyId, installationId) =>
      installationHash(companyId, installationId).toString('hex'),
    endpointHash: (endpoint) => endpointHash(endpoint).toString('hex'),
  };
}
