import type { WorkspaceBranch, WorkspaceBusiness, WorkspaceCompany } from '@pospay/contracts';

import type { SelectionChoice } from '@/shared/api/selection-cookie';

export interface ResolvedSelection {
  status: 'empty' | 'choose' | 'ready';
  company?: WorkspaceCompany | undefined;
  business?: WorkspaceBusiness | undefined;
  branch?: WorkspaceBranch | undefined;
}

function only<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

function pick<T extends { id: string }>(
  items: readonly T[],
  id: string | undefined,
): T | undefined {
  const remembered = id === undefined ? undefined : items.find((item) => item.id === id);
  return remembered ?? only(items);
}

// A list with one entry is chosen for the user: it is a view context, not a grant — the API re-checks the
// membership on every request — so picking the only option changes nothing the user could have chosen.
export function resolveSelection(
  companies: readonly WorkspaceCompany[],
  remembered: SelectionChoice,
): ResolvedSelection {
  if (companies.length === 0) return { status: 'empty' };
  const company = pick(companies, remembered.companyId);
  if (!company) return { status: 'choose' };
  const business = pick(company.businesses, remembered.businessId);
  const branch = business ? pick(business.branches, remembered.branchId) : undefined;
  return { status: 'ready', company, business, branch };
}
