import { uploadStaffFile } from './upload-staff-file';

/** يرفع المصنف بنفس مسار المستندات الموقّع وينتظر READY. */
export function uploadImportFile(options: {
  companyId: string;
  businessId: string;
  file: File;
  wait?: (ms: number) => Promise<void>;
}): Promise<string> {
  return uploadStaffFile({
    ...options,
    ownerEntityId: options.businessId,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
