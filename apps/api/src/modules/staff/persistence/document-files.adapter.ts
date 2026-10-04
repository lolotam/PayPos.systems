import type { Tx } from '@pospay/db';
import { documentFileFacts } from '../../files/index.ts';
import type { DocumentFileFacts } from '../domain/employee-documents.ts';

export const readDocumentFile = (
  tx: Tx,
  companyId: string,
  fileId: string,
): Promise<DocumentFileFacts | null> => documentFileFacts(tx, companyId, fileId);
