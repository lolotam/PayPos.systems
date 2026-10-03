import {
  buildObjectKey,
  inspectContent,
  FileValidationError,
  validateUpload,
  type ObjectStorage,
  type UploadPolicy,
} from '@pospay/storage';
import { VerificationRejected } from '../domain/verification.ts';
import type { VerificationStorage } from '../ports/verification.port.ts';

export function verificationStorage(
  storage: ObjectStorage,
  policy: UploadPolicy,
): VerificationStorage {
  return {
    verify: async (companyId, file, candidateId) => {
      try {
        const max = validateUpload(policy, file.type, file.size);
        const bytes = await storage.read(file.stagingKey, max);
        const inspected = await inspectContent(bytes, { type: file.type, size: file.size }, policy);
        const key = buildObjectKey(companyId, file.businessId, candidateId, 'verified');
        await storage.put(key, inspected.bytes, inspected.type);
        return { key, type: inspected.type, size: inspected.bytes.byteLength };
      } catch (error) {
        if (error instanceof FileValidationError) throw new VerificationRejected(error.code);
        throw error;
      }
    },
    removeStaging: (key) => storage.remove(key),
  };
}
