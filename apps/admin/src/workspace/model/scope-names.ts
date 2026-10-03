import type { WorkspaceCompany } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { displayName } from './display-name';

// أسماء النطاقات من الشركة المختارة فقط، عشان معرّف متكرر في شركة تانية ما يغيّرش العرض.
export function workspaceScopeNames(
  company: WorkspaceCompany,
  locale: Locale,
): Readonly<Record<string, string>> {
  const names: Record<string, string> = { [`COMPANY:${company.id}`]: displayName(company, locale) };
  for (const business of company.businesses) {
    names[`BUSINESS:${business.id}`] = displayName(business, locale);
    for (const branch of business.branches)
      names[`BRANCH:${branch.id}`] = displayName(branch, locale);
  }
  return names;
}
