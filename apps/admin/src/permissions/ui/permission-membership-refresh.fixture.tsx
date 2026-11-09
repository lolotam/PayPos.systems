import { membershipPermissions, permissionMembershipPage } from '@pospay/contracts';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

import { PermissionMembershipBrowser } from './permission-membership-browser';

export const companyId = '01920000-0000-7000-8000-0000000000a0';
export const businessId = '01920000-0000-7000-8000-0000000000b0';
const membershipId = '01920000-0000-7000-8000-0000000000c0';
const holderId = '01920000-0000-7000-8000-0000000000d0';
export const userId = '01920000-0000-7000-8000-0000000000e0';

const releases = new Set<() => void>();

export function permissionResponses(businessScoped: boolean, business: string | undefined) {
  const membership = {
    id: membershipId,
    user_id: holderId,
    employee_id: null,
    role_code: 'viewer',
    role_name_ar: null,
    role_name_en: 'Viewer',
    scope_type: businessScoped ? 'BUSINESS' : 'COMPANY',
    scope_id: business ?? companyId,
    starts_at: '2026-01-01T00:00:00Z',
    ends_at: null,
  };
  const page = permissionMembershipPage.parse({ items: [membership], next_cursor: null });
  const detail = membershipPermissions.parse({
    membership,
    role_defaults: ['read:memberships:company'],
    permission_catalog: ['read:memberships:company'],
    overrides: { items: [], next_cursor: null },
    ended_overrides: { items: [], next_cursor: null },
    editing_enabled: true,
    discount_limit: { limit_bps: null },
  });
  return { page, detail };
}

export function renderBrowser(client: QueryClient, business: string | undefined) {
  render(
    <QueryClientProvider client={client}>
      <PermissionMembershipBrowser
        companyId={companyId}
        userId={userId}
        businessId={business}
        branchTimeZones={{}}
        scopeNames={{}}
      />
    </QueryClientProvider>,
  );
}

export function hold() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = () => {
      releases.delete(release);
      resolve();
    };
  });
  releases.add(release);
  return { promise, release };
}

export function releaseHeldReads() {
  const pending = releases.size;
  for (const release of releases) release();
  releases.clear();
  return pending;
}
