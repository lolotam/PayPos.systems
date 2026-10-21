import type { ReplaceStaffColumnsInput, StaffColumnsSettings } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import {
  canonicalStaffColumns,
  effectiveStaffColumns,
  effectiveStaffMonthsBack,
  invalidStaffColumns,
  isValidStaffMonthsBack,
  sameStaffColumns,
} from '../../domain/staff-columns.ts';
import type {
  StaffColumnsTransactions,
  StoredStaffColumns,
} from '../../ports/staff-columns-settings.port.ts';
import type { SettingsCache } from '../../ports/settings.port.ts';

/**
 * The response every caller of the setting sees: what the "my" reads apply, and whether it is the default.
 *
 * @param businessId the business
 * @param stored     what is stored
 * @returns the effective setting
 */
export function staffColumnsView(
  businessId: string,
  stored: StoredStaffColumns,
): StaffColumnsSettings {
  return {
    business_id: businessId,
    columns: effectiveStaffColumns(stored.columns),
    columns_default: stored.columns === null,
    months_back: effectiveStaffMonthsBack(stored.monthsBack),
    months_back_default: stored.monthsBack === null,
  };
}

// المدير بيستبدل أعمدة تطبيق الموظفات وعدد الشهور، وكل قيمة اتغيرت ليها سطر audit في نفس المعاملة (MY-18، D-A14).
export class ReplaceStaffColumns {
  readonly #transactions: StaffColumnsTransactions;
  readonly #cache: SettingsCache;

  constructor(transactions: StaffColumnsTransactions, cache: SettingsCache) {
    this.#transactions = transactions;
    this.#cache = cache;
  }

  /**
   * @param command the verified company and business, the manager, the request key and the new values
   * @param command.companyId   the verified company
   * @param command.userId      the manager
   * @param command.businessId  the business the guard authorized
   * @param command.key         the Idempotency-Key
   * @param command.fingerprint the request fingerprint
   * @param command.input       the new columns and months back; null returns a value to its default
   * @returns the effective setting after the change
   */
  async execute(command: {
    companyId: string;
    userId: string;
    businessId: string;
    key: string;
    fingerprint: string;
    input: ReplaceStaffColumnsInput;
  }): Promise<StaffColumnsSettings> {
    const { businessId, input, userId } = command;
    const invalid = input.columns === null ? [] : invalidStaffColumns(input.columns);
    if (invalid.length > 0) throw new ApiError('STAFF_COLUMNS_INVALID', { codes: invalid });
    if (input.months_back !== null && !isValidStaffMonthsBack(input.months_back)) {
      throw new ApiError('STAFF_MONTHS_BACK_INVALID');
    }
    const next: StoredStaffColumns = {
      columns: input.columns === null ? null : canonicalStaffColumns(input.columns),
      monthsBack: input.months_back,
    };
    const view = await this.#transactions.run(command, async (scope) => {
      const before = await scope.lock(businessId);
      // الأعمدة مجموعة مش ترتيب: تكرار نفس الأعمدة بترتيب تاني مش تغيير، فمفيش كتابة ولا سطر audit.
      if (sameStaffColumns(before.columns, next.columns) && before.monthsBack === next.monthsBack) {
        return staffColumnsView(businessId, before);
      }
      const after = await scope.save(businessId, next, userId);
      if (!sameStaffColumns(before.columns, after.columns)) {
        await scope.audit.record({
          entity: 'business_settings',
          entityId: businessId,
          action: 'settings.staff_columns_changed',
          before: { staff_columns: before.columns },
          after: { staff_columns: after.columns },
        });
      }
      if (before.monthsBack !== after.monthsBack) {
        await scope.audit.record({
          entity: 'business_settings',
          entityId: businessId,
          action: 'settings.staff_months_back_changed',
          before: { staff_months_back: before.monthsBack },
          after: { staff_months_back: after.monthsBack },
        });
      }
      return staffColumnsView(businessId, after);
    });
    // الإبطال بعد كل طلب نجح، حتى لو الأعمدة ما تغيّرتش: إعادة المحاولة بعد سقوط Redis لازم تمسح الجيل القديم.
    await this.#cache.invalidate(command.companyId, businessId);
    return view;
  }
}
