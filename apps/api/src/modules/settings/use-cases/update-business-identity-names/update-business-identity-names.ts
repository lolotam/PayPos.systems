import type { BusinessIdentityNames, UpdateBusinessIdentityNamesInput } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import { normalizeOfficialName, OfficialNameRejected } from '../../domain/official-name.ts';
import type {
  IdentityNamesChange,
  SettingsCache,
  SettingsScope,
  SettingsTransactions,
  StoredSettings,
} from '../../ports/settings.port.ts';

const snapshot = (row: StoredSettings | null) => ({
  official_name_ar: row?.officialNameAr ?? null,
  official_name_en: row?.officialNameEn ?? null,
  logo_file_id: row?.logoFileId ?? null,
});

function writtenName(value: string | null): string | null {
  return value === null ? null : normalizeOfficialName(value);
}

function namesOf(input: UpdateBusinessIdentityNamesInput): IdentityNamesChange {
  const arabic = 'official_name_ar' in input ? input.official_name_ar : undefined;
  const english = 'official_name_en' in input ? input.official_name_en : undefined;
  try {
    return {
      ...(arabic === undefined ? {} : { officialNameAr: writtenName(arabic) }),
      ...(english === undefined ? {} : { officialNameEn: writtenName(english) }),
    };
  } catch (error) {
    if (error instanceof OfficialNameRejected) throw new ApiError('VALIDATION_FAILED');
    throw error;
  }
}

async function writeNames(
  scope: SettingsScope,
  businessId: string,
  userId: string,
  change: IdentityNamesChange,
): Promise<StoredSettings> {
  if ((await scope.identityAccess.check(businessId)) !== null) throw new ApiError('FORBIDDEN');
  const before = await scope.findForUpdate(businessId);
  if ((await scope.identityAccess.recheck(businessId)) !== null) throw new ApiError('FORBIDDEN');
  let after: StoredSettings;
  try {
    after = await scope.saveIdentity(businessId, change, userId);
  } catch (error) {
    if (error instanceof OfficialNameRejected) throw new ApiError('VALIDATION_FAILED');
    throw error;
  }
  await scope.audit.record({
    entity: 'business_settings',
    entityId: businessId,
    action: 'settings.identity_changed',
    before: snapshot(before),
    after: snapshot(after),
  });
  return after;
}

// المالك أو حامل صلاحية هوية النشاط بيكتب الاسم الرسمي أو يمسحه، والتدقيق جزء من نفس المعاملة.
export class UpdateBusinessIdentityNames {
  constructor(
    private readonly transactions: SettingsTransactions,
    private readonly cache: SettingsCache,
  ) {}

  async execute(
    actor: { companyId: string; userId: string },
    businessId: string,
    input: UpdateBusinessIdentityNamesInput,
  ): Promise<BusinessIdentityNames> {
    const change = namesOf(input);
    const saved = await this.transactions.run(actor.companyId, actor.userId, (scope) =>
      writeNames(scope, businessId, actor.userId, change),
    );
    await this.cache.invalidate(actor.companyId, businessId);
    return { official_name_ar: saved.officialNameAr, official_name_en: saved.officialNameEn };
  }
}
