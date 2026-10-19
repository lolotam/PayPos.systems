import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { documentFileFacts, type DocumentFileFacts } from '../../files/index.ts';
import { LogoFileRejected } from '../domain/errors.ts';
import { validateLogoFile, type LogoFileFacts } from '../domain/logo-file.ts';
import type { LockedBusinessLogo, LogoFileReader } from '../ports/logo-file.port.ts';
import { lockBusinessLogoReference } from './logo-reference.ts';

type IdentityRow = {
  official_name_ar: string | null;
  official_name_en: string | null;
  logo_file_id: string | null;
};

function toLogoFacts(row: DocumentFileFacts): LogoFileFacts {
  return {
    businessId: row.business_id.toLowerCase(),
    branchId: row.branch_id?.toLowerCase() ?? null,
    ownerModule: row.owner_module,
    ownerEntityId: row.owner_entity_id.toLowerCase(),
    requiredPermission: row.required_permission,
    createdBy: row.created_by.toLowerCase(),
    contentType: row.content_type,
    status: row.status,
    purged: row.purged,
    purgeStarted: row.purge_started,
  };
}

const NO_LOGO: LockedBusinessLogo = {
  officialNameAr: null,
  officialNameEn: null,
  previousFileId: null,
};

function lockedFrom(row: IdentityRow): LockedBusinessLogo {
  return {
    officialNameAr: row.official_name_ar,
    officialNameEn: row.official_name_en,
    previousFileId: row.logo_file_id?.toLowerCase() ?? null,
  };
}

async function readSettings(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<LockedBusinessLogo | undefined> {
  const [row] = await tx.execute<IdentityRow>(sql`
    SELECT official_name_ar, official_name_en, logo_file_id
    FROM business_settings
    WHERE company_id = ${companyId} AND business_id = ${businessId}`);
  return row === undefined ? undefined : lockedFrom(row);
}

async function lockRemoval(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<LockedBusinessLogo> {
  const current = await readSettings(tx, companyId, businessId);
  // إنشاء الصف هنا كان بيختم updated_at من غير تدقيق ولا إبطال كاش، والإزالة أصلاً لا تغيّر حاجة.
  if (current === undefined || current.previousFileId === null) return current ?? NO_LOGO;
  const [row] = await tx.execute<IdentityRow>(sql`
    SELECT official_name_ar, official_name_en, logo_file_id
    FROM business_settings
    WHERE company_id = ${companyId} AND business_id = ${businessId}
    FOR UPDATE`);
  return row === undefined ? NO_LOGO : lockedFrom(row);
}

async function ensureSettingsRow(tx: Tx, companyId: string, businessId: string): Promise<void> {
  // صف ظاهر: منعملش INSERT، عشان الانتظار على صف متقفل يسبق قفل المستهلك. أول ربط بس بينشئ الصف الفاضي.
  if ((await readSettings(tx, companyId, businessId)) !== undefined) return;
  await tx.execute<{ business_id: string }>(sql`
    INSERT INTO business_settings (company_id, business_id)
    VALUES (${companyId}, ${businessId})
    ON CONFLICT (company_id, business_id) DO NOTHING
    RETURNING business_id`);
}

async function lockSettings(
  tx: Tx,
  companyId: string,
  businessId: string,
  fileId: string | null,
): Promise<LockedBusinessLogo> {
  if (fileId === null) return lockRemoval(tx, companyId, businessId);
  await ensureSettingsRow(tx, companyId, businessId);
  // الربط بيقفل الإعدادات قبل الملف: مستهلك الحذف بياخد نفس الترتيب، والعكس deadlock.
  await lockBusinessLogoReference(tx, companyId, businessId, fileId);
  return (await readSettings(tx, companyId, businessId)) ?? NO_LOGO;
}

async function acceptLogo(
  tx: Tx,
  companyId: string,
  businessId: string,
  actorId: string,
  fileId: string,
): Promise<void> {
  const facts = await documentFileFacts(tx, companyId, fileId);
  if (facts === null) throw new LogoFileRejected('FILE_NOT_FOUND');
  validateLogoFile(toLogoFacts(facts), businessId, actorId);
}

async function lockCandidate(
  tx: Tx,
  companyId: string,
  businessId: string,
  actorId: string,
  fileId: string,
): Promise<void> {
  // التحقق قبل القفل: وثيقة موظف في نفس الشركة مرفوضة من غير ما صفها يتقفل. بعدها نعيد التحقق لأن الصف ممكن يتغير وهو مستنّى.
  await acceptLogo(tx, companyId, businessId, actorId, fileId);
  await tx.execute(sql`
    SELECT id FROM file_objects
    WHERE company_id = ${companyId} AND id = ${fileId}
    FOR UPDATE`);
  await acceptLogo(tx, companyId, businessId, actorId, fileId);
}

export function createLogoFileReader(tx: Tx, companyId: string): LogoFileReader {
  return {
    lockSettings: (businessId, fileId) => lockSettings(tx, companyId, businessId, fileId),
    lockCandidate: (businessId, actorId, fileId) =>
      lockCandidate(tx, companyId, businessId, actorId, fileId),
  };
}
