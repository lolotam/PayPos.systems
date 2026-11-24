import type { Country } from '@pospay/contracts';

import {
  isEntryShownForWorkspace,
  isSoonEntryShownForRole,
} from '@/workspace/model/navigation-rules';
import type {
  NavigationBusinessType,
  NavigationPageEntry,
  NavigationVisibilityCondition,
} from '@/workspace/nav-types';

export type VisibilityConditions = Readonly<Record<NavigationVisibilityCondition, boolean>>;

export interface VisibilityInput {
  conditions: VisibilityConditions;
  businessType: NavigationBusinessType | null;
  country: Country | null;
  role: string;
}

/**
 * معرّفات الصفحات التي يراها المستخدم الآن في القوائم الثلاث.
 * الصفحة الحية تتبع شرط الظهور القديم كما هو (BR-006) وأدوارها إن حُددت لها،
 * والصفحة غير المبنية تتبع الدور،
 * وكلتاهما تمرّان على قاعدة نوع النشاط والبلد المعرّفة في navigation-rules.
 */
export function visiblePageIds(
  pages: readonly NavigationPageEntry[],
  input: VisibilityInput,
): readonly string[] {
  return pages
    .filter((entry) => {
      if (!isEntryShownForWorkspace(entry, input.businessType, input.country)) return false;
      if (entry.state === 'soon') return isSoonEntryShownForRole(entry, input.role);
      if (entry.roles !== undefined && !entry.roles.some((allowed) => allowed === input.role)) {
        return false;
      }
      return input.conditions[entry.visible];
    })
    .map((entry) => entry.id);
}
