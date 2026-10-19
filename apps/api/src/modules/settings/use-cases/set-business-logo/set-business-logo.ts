import type { BusinessLogo, SetBusinessLogoInput } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import { LogoFileRejected } from '../../domain/errors.ts';
import type { BusinessLogoChanged } from '../../events/published.ts';
import type { LockedBusinessLogo } from '../../ports/logo-file.port.ts';
import type {
  SettingsCache,
  SettingsScope,
  SettingsTransactions,
  StoredSettings,
} from '../../ports/settings.port.ts';

const identitySnapshot = (
  officialNameAr: string | null,
  officialNameEn: string | null,
  logoFileId: string | null,
) => ({
  official_name_ar: officialNameAr,
  official_name_en: officialNameEn,
  logo_file_id: logoFileId,
});

function asLogoError(error: unknown): never {
  if (error instanceof LogoFileRejected) throw new ApiError(error.code);
  throw error;
}

async function requireReadyLogo(
  scope: SettingsScope,
  businessId: string,
  userId: string,
  fileId: string,
): Promise<void> {
  try {
    await scope.logoFiles.lockCandidate(businessId, userId, fileId);
  } catch (error) {
    asLogoError(error);
  }
}

async function recordLogoChange(
  scope: SettingsScope,
  businessId: string,
  userId: string,
  fileId: string | null,
  locked: LockedBusinessLogo,
): Promise<StoredSettings> {
  let after: StoredSettings;
  try {
    after = await scope.saveLogo(businessId, fileId, userId);
  } catch (error) {
    asLogoError(error);
  }
  const payload: BusinessLogoChanged = {
    business_id: businessId,
    previous_file_id: locked.previousFileId,
    file_id: after.logoFileId,
  };
  await scope.audit.record({
    entity: 'business_settings',
    entityId: businessId,
    action: 'settings.identity_changed',
    before: identitySnapshot(locked.officialNameAr, locked.officialNameEn, locked.previousFileId),
    after: identitySnapshot(after.officialNameAr, after.officialNameEn, after.logoFileId),
  });
  await scope.outbox.append({
    aggregateType: 'business',
    aggregateId: businessId,
    eventType: 'BusinessLogoChanged',
    payload,
  });
  return after;
}

async function writeLogo(
  scope: SettingsScope,
  businessId: string,
  userId: string,
  fileId: string | null,
): Promise<string | null> {
  if ((await scope.identityAccess.check(businessId)) !== null) throw new ApiError('FORBIDDEN');
  const locked = await scope.logoFiles.lockSettings(businessId, fileId);
  if ((await scope.identityAccess.recheck(businessId)) !== null) throw new ApiError('FORBIDDEN');
  // إعادة ربط الملف الحالي، أو إزالة شعار مش موجود، لا حدث ولا تدقيق: المقارنة بعد قفل الإعدادات.
  if (locked.previousFileId === fileId) return fileId;
  if (fileId !== null) await requireReadyLogo(scope, businessId, userId, fileId);
  return (await recordLogoChange(scope, businessId, userId, fileId, locked)).logoFileId;
}

// المالك أو حامل صلاحية هوية النشاط بيربط شعار جاهز أو يشيله، والحدث والتدقيق في نفس المعاملة لما الإشارة تتغير.
export class SetBusinessLogo {
  constructor(
    private readonly transactions: SettingsTransactions,
    private readonly cache: SettingsCache,
  ) {}

  async execute(
    actor: { companyId: string; userId: string },
    businessId: string,
    input: SetBusinessLogoInput,
  ): Promise<BusinessLogo> {
    const fileId = input.file_id === null ? null : input.file_id.toLowerCase();
    const companyId = actor.companyId.toLowerCase();
    const userId = actor.userId.toLowerCase();
    const logoFileId = await this.transactions.run(companyId, userId, (scope) =>
      writeLogo(scope, businessId.toLowerCase(), userId, fileId),
    );
    // الإبطال بعد كل طلب نجح، حتى لو الإشارة ما تغيّرتش: إعادة المحاولة بعد سقوط Redis لازم تمسح الجيل القديم.
    await this.cache.invalidate(companyId, businessId.toLowerCase());
    return { logo_file_id: logoFileId };
  }
}
