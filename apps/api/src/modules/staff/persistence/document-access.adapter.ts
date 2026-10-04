import type { Tx } from '@pospay/db';
import { lockDocumentAccess, readDocumentAccess } from '../../identity/index.ts';
import { businessTimeZone } from '../../tenancy/index.ts';
import { documentToday } from '../domain/employee-documents.ts';
import type { DocumentClock } from '../ports/document-types.port.ts';

export const documentAccessLock = (tx: Tx, companyId: string) => lockDocumentAccess(tx, companyId);
export const documentAccess = (
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string | null,
) => readDocumentAccess(tx, companyId, userId, businessId);
export async function documentTimeZone(tx: Tx, companyId: string, businessId: string) {
  return (await businessTimeZone(tx, companyId, businessId)) ?? 'Asia/Kuwait';
}

export function createEmployeeDocumentReadAccess(clock: DocumentClock) {
  return {
    check: async (tx: Tx, companyId: string, userId: string, businessId: string) => {
      const access = await documentAccess(tx, companyId, userId, businessId);
      if (!access.read) return { read: false, manage: false, featureEnabled: false, today: '' };
      const today = documentToday(clock.now(), await documentTimeZone(tx, companyId, businessId));
      return {
        read: true,
        manage: access.manage,
        featureEnabled: access.featureEnabled,
        today,
      };
    },
  };
}
