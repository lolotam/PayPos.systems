import { businessPermissionHolders } from '../../identity/index.ts';
import type { FileReaderRecipients } from '../ports/file-reader-recipients.port.ts';

/** صلاحية قراءة ملفات النشاط: جرس انتهاء المستند يوصل لأصحابها بس (spec 033 MO-Q1، OD-Q3). */
const FILES_READ = 'read:files:business';

export const fileReaderRecipientsAdapter: FileReaderRecipients = {
  holders: (tx, companyId, businessId, at) =>
    businessPermissionHolders(tx, companyId, businessId, FILES_READ, at),
};
