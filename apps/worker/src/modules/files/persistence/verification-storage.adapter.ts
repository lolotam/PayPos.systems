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
    inspect: async (file) => {
      try {
        const max = validateUpload(policy, file.type, file.size);
        const bytes = await storage.read(file.stagingKey, max);
        const inspected = await inspectContent(bytes, { type: file.type, size: file.size }, policy);
        return { bytes: inspected.bytes, type: inspected.type, size: inspected.bytes.byteLength };
      } catch (error) {
        if (error instanceof FileValidationError) throw new VerificationRejected(error.code);
        throw error;
      }
    },
    candidateKey: (companyId, businessId, candidateId) =>
      buildObjectKey(companyId, businessId, candidateId, 'verified'),
    write: (key, content) => storage.put(key, content.bytes, content.type),
  };
}
