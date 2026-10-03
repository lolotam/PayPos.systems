import {
  buildObjectKey,
  validateUpload,
  type ObjectStorage,
  type UploadPolicy,
} from '@pospay/storage';
import type { FileStorage } from '../ports/files.port.ts';

export function fileStorage(storage: ObjectStorage, policy: UploadPolicy): FileStorage {
  return {
    upload: async (actor, businessId, id, type, size) => {
      validateUpload(policy, type, size);
      const key = buildObjectKey(actor.companyId, businessId, id, 'staging');
      return { key, url: await storage.presignUpload(key, type, size) };
    },
    download: (key, type) => storage.presignDownload(key, type),
  };
}
