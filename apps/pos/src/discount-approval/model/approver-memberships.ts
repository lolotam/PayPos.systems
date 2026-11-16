import { roleName, t, type Locale } from '@pospay/i18n';

export type ApproverMembership = {
  membershipId: string;
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH' | null;
  role: { code: string; nameAr: string | null; nameEn: string } | null;
};

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null;
}

function readRole(input: unknown): ApproverMembership['role'] {
  const role = record(input);
  if (
    role === null ||
    typeof role.code !== 'string' ||
    typeof role.name_en !== 'string' ||
    (typeof role.name_ar !== 'string' && role.name_ar !== null)
  ) {
    return null;
  }
  return { code: role.code, nameAr: role.name_ar, nameEn: role.name_en };
}

function readScopeType(input: unknown): ApproverMembership['scopeType'] {
  return input === 'COMPANY' || input === 'BUSINESS' || input === 'BRANCH' ? input : null;
}

export function readApproverMemberships(details: unknown): ApproverMembership[] | null {
  const body = record(details);
  const entries = body?.approver_memberships;
  if (!Array.isArray(entries)) return null;
  const memberships: ApproverMembership[] = [];
  for (const entryValue of entries) {
    const entry = record(entryValue);
    if (entry === null || typeof entry.membership_id !== 'string' || entry.membership_id === '') {
      continue;
    }
    memberships.push({
      membershipId: entry.membership_id,
      scopeType: readScopeType(entry.scope_type),
      role: readRole(entry.role),
    });
  }
  return memberships.length === 0 ? null : memberships;
}

export function approverMembershipLabel(
  locale: Locale,
  membership: ApproverMembership,
  index: number,
): string {
  if (membership.role === null || membership.scopeType === null) {
    return t(locale, 'deviceDiscountApproval.membershipN').replace('{n}', String(index + 1));
  }
  const stored =
    locale === 'ar'
      ? (membership.role.nameAr ?? membership.role.nameEn)
      : membership.role.nameEn;
  const scopeKey = {
    COMPANY: 'scopeCompany',
    BUSINESS: 'scopeBusiness',
    BRANCH: 'scopeBranch',
  } as const;
  const role = roleName(locale, membership.role.code, stored);
  const scope = t(locale, `deviceDiscountApproval.${scopeKey[membership.scopeType]}`);
  return `${role} — ${scope}`;
}
