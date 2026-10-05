import { uploadStaffFile, type UploadPhase } from './upload-staff-file';
export type { UploadPhase } from './upload-staff-file';

export function uploadDocumentFile(options: {
  companyId: string;
  businessId: string;
  employeeId: string;
  file: File;
  onPhase: (phase: UploadPhase) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<string> {
  return uploadStaffFile({
    ...options,
    ownerEntityId: options.employeeId,
    contentType: options.file.type as 'application/pdf' | 'image/jpeg' | 'image/png',
  });
}
